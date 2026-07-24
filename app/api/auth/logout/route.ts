import { NextResponse } from "next/server";
import { PORTAL_SESSION_COOKIE } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
  response.cookies.set({
    name: PORTAL_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
