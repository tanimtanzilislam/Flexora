require("dotenv").config();

const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { MongoClient, ObjectId } = require("mongodb");
const Stripe = require("stripe");

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PUBLIC_DIR = __dirname;
const MAX_BODY_SIZE = 10 * 1024;
const PUBLIC_FILES = new Set(["/", "/classes", "/community", "/index.html", "/classes.html", "/community.html", "/forum-post.html", "/styles.css", "/app.bundle.js"]);
const PRIVATE_FILES = new Set(["/class-details.html", "/payment.html", "/dashboard.html"]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};
let auth;
let authNodeHandler;
let fromNodeHeaders;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing. Add it to your local .env file.");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(body));
}

async function currentUser(request, database) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image || "",
    role: session.user.role || "member"
  };
}

function ensureSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const requestHost = request.headers.host;
  const isHttps = request.socket.encrypted || request.headers["x-forwarded-proto"] === "https";
  const expectedOrigin = `${isHttps ? "https" : "http"}://${requestHost}`;
  if (origin !== expectedOrigin) {
    throw Object.assign(new Error("Request origin is not allowed."), { statusCode: 403 });
  }
}

function approvedClassFilter(id) {
  return { _id: id, status: { $regex: "^approved$", $options: "i" } };
}

function publishedForumFilter() {
  return {
    $and: [
      {
        $or: [
          { status: { $in: ["published", "approved"] } },
          { status: { $exists: false } },
          { isPublished: true }
        ]
      },
      {
        $or: [
          { authorRole: { $regex: "^(trainer|admin)$", $options: "i" } },
          { authorType: { $regex: "^(trainer|admin)$", $options: "i" } },
          { createdByRole: { $regex: "^(trainer|admin)$", $options: "i" } },
          { role: { $regex: "^(trainer|admin)$", $options: "i" } },
          { "author.role": { $regex: "^(trainer|admin)$", $options: "i" } }
        ]
      }
    ]
  };
}

function serializeForumPost(item) {
  return {
    id: item._id.toString(),
    title: item.title || "Community post",
    content: item.content || item.body || item.description || "",
    authorName: item.authorName || item.author?.name || "Kinetra member",
    authorRole: item.authorRole || item.authorType || item.createdByRole || item.role || item.author?.role || "COMMUNITY",
    category: item.category || "COMMUNITY",
    imageUrl: item.imageUrl || item.image || item.coverImage || "",
    createdAt: item.createdAt || null
  };
}

function serializeForumComment(item) {
  return {
    id: item._id.toString(),
    parentCommentId: item.parentCommentId?.toString() || null,
    authorId: item.memberId.toString(),
    authorName: item.authorName,
    authorImage: item.authorImage || "",
    content: item.content,
    deleted: Boolean(item.deleted),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || null
  };
}

function serializeClass(item) {
  const { _id, ...fields } = item;
  return {
    ...fields,
    id: _id.toString(),
    name: fields.name || fields.className || fields.title || "",
    trainerName: fields.trainerName || fields.trainer?.name || "Kinetra trainer",
    category: fields.category || "Fitness",
    description: fields.description || "",
    schedule: fields.schedule || fields.schedules || null,
    imageUrl: fields.imageUrl || fields.image || ""
  };
}

async function serializeClassForCheckout(item) {
  const classItem = serializeClass(item);
  if (stripe && typeof classItem.stripePriceId === "string" && /^price_[A-Za-z0-9]+$/.test(classItem.stripePriceId)) {
    const price = await stripe.prices.retrieve(classItem.stripePriceId);
    if (price.unit_amount !== null) {
      classItem.priceInMinorUnits = price.unit_amount;
      classItem.currency = price.currency;
    }
  }
  return classItem;
}

function stripeLineItem(classItem) {
  if (typeof classItem.stripePriceId === "string" && /^price_[A-Za-z0-9]+$/.test(classItem.stripePriceId)) {
    return { price: classItem.stripePriceId, quantity: 1 };
  }
  const currency = String(classItem.currency || "").toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    throw Object.assign(new Error("This class does not have a supported Stripe currency configured."), { statusCode: 400 });
  }
  const amount = Number(classItem.priceInMinorUnits);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw Object.assign(new Error("This class does not have a valid Stripe price configured."), { statusCode: 400 });
  }
  return {
    price_data: {
      currency,
      unit_amount: amount,
      product_data: { name: classItem.name || classItem.className || classItem.title || "Fitness class" }
    },
    quantity: 1
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function readRawBody(request, maximumBytes = 100 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > maximumBytes) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function requiredText(value, label, maximumLength) {
  if (typeof value !== "string") {
    throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 });
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw Object.assign(new Error(`${label} must be between 1 and ${maximumLength} characters.`), { statusCode: 400 });
  }
  return normalized;
}

function validEmail(value) {
  const email = requiredText(value, "A valid email address", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Enter a valid email address."), { statusCode: 400 });
  }
  return email;
}

async function serveStatic(request, response, pathname, privatePage = false) {
  const forumPostPage = /^\/community\/[a-f\d]{24}$/i.test(pathname);
  if (!PUBLIC_FILES.has(pathname) && !forumPostPage && !(privatePage && PRIVATE_FILES.has(pathname))) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  const requestedPath = pathname === "/"
    ? "/index.html"
    : pathname === "/classes"
      ? "/classes.html"
      : pathname === "/community"
        ? "/community.html"
      : pathname === "/payment"
        ? "/payment.html"
        : pathname === "/dashboard"
          ? "/dashboard.html"
          : /^\/community\/[a-f\d]{24}$/i.test(pathname)
            ? "/forum-post.html"
        : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      createReadStream(filePath).pipe(response);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    throw error;
  }
}

async function handleApi(request, response, pathname, database) {
  const applications = database.collection("trainerApplications");
  const bookings = database.collection("bookings");
  const favorites = database.collection("favorites");
  const votes = database.collection("forumVotes");
  const comments = database.collection("forumComments");

  if (request.method === "GET" && pathname === "/api/auth/config") {
    sendJson(response, 200, { googleEnabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
    return;
  }

  const classDetailsMatch = pathname.match(/^\/api\/classes\/([a-f\d]{24})$/i);
  if (request.method === "GET" && classDetailsMatch) {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to view class details." });
      return;
    }
    const classId = new ObjectId(classDetailsMatch[1]);
    const classItem = await database.collection("classes").findOne(approvedClassFilter(classId));
    if (!classItem) {
      sendJson(response, 404, { error: "Approved class not found." });
      return;
    }
    const memberId = new ObjectId(user.id);
    const [booking, favorite, bookingCount] = await Promise.all([
      bookings.findOne({
        memberId,
        classId: classItem._id,
        status: { $in: ["paid", "confirmed", "succeeded"] }
      }),
      favorites.findOne({ memberId, classId: classItem._id }),
      bookings.countDocuments({
        className: classItem.name || classItem.className || classItem.title,
        status: { $nin: ["cancelled", "rejected"] }
      })
    ]);
    sendJson(response, 200, {
      class: { ...await serializeClassForCheckout(classItem), bookingCount },
      alreadyBooked: Boolean(booking),
      favorited: Boolean(favorite)
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/bookings/check") {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to book a class." });
      return;
    }
    const classId = new URL(request.url, APP_BASE_URL).searchParams.get("classId");
    if (!ObjectId.isValid(classId || "")) {
      sendJson(response, 400, { error: "A valid class is required." });
      return;
    }
    const classItem = await database.collection("classes").findOne(approvedClassFilter(new ObjectId(classId)));
    if (!classItem) {
      sendJson(response, 404, { error: "Approved class not found." });
      return;
    }
    const booking = await bookings.findOne({
      memberId: new ObjectId(user.id),
      classId: classItem._id,
      status: { $in: ["paid", "confirmed", "succeeded"] }
    });
    sendJson(response, 200, { alreadyBooked: Boolean(booking) });
    return;
  }

  if (request.method === "GET" && pathname === "/api/favorites") {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to view your favorite classes." });
      return;
    }
    const saved = await favorites.find({ memberId: new ObjectId(user.id) }).toArray();
    const classIds = saved.map(item => item.classId);
    const classes = classIds.length
      ? await database.collection("classes").find({
        _id: { $in: classIds },
        status: { $regex: "^approved$", $options: "i" }
      }).toArray()
      : [];
    sendJson(response, 200, { favorites: classes.map(serializeClass) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/favorites") {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to save favorite classes." });
      return;
    }
    const body = await readJson(request);
    if (!ObjectId.isValid(body.classId || "")) {
      sendJson(response, 400, { error: "A valid class is required." });
      return;
    }
    const classId = new ObjectId(body.classId);
    const classItem = await database.collection("classes").findOne(approvedClassFilter(classId));
    if (!classItem) {
      sendJson(response, 404, { error: "Approved class not found." });
      return;
    }
    const memberId = new ObjectId(user.id);
    if (await favorites.findOne({ memberId, classId })) {
      sendJson(response, 409, { error: "This class is already in your favorites.", alreadyFavorite: true });
      return;
    }
    try {
      await favorites.insertOne({ memberId, classId, createdAt: new Date() });
    } catch (error) {
      if (error.code !== 11000) throw error;
      sendJson(response, 409, { error: "This class is already in your favorites.", alreadyFavorite: true });
      return;
    }
    sendJson(response, 201, { message: "Successfully added to your favorites!", favorited: true });
    return;
  }

  if (request.method === "DELETE" && pathname === "/api/favorites") {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to manage your favorite classes." });
      return;
    }
    const classId = new URL(request.url, APP_BASE_URL).searchParams.get("classId");
    if (!ObjectId.isValid(classId || "")) {
      sendJson(response, 400, { error: "A valid class is required." });
      return;
    }
    await favorites.deleteOne({ memberId: new ObjectId(user.id), classId: new ObjectId(classId) });
    sendJson(response, 200, { message: "Removed from your favorites.", favorited: false });
    return;
  }

  const forumPostVoteMatch = pathname.match(/^\/api\/community\/([a-f\d]{24})\/votes$/i);
  if (forumPostVoteMatch && ["POST", "DELETE"].includes(request.method)) {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to vote on community posts." });
      return;
    }
    const postId = new ObjectId(forumPostVoteMatch[1]);
    const post = await database.collection("forumPosts").findOne({ ...publishedForumFilter(), _id: postId });
    if (!post) {
      sendJson(response, 404, { error: "Community post not found." });
      return;
    }
    const memberId = new ObjectId(user.id);
    const existingVote = await votes.findOne({ postId, memberId });
    if (request.method === "DELETE") {
      if (existingVote) await votes.deleteOne({ _id: existingVote._id });
    } else {
      const body = await readJson(request);
      if (!["like", "dislike"].includes(body.vote)) {
        sendJson(response, 400, { error: "Choose like or dislike." });
        return;
      }
      if (existingVote?.vote === body.vote) {
        sendJson(response, 409, { error: "You have already voted this way.", alreadyVoted: true });
        return;
      }
      if (existingVote) {
        await votes.updateOne({ _id: existingVote._id }, { $set: { vote: body.vote, updatedAt: new Date() } });
      } else {
        try {
          await votes.insertOne({ postId, memberId, vote: body.vote, createdAt: new Date() });
        } catch (error) {
          if (error.code !== 11000) throw error;
          sendJson(response, 409, { error: "You have already voted on this post.", alreadyVoted: true });
          return;
        }
      }
    }
    const [likes, dislikes, vote] = await Promise.all([
      votes.countDocuments({ postId, vote: "like" }),
      votes.countDocuments({ postId, vote: "dislike" }),
      votes.findOne({ postId, memberId })
    ]);
    sendJson(response, 200, {
      likes,
      dislikes,
      userVote: vote?.vote || null,
      message: request.method === "DELETE" ? "Your vote was removed." : "Your vote was saved."
    });
    return;
  }

  const forumCommentMatch = pathname.match(/^\/api\/community\/([a-f\d]{24})\/comments(?:\/([a-f\d]{24}))?$/i);
  if (forumCommentMatch && ["POST", "PATCH", "DELETE"].includes(request.method)) {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to participate in the discussion." });
      return;
    }
    const postId = new ObjectId(forumCommentMatch[1]);
    const post = await database.collection("forumPosts").findOne({ ...publishedForumFilter(), _id: postId });
    if (!post) {
      sendJson(response, 404, { error: "Community post not found." });
      return;
    }
    const memberId = new ObjectId(user.id);
    if (request.method === "POST" && !forumCommentMatch[2]) {
      const body = await readJson(request);
      const content = requiredText(body.content, "Comment", 2000);
      let parentCommentId = null;
      if (body.parentCommentId) {
        if (!ObjectId.isValid(body.parentCommentId)) {
          sendJson(response, 400, { error: "A valid parent comment is required." });
          return;
        }
        parentCommentId = new ObjectId(body.parentCommentId);
        const parent = await comments.findOne({ _id: parentCommentId, postId });
        if (!parent) {
          sendJson(response, 404, { error: "Parent comment not found." });
          return;
        }
      }
      const result = await comments.insertOne({
        postId,
        parentCommentId,
        memberId,
        authorName: user.name,
        authorImage: user.image,
        content,
        deleted: false,
        createdAt: new Date(),
        updatedAt: null
      });
      sendJson(response, 201, {
        comment: serializeForumComment({
          _id: result.insertedId,
          postId,
          parentCommentId,
          memberId,
          authorName: user.name,
          authorImage: user.image,
          content,
          createdAt: new Date()
        }),
        message: "Your comment was posted."
      });
      return;
    }

    if (!forumCommentMatch[2]) {
      sendJson(response, 405, { error: "A comment ID is required." });
      return;
    }
    const commentId = new ObjectId(forumCommentMatch[2]);
    const comment = await comments.findOne({ _id: commentId, postId, memberId });
    if (!comment) {
      sendJson(response, 404, { error: "Your comment could not be found." });
      return;
    }
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const content = requiredText(body.content, "Comment", 2000);
      await comments.updateOne({ _id: commentId, postId, memberId }, { $set: { content, updatedAt: new Date() } });
      sendJson(response, 200, { message: "Your comment was updated." });
      return;
    }
    const hasReplies = await comments.countDocuments({ postId, parentCommentId: commentId });
    if (hasReplies) {
      await comments.updateOne({ _id: commentId, postId, memberId }, {
        $set: { content: "This comment was deleted.", deleted: true, updatedAt: new Date() }
      });
    } else {
      await comments.deleteOne({ _id: commentId, postId, memberId });
    }
    sendJson(response, 200, { message: "Your comment was deleted." });
    return;
  }

  const forumPostMatch = pathname.match(/^\/api\/community\/([a-f\d]{24})$/i);
  if (request.method === "GET" && forumPostMatch) {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to view this community post." });
      return;
    }
    const item = await database.collection("forumPosts").findOne({
      ...publishedForumFilter(),
      _id: new ObjectId(forumPostMatch[1])
    });
    if (!item) {
      sendJson(response, 404, { error: "Community post not found." });
      return;
    }
    const postId = item._id;
    const memberId = new ObjectId(user.id);
    const [likes, dislikes, vote, postComments] = await Promise.all([
      votes.countDocuments({ postId, vote: "like" }),
      votes.countDocuments({ postId, vote: "dislike" }),
      votes.findOne({ postId, memberId }),
      comments.find({ postId }).sort({ createdAt: 1 }).limit(500).toArray()
    ]);
    sendJson(response, 200, {
      post: serializeForumPost(item),
      likes,
      dislikes,
      userVote: vote?.vote || null,
      comments: postComments.map(serializeForumComment),
      currentUserId: user.id
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/community") {
    const posts = await database.collection("forumPosts").find(publishedForumFilter(), {
      projection: { title: 1, content: 1, body: 1, description: 1, authorName: 1, authorRole: 1, authorType: 1, createdByRole: 1, role: 1, "author.name": 1, "author.role": 1, category: 1, imageUrl: 1, image: 1, coverImage: 1, createdAt: 1 }
    }).sort({ createdAt: -1 }).limit(50).toArray();
    sendJson(response, 200, { posts: posts.map(serializeForumPost) });
    return;
  }

  if (request.method === "GET" && pathname === "/api/dashboard") {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to view your dashboard." });
      return;
    }
    const saved = await favorites.find({ memberId: new ObjectId(user.id) }).toArray();
    const classIds = saved.map(item => item.classId);
    const classes = classIds.length
      ? await database.collection("classes").find({
        _id: { $in: classIds },
        status: { $regex: "^approved$", $options: "i" }
      }).toArray()
      : [];
    sendJson(response, 200, { user, favorites: classes.map(serializeClass) });
    return;
  }

  if (request.method === "GET" && pathname === "/api/classes") {
    const classes = await database.collection("classes").aggregate([
      { $match: { status: { $regex: "^approved$", $options: "i" } } },
      {
        $addFields: {
          name: { $ifNull: ["$name", { $ifNull: ["$className", "$title"] }] }
        }
      },
      { $match: { name: { $type: "string", $ne: "" } } },
      {
        $lookup: {
          from: "bookings",
          localField: "name",
          foreignField: "className",
          pipeline: [
            { $match: { status: { $nin: ["cancelled", "rejected"] } } },
            { $count: "count" }
          ],
          as: "bookingStats"
        }
      },
      {
        $addFields: {
          bookingCount: { $ifNull: [{ $arrayElemAt: ["$bookingStats.count", 0] }, 0] },
          trainerName: { $ifNull: ["$trainerName", { $ifNull: ["$trainer.name", "Kinetra trainer"] }] },
          category: { $ifNull: ["$category", "Fitness"] },
          description: { $ifNull: ["$description", ""] },
          imageUrl: { $ifNull: ["$imageUrl", { $ifNull: ["$image", ""] }] }
        }
      },
      { $sort: { name: 1 } },
      {
        $project: {
          name: 1,
          trainerName: 1,
          category: 1,
          price: 1,
          duration: 1,
          description: 1,
          imageUrl: 1,
          bookingCount: 1
        }
      }
    ]).toArray();

    sendJson(response, 200, {
      classes: classes.map(({ _id, ...item }) => ({ ...item, id: _id.toString() }))
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/home") {
    const [featuredClasses, posts] = await Promise.all([
      database.collection("classes").aggregate([
        { $match: { status: { $regex: "^approved$", $options: "i" } } },
        {
          $addFields: {
            name: { $ifNull: ["$name", { $ifNull: ["$className", "$title"] }] }
          }
        },
        { $match: { name: { $type: "string", $ne: "" } } },
        {
          $lookup: {
            from: "bookings",
            localField: "name",
            foreignField: "className",
            pipeline: [
              { $match: { status: { $nin: ["cancelled", "rejected"] } } },
              { $count: "count" }
            ],
            as: "bookingStats"
          }
        },
        {
          $addFields: {
            bookingCount: { $ifNull: [{ $arrayElemAt: ["$bookingStats.count", 0] }, 0] },
            trainerName: { $ifNull: ["$trainerName", { $ifNull: ["$trainer.name", "Kinetra trainer"] }] },
            category: { $ifNull: ["$category", "Fitness"] },
            description: { $ifNull: ["$description", ""] },
            imageUrl: { $ifNull: ["$imageUrl", { $ifNull: ["$image", ""] }] }
          }
        },
        { $sort: { bookingCount: -1, createdAt: -1 } },
        { $limit: 3 },
        {
          $project: {
            name: 1,
            trainerName: 1,
            category: 1,
            price: 1,
            duration: 1,
            description: 1,
            imageUrl: 1,
            bookingCount: 1
          }
        }
      ]).toArray(),
      database.collection("forumPosts").find(publishedForumFilter(), {
        projection: { title: 1, content: 1, body: 1, description: 1, authorName: 1, authorRole: 1, authorType: 1, createdByRole: 1, role: 1, "author.name": 1, "author.role": 1, category: 1, imageUrl: 1, image: 1, coverImage: 1, createdAt: 1 }
      }).sort({ createdAt: -1 }).limit(4).toArray()
    ]);
    const latestPosts = posts.map(serializeForumPost);

    sendJson(response, 200, { featuredClasses, latestPosts });
    return;
  }

  if (request.method === "GET" && pathname === "/api/health") {
    await database.command({ ping: 1 });
    sendJson(response, 200, { status: "ok", database: "connected" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/checkout/verify") {
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to verify this payment." });
      return;
    }
    if (!stripe) {
      sendJson(response, 503, { error: "Stripe payments are not configured." });
      return;
    }
    const sessionId = new URL(request.url, APP_BASE_URL).searchParams.get("session_id");
    if (!sessionId) {
      sendJson(response, 400, { error: "A checkout session is required." });
      return;
    }
    const checkout = await stripe.checkout.sessions.retrieve(sessionId);
    const { bookingId, classId, memberId, attemptId } = checkout.metadata || {};
    if (
      memberId !== user.id ||
      !ObjectId.isValid(bookingId || "") ||
      !ObjectId.isValid(classId || "")
    ) {
      sendJson(response, 403, { error: "This checkout does not belong to your account." });
      return;
    }
    const bookingFilter = {
      _id: new ObjectId(bookingId),
      classId: new ObjectId(classId),
      memberId: new ObjectId(user.id),
      $or: [
        { stripeSessionId: checkout.id },
        ...(typeof attemptId === "string" ? [{ checkoutAttemptId: attemptId }] : [])
      ]
    };
    const booking = await bookings.findOne(bookingFilter);
    if (!booking) {
      sendJson(response, 404, { error: "The booking for this checkout could not be found." });
      return;
    }
    if (checkout.payment_status === "paid") {
      await bookings.updateOne(
        { _id: booking._id },
        { $set: { status: "paid", paidAt: new Date(), stripePaymentIntentId: checkout.payment_intent || null } }
      );
    }
    sendJson(response, 200, { paid: checkout.payment_status === "paid" });
    return;
  }

  if (request.method === "POST" && pathname === "/api/checkout/session") {
    ensureSameOrigin(request);
    const user = await currentUser(request, database);
    if (!user) {
      sendJson(response, 401, { error: "Please log in to book this class." });
      return;
    }
    if (!stripe) {
      sendJson(response, 503, { error: "Stripe payments are not configured. Add STRIPE_SECRET_KEY to the server environment." });
      return;
    }

    const body = await readJson(request);
    if (!ObjectId.isValid(body.classId || "")) {
      sendJson(response, 400, { error: "A valid class is required." });
      return;
    }
    const classId = new ObjectId(body.classId);
    const classItem = await database.collection("classes").findOne(approvedClassFilter(classId));
    if (!classItem) {
      sendJson(response, 404, { error: "Approved class not found." });
      return;
    }

    const memberId = new ObjectId(user.id);
    const duplicate = await bookings.findOne({
      memberId,
      classId,
      status: { $in: ["paid", "confirmed", "succeeded"] }
    });
    if (duplicate) {
      sendJson(response, 409, { error: "You have already booked this class.", alreadyBooked: true });
      return;
    }

    let booking = await bookings.findOne({ memberId, classId });
    let attemptId;
    if (booking?.status === "pending_payment" && booking.stripeSessionId) {
      const existingCheckout = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);
      if (existingCheckout.payment_status === "paid") {
        await bookings.updateOne({ _id: booking._id }, { $set: { status: "paid", paidAt: new Date() } });
        sendJson(response, 409, { error: "You have already booked this class.", alreadyBooked: true });
        return;
      }
      if (existingCheckout.status === "open" && existingCheckout.url) {
        sendJson(response, 200, { url: existingCheckout.url });
        return;
      }
      await bookings.updateOne({ _id: booking._id }, { $set: { status: "expired", updatedAt: new Date() } });
      booking.status = "expired";
    }

    const retryableStatuses = ["failed", "expired", "cancelled"];
    if (booking && !retryableStatuses.includes(booking.status)) {
      sendJson(response, 409, {
        error: booking.status === "creating_checkout"
          ? "Checkout is already being prepared. Please try again shortly."
          : "A booking for this class is already being processed."
      });
      return;
    }

    if (booking) {
      attemptId = crypto.randomUUID();
      const claimed = await bookings.updateOne(
        { _id: booking._id, status: booking.status },
        {
          $set: { status: "creating_checkout", checkoutAttemptId: attemptId, updatedAt: new Date() },
          $unset: { stripeSessionId: "", checkoutUrl: "" }
        }
      );
      if (claimed.modifiedCount !== 1) {
        sendJson(response, 409, { error: "Checkout is already being prepared. Please try again shortly." });
        return;
      }
      booking.status = "creating_checkout";
    } else {
      attemptId = crypto.randomUUID();
      try {
        const result = await bookings.insertOne({
          memberId,
          classId,
          className: classItem.name || classItem.className || classItem.title,
          status: "creating_checkout",
          checkoutAttemptId: attemptId,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        booking = { _id: result.insertedId };
      } catch (error) {
        if (error.code === 11000) {
          sendJson(response, 409, { error: "A booking for this class is already being processed." });
          return;
        }
        throw error;
      }
    }

    try {
      const checkout = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [stripeLineItem(classItem)],
        client_reference_id: user.id,
        customer_email: user.email,
        metadata: {
          bookingId: booking._id.toString(),
          classId: classId.toString(),
          memberId: user.id,
          attemptId
        },
        success_url: `${APP_BASE_URL}/payment?classId=${classId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_BASE_URL}/payment?classId=${classId}&result=cancelled`
      }, { idempotencyKey: `booking-${booking._id}-${attemptId}` });
      if (!checkout.url) {
        throw new Error("Stripe did not provide a checkout URL.");
      }
      const updated = await bookings.updateOne(
        { _id: booking._id, checkoutAttemptId: attemptId, status: "creating_checkout" },
        { $set: { status: "pending_payment", stripeSessionId: checkout.id, checkoutUrl: checkout.url, updatedAt: new Date() } }
      );
      if (updated.modifiedCount !== 1) {
        const currentBooking = await bookings.findOne({ _id: booking._id, checkoutAttemptId: attemptId });
        if (!currentBooking || currentBooking.stripeSessionId !== checkout.id || !["paid", "pending_payment"].includes(currentBooking.status)) {
          throw new Error("Stripe checkout was created but could not be linked to the booking.");
        }
      }
      sendJson(response, 200, { url: checkout.url });
    } catch (error) {
      await bookings.updateOne(
        { _id: booking._id, checkoutAttemptId: attemptId, status: "creating_checkout" },
        { $set: { status: "failed", updatedAt: new Date() } }
      );
      throw error;
    }
    return;
  }

  if (!["POST", "PATCH", "DELETE"].includes(request.method)) {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (pathname === "/api/members" || pathname === "/api/bookings") {
    sendJson(response, 410, { error: "This endpoint is no longer available. Use account registration or Stripe checkout." });
    return;
  }

  const body = await readJson(request);
  const name = requiredText(body.name, "Name", 100);
  const email = validEmail(body.email);
  const now = new Date();

  if (pathname === "/api/trainer-applications") {
    const experience = requiredText(body.experience, "Coaching experience", 1000);
    await applications.insertOne({
      name,
      email,
      experience,
      status: "pending",
      createdAt: now
    });
    sendJson(response, 201, { message: "Your trainer application was received." });
    return;
  }

  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleStripeWebhook(request, response, database) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    sendJson(response, 503, { error: "Stripe webhook is not configured." });
    return;
  }
  const signature = request.headers["stripe-signature"];
  if (typeof signature !== "string") {
    sendJson(response, 400, { error: "Missing Stripe signature." });
    return;
  }

  let event;
  try {
    const rawBody = await readRawBody(request);
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    sendJson(response, 400, { error: `Invalid Stripe webhook: ${error.message}` });
    return;
  }

  const checkout = event.data.object;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const { bookingId, classId, memberId, attemptId } = checkout.metadata || {};
    if (ObjectId.isValid(bookingId || "") && ObjectId.isValid(classId || "") && ObjectId.isValid(memberId || "")) {
      await database.collection("bookings").updateOne(
        {
          _id: new ObjectId(bookingId),
          classId: new ObjectId(classId),
          memberId: new ObjectId(memberId),
          $or: [
            { stripeSessionId: checkout.id },
            ...(typeof attemptId === "string" ? [{ checkoutAttemptId: attemptId }] : [])
          ]
        },
        {
          $set: {
            status: checkout.payment_status === "paid" ? "paid" : "pending_payment",
            stripeSessionId: checkout.id,
            stripePaymentIntentId: checkout.payment_intent || null,
            paidAt: checkout.payment_status === "paid" ? new Date() : null,
            updatedAt: new Date()
          }
        }
      );
    }
  } else if (event.type === "checkout.session.expired") {
    const { bookingId, classId, memberId, attemptId } = checkout.metadata || {};
    if (ObjectId.isValid(bookingId || "") && ObjectId.isValid(classId || "") && ObjectId.isValid(memberId || "")) {
      await database.collection("bookings").updateOne(
        {
          _id: new ObjectId(bookingId),
          classId: new ObjectId(classId),
          memberId: new ObjectId(memberId),
          status: "pending_payment",
          $or: [
            { stripeSessionId: checkout.id },
            ...(typeof attemptId === "string" ? [{ checkoutAttemptId: attemptId }] : [])
          ]
        },
        { $set: { status: "expired", updatedAt: new Date() } }
      );
    }
  }

  sendJson(response, 200, { received: true });
}

async function main() {
  if (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters.");
  }
  const [
    { betterAuth },
    { mongodbAdapter },
    { toNodeHandler, fromNodeHeaders: nodeHeadersToWebHeaders },
    { createAuthMiddleware, APIError }
  ] = await Promise.all([
    import("better-auth"),
    import("better-auth/adapters/mongodb"),
    import("better-auth/node"),
    import("better-auth/api")
  ]);

  await client.connect();
  const database = client.db("flexora");
  fromNodeHeaders = nodeHeadersToWebHeaders;
  auth = betterAuth({
    appName: "Kinetra",
    baseURL: APP_BASE_URL,
    secret: BETTER_AUTH_SECRET,
    database: mongodbAdapter(database, { client, transaction: false }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      maxPasswordLength: 128
    },
    socialProviders: GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
      ? { google: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } }
      : {},
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "member", input: false }
      }
    },
    advanced: {
      database: { generateId: false }
    },
    hooks: {
      before: createAuthMiddleware(async context => {
        if (context.path !== "/sign-up/email") return;
        const password = context.body?.password;
        if (typeof password !== "string" || !/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
          throw new APIError("BAD_REQUEST", {
            message: "Password must include at least one uppercase and one lowercase letter."
          });
        }
      })
    }
  });
  authNodeHandler = toNodeHandler(auth);
  await Promise.all([
    database.collection("bookings").createIndex({ className: 1, status: 1 }),
    database.collection("forumPosts").createIndex({ createdAt: -1 }),
    database.collection("favorites").createIndex({ memberId: 1, classId: 1 }, { unique: true }),
    database.collection("forumVotes").createIndex({ postId: 1, memberId: 1 }, { unique: true }),
    database.collection("forumVotes").createIndex({ postId: 1, vote: 1 }),
    database.collection("forumComments").createIndex({ postId: 1, createdAt: 1 }),
    database.collection("forumComments").createIndex({ postId: 1, parentCommentId: 1 }),
    database.collection("bookings").createIndex(
      { memberId: 1, classId: 1 },
      { unique: true, partialFilterExpression: { memberId: { $type: "objectId" }, classId: { $type: "objectId" } } }
    )
  ]);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      const privateClassRoute = request.method === "GET" && url.pathname.match(/^\/classes\/([a-f\d]{24})$/i);
      const privatePaymentRoute = request.method === "GET" && url.pathname === "/payment";
      const privateDashboardRoute = request.method === "GET" && url.pathname === "/dashboard";
      const privateForumPostRoute = ["GET", "HEAD"].includes(request.method) && url.pathname.match(/^\/community\/([a-f\d]{24})$/i);
      if (url.pathname === "/api/auth/config") {
        await handleApi(request, response, url.pathname, database);
      } else if (url.pathname.startsWith("/api/auth/")) {
        await authNodeHandler(request, response);
      } else if (request.method === "POST" && url.pathname === "/api/stripe/webhook") {
        await handleStripeWebhook(request, response, database);
      } else if (privateClassRoute || privatePaymentRoute || privateDashboardRoute || privateForumPostRoute) {
        const user = await currentUser(request, database);
        if (!user) {
          const returnTo = `${url.pathname}${url.search}`;
          response.writeHead(302, {
            Location: `/?auth=login&returnTo=${encodeURIComponent(returnTo)}`,
            "Cache-Control": "no-store"
          });
          response.end();
        } else {
          const privatePath = privateClassRoute
            ? "/class-details.html"
            : privatePaymentRoute
              ? "/payment.html"
              : privateDashboardRoute
                ? "/dashboard.html"
                : "/forum-post.html";
          await serveStatic(request, response, privatePath, true);
        }
      } else if (url.pathname.startsWith("/api/")) {
        if (["POST", "PATCH", "DELETE"].includes(request.method) && url.pathname !== "/api/stripe/webhook") ensureSameOrigin(request);
        await handleApi(request, response, url.pathname, database);
      } else if (request.method === "GET" || request.method === "HEAD") {
        await serveStatic(request, response, url.pathname);
      } else {
        sendJson(response, 405, { error: "Method not allowed." });
      }
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const statusCode = error.statusCode || 500;
      if (statusCode >= 500) {
        console.error("Request failed:", error.name, error.message);
      }
      sendJson(response, statusCode, {
        error: statusCode >= 500 ? "The request could not be completed. Please try again." : error.message
      });
    }
  });

  server.listen(PORT, () => {
    console.log(`Kinetra is running at http://localhost:${PORT}`);
    console.log("MongoDB connection established.");
    if (!stripe) console.warn("Stripe is not configured. Set STRIPE_SECRET_KEY to enable checkout.");
    if (stripe && !STRIPE_WEBHOOK_SECRET) console.warn("Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET to confirm payments.");
  });

  const shutdown = async () => {
    server.close(async () => {
      await client.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async error => {
  console.error("Unable to start the server:", error.name, error.message);
  await client.close();
  process.exit(1);
});
