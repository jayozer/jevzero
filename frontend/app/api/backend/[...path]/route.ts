import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { backend, boundedBody } from "@/lib/backend";
import {
  COOKIE,
  cookieOptions,
  sameOrigin,
  verifySession,
  localRequest,
} from "@/lib/session";
export const dynamic = "force-dynamic";
const commands = new Set([
  "sync",
  "classify",
  "review",
  "apply",
  "undo",
  "reconcile",
  "settings",
  "disconnect",
]);
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  if (!localRequest(request))
    return NextResponse.json(
      { error: "Open JevZero on its configured localhost address" },
      { status: 403 },
    );
  const jar = await cookies();
  if (!verifySession(jar.get(COOKIE)?.value))
    return NextResponse.json(
      { error: "Sign in to your workspace first" },
      { status: 401 },
    );
  if (request.method === "POST" && !sameOrigin(request))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parts = (await context.params).path,
    path = parts.join("/");
  const allowed =
    request.method === "GET"
      ? path === "state" ||
        path === "credentials" ||
        (parts.length === 2 &&
          parts[0] === "jobs" &&
          /^[a-f0-9]{32}$/.test(parts[1]))
      : path === "connect" ||
        path === "credentials" ||
        (parts.length === 2 &&
          parts[0] === "commands" &&
          commands.has(parts[1]));
  if (!allowed)
    return NextResponse.json({ error: "Unknown operation" }, { status: 404 });
  try {
    const result = await backend(
      path,
      request.method === "POST" ? await boundedBody(request) : undefined,
    );
    if (path === "connect" && result.status === 200) {
      const url = new URL(result.data.url);
      if (url.origin !== "https://accounts.google.com")
        throw Error("Invalid OAuth endpoint");
      const response = NextResponse.json({ url: url.href });
      response.cookies.set("jevzero-oauth", result.data.state, {
        ...cookieOptions,
        path: "/oauth/callback",
        maxAge: 600,
      });
      return response;
    }
    return NextResponse.json(
      result.status >= 400
        ? { error: result.data.detail || "Operation failed" }
        : result.data,
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Connection interrupted. Check Activity before repeating any label action.",
      },
      { status: 502 },
    );
  }
}
export const GET = handle;
export const POST = handle;
