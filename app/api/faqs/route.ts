import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { ensureDefaultFaqRecords } from "@/lib/default-faqs";
import type { FaqRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = adminDb();
    await ensureDefaultFaqRecords(db);
    const snapshot = await db.collection("faqs").get();
    const faqs = snapshot.docs
      .map((doc) => doc.data() as FaqRecord)
      .filter((faq) => faq.isPublic && faq.displayStatus === "published")
      .sort((a, b) => {
        const orderA = typeof a.order === "number" ? a.order : 0;
        const orderB = typeof b.order === "number" ? b.order : 0;
        if (orderA !== orderB) return orderA - orderB;
        return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      })
      .map((faq) => ({
        id: faq.id,
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
      }));

    return NextResponse.json({ ok: true, faqs });
  } catch {
    return NextResponse.json(
      { ok: false, error: "faq_fetch_failed" },
      { status: 500 },
    );
  }
}
