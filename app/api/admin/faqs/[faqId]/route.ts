import { NextResponse } from "next/server";
import { withoutUndefined } from "@/lib/firebase/clean";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  requireAdminCapability,
  writeAuditLog,
} from "@/lib/firebase/server";
import type { FaqRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

type UpdatePayload = {
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

export async function PATCH(
  req: Request,
  context: { params: Promise<{ faqId: string }> }
) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "faqs:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const body = (await req.json().catch(() => null)) as UpdatePayload | null;
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 }
    );
  }

  const { faqId } = await context.params;
  const db = adminDb();
  const docRef = db.collection("faqs").doc(faqId);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists) {
      return { ok: false as const, error: "faq_not_found" };
    }
    const current = snapshot.data() as FaqRecord;

    const next: FaqRecord = {
      ...current,
      question:
        typeof body.question === "string"
          ? body.question.trim() || current.question
          : current.question,
      answer:
        typeof body.answer === "string"
          ? body.answer.trim() || current.answer
          : current.answer,
      category:
        typeof body.category === "string"
          ? body.category.trim() || current.category
          : current.category,
      isPublic:
        typeof body.isPublic === "boolean" ? body.isPublic : current.isPublic,
      displayStatus:
        typeof body.displayStatus === "string"
          ? normalizeStatus(body.displayStatus)
          : current.displayStatus,
      order: typeof body.order === "number" ? body.order : current.order ?? 0,
      updatedBy: admin.uid,
      updatedByEmail: admin.email,
      updatedAt: now,
    };

    if (
      next.question.length > MAX_QUESTION ||
      next.answer.length > MAX_ANSWER ||
      next.category.length > MAX_CATEGORY
    ) {
      return { ok: false as const, error: "field_too_long" };
    }

    transaction.set(docRef, withoutUndefined(next), { merge: true });

    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "faq.updated",
      targetType: "faq",
      targetId: faqId,
      metadata: {
        question: next.question,
        category: next.category,
        isPublic: next.isPublic,
        displayStatus: next.displayStatus,
      },
      createdAt: now,
    });

    return { ok: true as const, faq: next };
  });

  if (!result.ok) {
    const status = result.error === "faq_not_found" ? 404 : 400;
    return NextResponse.json(
      { ok: false, error: result.error },
      { status }
    );
  }

  return NextResponse.json({ ok: true, faq: result.faq });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ faqId: string }> }
) {
  let admin;
  try {
    admin = await requireAdminCapability(req, "faqs:write");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const { faqId } = await context.params;
  const db = adminDb();
  const docRef = db.collection("faqs").doc(faqId);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists) {
      return { ok: false as const, error: "faq_not_found" };
    }
    const current = snapshot.data() as FaqRecord;

    transaction.delete(docRef);
    writeAuditLog(transaction, db, {
      actorUid: admin.uid,
      actorEmail: admin.email,
      action: "faq.deleted",
      targetType: "faq",
      targetId: faqId,
      metadata: {
        question: current.question,
        category: current.category,
      },
      createdAt: now,
    });
    return { ok: true as const };
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
