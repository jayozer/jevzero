import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const COOKIE = "jevzero-session";
export const MAX_AGE = 60 * 60 * 8;
function secret() {
  const value = process.env.JEVZERO_SESSION_SECRET || "";
  if (value.length < 32) throw new Error("Session signing is not configured");
  return value;
}
export function signSession(now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(now / 1000) + MAX_AGE,
      nonce: randomBytes(24).toString("hex"),
    }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", secret()).update(payload).digest("base64url")
  );
}
export function verifySession(value: string | undefined, now = Date.now()) {
  if (!value || value.length > 1000) return false;
  try {
    const parts = value.split(".");
    if (parts.length !== 2) return false;
    const expected = createHmac("sha256", secret()).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return false;
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return (
      Number.isInteger(data.exp) &&
      data.exp > Math.floor(now / 1000) &&
      data.exp <= Math.floor(now / 1000) + MAX_AGE &&
      typeof data.nonce === "string"
    );
  } catch {
    return false;
  }
}
export function localMode() {
  if (process.env.JEVZERO_LOCAL_MODE !== "1") return false;
  try {
    const origin = new URL(process.env.JEVZERO_APP_ORIGIN || "");
    const api = new URL(process.env.JEVZERO_BACKEND_URL || "");
    return [origin, api].every(
      (url) =>
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname) &&
        !url.username &&
        !url.password,
    );
  } catch {
    return false;
  }
}
export function configured() {
  return (
    localMode() &&
    (process.env.JEVZERO_BACKEND_TOKEN?.length ?? 0) >= 32 &&
    (process.env.JEVZERO_SESSION_SECRET?.length ?? 0) >= 32
  );
}
export function localRequest(request: Request) {
  if (!configured()) return false;
  const origin = new URL(process.env.JEVZERO_APP_ORIGIN!);
  return (
    request.headers.get("host") === origin.host &&
    (!request.headers.get("origin") ||
      request.headers.get("origin") === origin.origin) &&
    !["cross-site", "same-site"].includes(
      request.headers.get("sec-fetch-site") || "",
    )
  );
}
export function appOrigin(request: Request) {
  const value = process.env.JEVZERO_APP_ORIGIN;
  if (process.env.NODE_ENV === "production" && !value)
    throw new Error("Set the frontend origin before live use");
  return new URL(value || request.url).origin;
}
export function sameOrigin(request: Request) {
  try {
    return request.headers.get("origin") === appOrigin(request);
  } catch {
    return false;
  }
}
export const cookieOptions = {
  httpOnly: true,
  secure: !localMode() && process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
