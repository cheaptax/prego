import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type Payload = {
  email?: string;
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const [authUser, userSnapshot] = await Promise.all([
    adminAuth()
      .getUserByEmail(email)
      .then(() => true)
      .catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "auth/user-not-found"
        ) {
          return false;
        }
        throw error;
      }),
    adminDb().collection("users").where("email", "==", email).limit(1).get(),
  ]);

  return NextResponse.json({
    ok: true,
    available: !authUser && userSnapshot.empty,
  });
}
