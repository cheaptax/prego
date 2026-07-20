import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "admin_login_endpoint_disabled",
      message: "Firebase Authentication과 admin custom claim을 사용해 로그인하세요.",
    },
    { status: 410 },
  );
}
