const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

const JWT_COOKIE = "kinetra_jwt";

function parseCookies(request) {
  const header = request.headers.cookie;
  if (!header) return {};
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function jwtCookieOptions(appBaseUrl, maxAge = 60 * 60 * 24 * 7) {
  return {
    httpOnly: true,
    secure: String(appBaseUrl).startsWith("https"),
    sameSite: "Lax",
    path: "/",
    maxAge
  };
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function appendSetCookie(response, cookie) {
  const current = response.getHeader("Set-Cookie");
  if (!current) {
    response.setHeader("Set-Cookie", cookie);
    return;
  }
  response.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function signAccessToken(user, secret) {
  return jwt.sign(
    {
      sub: String(user.id || user._id),
      email: user.email,
      role: user.role || "member",
      name: user.name || ""
    },
    secret,
    { expiresIn: "7d" }
  );
}

function verifyAccessToken(token, secret) {
  return jwt.verify(token, secret);
}

function clearJwtCookie(response, appBaseUrl) {
  appendSetCookie(response, serializeCookie(JWT_COOKIE, "", { ...jwtCookieOptions(appBaseUrl), maxAge: 0 }));
}

function issueJwtCookie(response, user, secret, appBaseUrl) {
  const token = signAccessToken(user, secret);
  appendSetCookie(response, serializeCookie(JWT_COOKIE, token, jwtCookieOptions(appBaseUrl)));
  return token;
}

async function userFromJwt(request, database, secret) {
  let payload;
  try {
    const token = parseCookies(request)[JWT_COOKIE];
    if (!token) return null;
    payload = verifyAccessToken(token, secret);
  } catch {
    return null;
  }
  if (!ObjectId.isValid(payload.sub || "")) return null;
  const account = await database.collection("user").findOne({ _id: new ObjectId(payload.sub) });
  if (!account) return null;
  return {
    id: account._id.toString(),
    name: account.name,
    email: account.email,
    image: account.image || "",
    role: account.role || "member",
    isBlocked: Boolean(account.isBlocked)
  };
}

module.exports = {
  JWT_COOKIE,
  parseCookies,
  jwtCookieOptions,
  serializeCookie,
  appendSetCookie,
  signAccessToken,
  verifyAccessToken,
  clearJwtCookie,
  issueJwtCookie,
  userFromJwt
};
