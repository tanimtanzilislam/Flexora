const { ObjectId } = require("mongodb");

function serializeUser(item) {
  return {
    id: item._id.toString(),
    name: item.name || "Member",
    email: item.email || "",
    role: item.role || "member",
    status: item.isBlocked ? "blocked" : "active",
    image: item.image || ""
  };
}

function serializeApplication(item) {
  return {
    id: item._id.toString(),
    memberId: item.memberId?.toString() || "",
    name: item.name || "",
    email: item.email || "",
    experienceYears: item.experienceYears ?? item.experience ?? "",
    specialty: item.specialty || "",
    status: item.status || "pending",
    feedback: item.feedback || "",
    createdAt: item.createdAt || null
  };
}

function serializeTransaction(item) {
  return {
    id: item._id.toString(),
    userEmail: item.userEmail || item.email || "",
    amount: item.amount ?? item.priceInMinorUnits ?? 0,
    currency: item.currency || "usd",
    date: item.paidAt || item.createdAt || null,
    transactionId: item.stripePaymentIntentId || item.stripeSessionId || item._id.toString()
  };
}

async function handleAdminRoutes(request, response, pathname, database, helpers) {
  const {
    requireRole, serializeClass, serializeForumPost, requiredText, readJson, sendJson, safeHttpImageUrl
  } = helpers;
  if (!pathname.startsWith("/api/admin")) return false;

  const user = await requireRole(["admin"]);
  if (!user) return true;

  const users = database.collection("user");
  const applications = database.collection("trainerApplications");
  const classes = database.collection("classes");
  const bookings = database.collection("bookings");
  const posts = database.collection("forumPosts");
  const notifications = database.collection("notifications");

  if (request.method === "GET" && pathname === "/api/admin/users") {
    const accounts = await users.find({}, { projection: { name: 1, email: 1, role: 1, isBlocked: 1, image: 1 } }).sort({ createdAt: -1 }).toArray();
    sendJson(response, 200, { users: accounts.map(serializeUser) });
    return true;
  }

  const userAction = pathname.match(/^\/api\/admin\/users\/([a-f\d]{24})\/(block|unblock|make-admin)$/i);
  if (request.method === "PATCH" && userAction) {
    const targetId = new ObjectId(userAction[1]);
    if (targetId.equals(user.objectId)) {
      sendJson(response, 400, { error: "You cannot change your own admin account this way." });
      return true;
    }
    const target = await users.findOne({ _id: targetId });
    if (!target) {
      sendJson(response, 404, { error: "User not found." });
      return true;
    }
    const action = userAction[2].toLowerCase();
    if (action === "make-admin") {
      if ((target.role || "member") !== "member") {
        sendJson(response, 400, { error: "Only standard users can be promoted to admin." });
        return true;
      }
      await users.updateOne({ _id: targetId }, { $set: { role: "admin", updatedAt: new Date() } });
      sendJson(response, 200, { message: "User promoted to admin." });
      return true;
    }
    await users.updateOne({ _id: targetId }, { $set: { isBlocked: action === "block", updatedAt: new Date() } });
    sendJson(response, 200, { message: action === "block" ? "User blocked." : "User unblocked." });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/admin/trainer-applications") {
    const pending = await applications.find({ status: { $regex: "^pending$", $options: "i" } }).sort({ createdAt: -1 }).toArray();
    sendJson(response, 200, { applications: pending.map(serializeApplication) });
    return true;
  }

  const applicationAction = pathname.match(/^\/api\/admin\/trainer-applications\/([a-f\d]{24})\/(approve|reject)$/i);
  if (request.method === "PATCH" && applicationAction) {
    const applicationId = new ObjectId(applicationAction[1]);
    const application = await applications.findOne({ _id: applicationId });
    if (!application) {
      sendJson(response, 404, { error: "Trainer application not found." });
      return true;
    }
    const body = await readJson(request);
    const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
    const action = applicationAction[2].toLowerCase();
    if (action === "approve") {
      if (application.memberId) {
        await users.updateOne({ _id: application.memberId }, { $set: { role: "trainer", updatedAt: new Date() } });
        await notifications.insertOne({
          memberId: application.memberId,
          type: "trainer-approved",
          message: "Your trainer application was approved. You can now create classes.",
          read: false,
          createdAt: new Date()
        });
      }
      await applications.updateOne({ _id: applicationId }, { $set: { status: "approved", feedback, reviewedAt: new Date() } });
      sendJson(response, 200, { message: "Trainer application approved." });
      return true;
    }
    await applications.updateOne({ _id: applicationId }, { $set: { status: "rejected", feedback, reviewedAt: new Date() } });
    if (application.memberId) {
      await notifications.insertOne({
        memberId: application.memberId,
        type: "trainer-rejected",
        message: feedback ? `Your trainer application was rejected: ${feedback}` : "Your trainer application was rejected.",
        read: false,
        createdAt: new Date()
      });
    }
    sendJson(response, 200, { message: "Trainer application rejected." });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/admin/trainers") {
    const trainers = await users.find({ role: "trainer" }, { projection: { name: 1, email: 1, role: 1, isBlocked: 1, image: 1 } }).toArray();
    sendJson(response, 200, { trainers: trainers.map(serializeUser) });
    return true;
  }

  const demoteMatch = pathname.match(/^\/api\/admin\/trainers\/([a-f\d]{24})\/demote$/i);
  if (request.method === "PATCH" && demoteMatch) {
    const trainerId = new ObjectId(demoteMatch[1]);
    const result = await users.updateOne({ _id: trainerId, role: "trainer" }, { $set: { role: "member", updatedAt: new Date() } });
    if (!result.matchedCount) {
      sendJson(response, 404, { error: "Trainer not found." });
      return true;
    }
    sendJson(response, 200, { message: "Trainer demoted to user." });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/admin/classes") {
    const items = await classes.find({}).sort({ createdAt: -1 }).toArray();
    sendJson(response, 200, { classes: items.map(item => ({ ...serializeClass(item), status: item.status || "pending" })) });
    return true;
  }

  const classAction = pathname.match(/^\/api\/admin\/classes\/([a-f\d]{24})\/(approve|reject)$/i);
  if (request.method === "PATCH" && classAction) {
    const classId = new ObjectId(classAction[1]);
    const status = classAction[2].toLowerCase() === "approve" ? "approved" : "rejected";
    const result = await classes.updateOne({ _id: classId }, { $set: { status, updatedAt: new Date() } });
    if (!result.matchedCount) {
      sendJson(response, 404, { error: "Class not found." });
      return true;
    }
    sendJson(response, 200, { message: `Class ${status}.` });
    return true;
  }

  const classDelete = pathname.match(/^\/api\/admin\/classes\/([a-f\d]{24})$/i);
  if (request.method === "DELETE" && classDelete) {
    const result = await classes.deleteOne({ _id: new ObjectId(classDelete[1]) });
    if (!result.deletedCount) {
      sendJson(response, 404, { error: "Class not found." });
      return true;
    }
    sendJson(response, 200, { message: "Class deleted." });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/admin/transactions") {
    const paid = await bookings.find({ status: { $in: ["paid", "confirmed", "succeeded"] } }).sort({ paidAt: -1, createdAt: -1 }).toArray();
    const memberIds = paid.map(item => item.memberId).filter(id => id instanceof ObjectId);
    const accounts = memberIds.length
      ? await users.find({ _id: { $in: memberIds } }, { projection: { email: 1 } }).toArray()
      : [];
    const emails = new Map(accounts.map(item => [item._id.toString(), item.email]));
    sendJson(response, 200, {
      transactions: paid.map(item => serializeTransaction({
        ...item,
        userEmail: emails.get(item.memberId?.toString()) || item.email || ""
      }))
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/admin/forum-posts") {
    const items = await posts.find({}).sort({ createdAt: -1 }).toArray();
    sendJson(response, 200, { posts: items.map(serializeForumPost) });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/admin/forum-posts") {
    const body = await readJson(request);
    const title = requiredText(body.title, "Post title", 200);
    const content = requiredText(body.content, "Description", 10000);
    const imageUrl = requiredText(body.imageUrl, "Image URL", 2000);
    if (safeHttpImageUrl(imageUrl) !== imageUrl) {
      sendJson(response, 400, { error: "Post image must use a valid HTTPS URL." });
      return true;
    }
    const now = new Date();
    const post = {
      title, content, imageUrl, authorId: user.objectId, authorName: user.name,
      authorRole: "admin", status: "published", category: "ADMIN", createdAt: now
    };
    const result = await posts.insertOne(post);
    sendJson(response, 201, { post: serializeForumPost({ ...post, _id: result.insertedId }), message: "Your forum post is published." });
    return true;
  }

  const adminPostDelete = pathname.match(/^\/api\/admin\/forum-posts\/([a-f\d]{24})$/i);
  if (request.method === "DELETE" && adminPostDelete) {
    const result = await posts.deleteOne({ _id: new ObjectId(adminPostDelete[1]) });
    if (!result.deletedCount) {
      sendJson(response, 404, { error: "Forum post not found." });
      return true;
    }
    sendJson(response, 200, { message: "Forum post deleted." });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/admin/analytics") {
    const [roleCounts, bookingTrend] = await Promise.all([
      users.aggregate([{ $group: { _id: { $ifNull: ["$role", "member"] }, count: { $sum: 1 } } }]).toArray(),
      bookings.aggregate([
        { $match: { status: { $in: ["paid", "confirmed", "succeeded"] } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: { $ifNull: ["$paidAt", "$createdAt"] } } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $limit: 14 }
      ]).toArray()
    ]);
    sendJson(response, 200, { roleCounts, bookingTrend });
    return true;
  }

  sendJson(response, 404, { error: "Admin endpoint not found." });
  return true;
}

module.exports = { handleAdminRoutes };
