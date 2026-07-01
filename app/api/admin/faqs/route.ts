import { NextResponse } from "next/server";
import { withoutUndefined } from "@/lib/firebase/clean";
import { adminDb } from "@/lib/firebase/admin";
import { ensureDefaultFaqRecords } from "@/lib/default-faqs";
import {
  authErrorCode,
  authErrorStatus,
  requireAdmin,
  writeAuditLog,
} from "@/lib/firebase/server";
import type { FaqRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

type CreatePayload = {
  question?: string;
  answer?: string;
  category?: string;
  isPublic?: boolean;
  displayStatus?: "published" | "draft";
  order?: number;
};

const MAX_QUESTION = 200;
const MAX_ANSWER = 5000;
const MAX_CATEGORY = 40;

function normalizeStatus(value: unknown): "published" | "draft" {
  return value === "published" ? "published" : "draft";
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const db = adminDb();
  await ensureDefaultFaqRecords(db);
  const snapshot = await db.collection("faqs").get();
  const faqs = snapshot.docs
    .map((doc) => doc.data() as FaqRecord)
    .sort((a, b) => {
      const orderA = typeof a.order === "number" ? a.order : 0;
      const orderB = typeof b.order === "number" ? b.order : 0;
      if (orderA !== orderB) return orderA - orderB;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });

  return NextResponse.json({ ok: true, faqs });
}

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const body = (await req.json().catch(() => null)) as CreatePayload | null;
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 }
    );
  }

  const question = (body.question ?? "").trim();
  const answer = (body.answer ?? "").trim();
  const category = (body.category ?? "").trim() || "일반";

  if (!question || !answer) {
    return NextResponse.json(
      { ok: false, error: "missing_required_fields" },
      { status: 400 }
    );
  }
  if (
    question.length > MAX_QUESTION ||
    answer.length > MAX_ANSWER ||
    category.length > MAX_CATEGORY
  ) {
    return NextResponse.json(
      { ok: false, error: "field_too_long" },
      { status: 400 }
    );
  }

  const db = adminDb();
  const now = new Date().toISOString();
  const docRef = db.collection("faqs").doc();

  const record: FaqRecord = {
    id: docRef.id,
    question,
    answer,
    category,
    isPublic: body.isPublic ?? true,
    displayStatus: normalizeStatus(body.displayStatus ?? "published"),
    order: typeof body.order === "number" ? body.order : Date.now(),
    createdBy: admin.uid,
    createdByEmail: admin.email,
    updatedBy: admin.uid,
    updatedByEmail: admin.email,
    createdAt: now,
    updatedAt: now,
  };

  await docRef.set(withoutUndefined(record));
  await db.runTransaction(async (transaction) => {
    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "faq.created",
      targetType: "faq",
      targetId: docRef.id,
      metadata: {
        question,
        category,
        isPublic: record.isPublic,
        displayStatus: record.displayStatus,
      },
      createdAt: now,
    });
  });

  return NextResponse.json({ ok: true, faq: record });
}
