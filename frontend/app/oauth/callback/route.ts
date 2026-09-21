import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { backend } from "@/lib/backend";
import { appOrigin, COOKIE, cookieOptions, verifySession } from "@/lib/session";
export async function GET(request: Request) {
  const jar = await cookies(),
    params = new URL(request.url).searchParams;
  let ok = false;
  if (verifySession(jar.get(COOKIE)?.value)) {
    try {
      const result = await backend("oauth/callback", {
        state: params.get("state") || "",
        code: params.get("code") || "",
        cookie: jar.get("jevzero-oauth")?.value || "",
      });
      ok = result.status === 200;
    } catch {}
  }
  const response = NextResponse.redirect(
    new URL(ok ? "/?connected=1" : "/?oauth=failed", appOrigin(request)),
  );
  response.cookies.set("jevzero-oauth", "", {
    ...cookieOptions,
    path: "/oauth/callback",
    maxAge: 0,
  });
  return response;
}
