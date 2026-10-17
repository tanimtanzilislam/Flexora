require("dotenv").config();

const http = require("node:http");
const path = require("node:path");
const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { MongoClient } = require("mongodb");

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const PUBLIC_DIR = __dirname;
const MAX_BODY_SIZE = 10 * 1024;
const PUBLIC_FILES = new Set(["/", "/index.html", "/styles.css", "/app.bundle.js"]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing. Add it to your local .env file.");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
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

async function serveStatic(request, response, pathname) {
  if (!PUBLIC_FILES.has(pathname)) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
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

  if (request.method === "GET" && pathname === "/api/home") {
    const [featuredClasses, posts] = await Promise.all([
      database.collection("classes").aggregate([
        {
          $match: {
            $or: [
              { status: { $in: ["approved", "active"] } },
              { status: { $exists: false } }
            ]
          }
        },
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

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const body = await readJson(request);
  const name = requiredText(body.name, "Name", 100);
  const email = validEmail(body.email);
  const now = new Date();

  if (pathname === "/api/members") {
    await members.updateOne(
      { email },
      { $setOnInsert: { name, email, role: "member", createdAt: now } },
      { upsert: true }
    );
    sendJson(response, 201, { message: "Your member registration was saved." });
    return;
  }

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

  if (pathname === "/api/bookings") {
    const className = requiredText(body.className, "Class", 120);
    await members.updateOne(
      { email },
      { $setOnInsert: { name, email, role: "member", createdAt: now } },
      { upsert: true }
    );
    await bookings.insertOne({
      name,
      email,
      className,
      status: "requested",
      createdAt: now
    });
    sendJson(response, 201, { message: `Your booking request for ${className} was saved.` });
    return;
  }

  sendJson(response, 404, { error: "API endpoint not found." });
}

async function main() {
  await client.connect();
  const database = client.db("flexora");
  await Promise.all([
    database.collection("members").createIndex({ email: 1 }, { unique: true }),
    database.collection("bookings").createIndex({ className: 1, status: 1 }),
    database.collection("forumPosts").createIndex({ createdAt: -1 })
  ]);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
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
