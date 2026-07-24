import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireWritableActiveMember,
} from "@/lib/firebase/server";
import type { UserRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

type ConsentUpdateKey = "marketing" | "email" | "sms" | "kakao";
type Payload = {
  consents?: Partial<Record<ConsentUpdateKey, boolean>>;
};

const UPDATE_KEYS: ConsentUpdateKey[] = ["marketing", "email", "sms", "kakao"];

export async function PATCH(req: Request) {
  let memberSession;
  try {
    memberSession = await requireWritableActiveMember(req);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) }
    );
  }
  const { decoded } = memberSession;

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const updates = Object.fromEntries(
    UPDATE_KEYS
      .filter((key) => typeof body.consents?.[key] === "boolean")
      .map((key) => [`consents.${key}`, body.consents?.[key]])
  );

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: "missing_consents" }, { status: 400 });
  }

  const userRef = adminDb().collection("users").doc(decoded.uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists) {
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
  }

  await userRef.update({
    ...updates,
    updatedAt: new Date().toISOString(),
  });

  const nextSnapshot = await userRef.get();
  const user = nextSnapshot.data() as UserRecord;

  return NextResponse.json({
    ok: true,
    consents: user.consents,
    updatedAt: user.updatedAt,
  });
}
