require("dotenv").config();

const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { promisify } = require("node:util");
const { MongoClient, ObjectId } = require("mongodb");
const Stripe = require("stripe");

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PUBLIC_DIR = __dirname;
const MAX_BODY_SIZE = 10 * 1024;
const SESSION_COOKIE = "kinetra_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 10;
const PUBLIC_FILES = new Set(["/", "/classes", "/index.html", "/classes.html", "/styles.css", "/app.bundle.js"]);
const PRIVATE_FILES = new Set(["/class-details.html", "/payment.html"]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};
const scrypt = promisify(crypto.scrypt);

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(part => {
    const separator = part.indexOf("=");
    if (separator < 0) return ["", ""];
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([key]) => key));
}

function sessionCookie(token, maxAgeSeconds) {
  const secure = new URL(APP_BASE_URL).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

async function currentUser(request, database) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = await database.collection("sessions").findOne({
    tokenHash: sha256(token),
    expiresAt: { $gt: new Date() }
  });
  if (!session) return null;
  const member = await database.collection("members").findOne(
    { _id: session.memberId },
    { projection: { name: 1, email: 1, role: 1 } }
  );
  return member ? { id: member._id.toString(), name: member.name, email: member.email, role: member.role } : null;
}

async function createSession(memberId, database) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await database.collection("sessions").insertOne({
    tokenHash: sha256(token),
    memberId,
    createdAt: new Date(),
    expiresAt
  });
  return { token, expiresAt };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string") return false;
  const [saltHex, keyHex] = storedHash.split(":");
  if (!/^[\da-f]{32}$/i.test(saltHex || "") || !/^[\da-f]{128}$/i.test(keyHex || "")) return false;
  const derivedKey = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(derivedKey, Buffer.from(keyHex, "hex"));
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
  if (!PUBLIC_FILES.has(pathname) && !(privatePage && PRIVATE_FILES.has(pathname))) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  const requestedPath = pathname === "/"
    ? "/index.html"
    : pathname === "/classes"
      ? "/classes.html"
      : pathname === "/payment"
        ? "/payment.html"
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
  const members = database.collection("members");
  const applications = database.collection("trainerApplications");
  const bookings = database.collection("bookings");

  if (request.method === "GET" && pathname === "/api/auth/me") {
    const user = await currentUser(request, database);
    sendJson(response, 200, { authenticated: Boolean(user), user });
    return;
  }

  if (request.method === "POST" && ["/api/auth/register", "/api/auth/login", "/api/auth/logout"].includes(pathname)) {
    ensureSameOrigin(request);
    const sessions = database.collection("sessions");
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (pathname === "/api/auth/logout") {
      if (token) await sessions.deleteOne({ tokenHash: sha256(token) });
      sendJson(response, 200, { message: "You have been signed out." }, {
        "Set-Cookie": sessionCookie("", 0)
      });
      return;
    }

    const body = await readJson(request);
    const email = validEmail(body.email);
    if (typeof body.password !== "string" || body.password.length < PASSWORD_MIN_LENGTH || body.password.length > 128) {
      throw Object.assign(new Error(`Password must be between ${PASSWORD_MIN_LENGTH} and 128 characters.`), { statusCode: 400 });
    }

    let member;
    if (pathname === "/api/auth/register") {
      const name = requiredText(body.name, "Name", 100);
      const passwordHash = await hashPassword(body.password);
      try {
        const result = await members.insertOne({
          name,
          email,
          passwordHash,
          role: "member",
          createdAt: new Date()
        });
        member = { _id: result.insertedId, name, email, role: "member" };
      } catch (error) {
        if (error.code === 11000) {
          throw Object.assign(new Error("An account with that email already exists. Please log in."), { statusCode: 409 });
        }
        throw error;
      }
    } else {
      member = await members.findOne({ email });
      if (!member || !(await verifyPassword(body.password, member.passwordHash))) {
        throw Object.assign(new Error("Email or password is incorrect."), { statusCode: 401 });
      }
    }

    const session = await createSession(member._id, database);
    sendJson(response, 200, {
      authenticated: true,
      user: { id: member._id.toString(), name: member.name, email: member.email, role: member.role }
    }, {
      "Set-Cookie": sessionCookie(session.token, Math.floor(SESSION_DURATION_MS / 1000))
    });
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
    const alreadyBooked = await bookings.findOne({
      memberId: new ObjectId(user.id),
      classId: classItem._id,
      status: { $in: ["paid", "confirmed", "succeeded"] }
    });
    const bookingCount = await bookings.countDocuments({
      className: classItem.name || classItem.className || classItem.title,
      status: { $nin: ["cancelled", "rejected"] }
    });
    sendJson(response, 200, { class: { ...serializeClass(classItem), bookingCount }, alreadyBooked: Boolean(alreadyBooked) });
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
      database.collection("forumPosts").find({
        $or: [
          { status: { $in: ["published", "approved"] } },
          { status: { $exists: false } },
          { isPublished: true }
        ]
      }, {
        projection: { title: 1, content: 1, body: 1, authorName: 1, "author.name": 1, category: 1, createdAt: 1 }
      }).sort({ createdAt: -1 }).limit(4).toArray()
    ]);
    const latestPosts = posts.map(item => ({
      id: item._id.toString(),
      title: item.title || "Community post",
      content: item.content || item.body || "",
      authorName: item.authorName || item.author?.name || "Kinetra member",
      category: item.category || "COMMUNITY",
      createdAt: item.createdAt || null
    }));

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

  if (request.method !== "POST") {
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
  await client.connect();
  const database = client.db("flexora");
  await Promise.all([
    database.collection("members").createIndex({ email: 1 }, { unique: true }),
    database.collection("bookings").createIndex({ className: 1, status: 1 }),
    database.collection("forumPosts").createIndex({ createdAt: -1 }),
    database.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    database.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
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
      if (request.method === "POST" && url.pathname === "/api/stripe/webhook") {
        await handleStripeWebhook(request, response, database);
      } else if (privateClassRoute || privatePaymentRoute) {
        const user = await currentUser(request, database);
        if (!user) {
          const returnTo = `${url.pathname}${url.search}`;
          response.writeHead(302, {
            Location: `/?auth=login&returnTo=${encodeURIComponent(returnTo)}`,
            "Cache-Control": "no-store"
          });
          response.end();
        } else {
          await serveStatic(request, response, privateClassRoute ? "/class-details.html" : "/payment", true);
        }
      } else if (url.pathname.startsWith("/api/")) {
        if (request.method === "POST" && url.pathname !== "/api/stripe/webhook") ensureSameOrigin(request);
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
