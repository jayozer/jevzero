import { NextResponse } from "next/server";
import {
  configured,
  localRequest,
  COOKIE,
  cookieOptions,
  signSession,
} from "@/lib/session";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!configured())
    return NextResponse.json(
      { authenticated: false, configured: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  if (!localRequest(request))
    return NextResponse.json(
      { error: "Use the configured localhost address" },
      { status: 403 },
    );
  const response = NextResponse.json(
    { authenticated: true, configured: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(COOKIE, signSession(), cookieOptions);
  return response;
}
// There is no app login. Google authorization is separate from this local request protection.
