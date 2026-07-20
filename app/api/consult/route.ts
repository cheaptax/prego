import { NextResponse } from "next/server";
import { withoutUndefined } from "@/lib/firebase/clean";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";
import { addAuditLog } from "@/lib/firebase/server";
import {
  INQUIRY_CATEGORY_AUTO_LABEL,
  INQUIRY_SUPPORT_FIELD_OPTIONS,
} from "@/lib/inquiry-categories";
import type { ConsultRequestRecord } from "@/lib/firebase/schema";

export const runtime = "nodejs";

type Payload = {
  sido?: string;
  sigungu?: string;
  cooperativeId?: string;
  cooperativeName?: string;
  cooperativeDisplay?: string;
  manualCooperativeName?: string;
  subject?: string;
  visibility?: string;
  message?: string;
  category?: string;
  parentRequestId?: string;
  attachmentNames?: string[];
  consent?: boolean;
  marketingConsent?: boolean;
  attachments?: File[];
};

const CATEGORY_LABELS: Record<string, string> = {
  AUTO: INQUIRY_CATEGORY_AUTO_LABEL,
  ACCOUNTING: "세무·회계",
  ...Object.fromEntries(
    INQUIRY_SUPPORT_FIELD_OPTIONS.map((option) => [option.value, option.label]),
  ),
};

type StoredAttachment = NonNullable<ConsultRequestRecord["attachments"]>[number];

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function boolValue(value: FormDataEntryValue | null) {
  return value === "true" || value === "on" || value === "1";
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : undefined;
}

function safeFileName(name: string) {
  return name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120);
}

function generateRequestNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `REQ-${y}${m}${d}-${rand}`;
}

function normalizeStoredVisibility(visibility: string) {
  if (visibility.toLowerCase() === "nonghyup") return "ORG_ONLY";
  return visibility.toUpperCase();
}

export async function POST(req: Request) {
  try {
    let body: Payload;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      body = {
        sido: stringValue(formData.get("sido")),
        sigungu: stringValue(formData.get("sigungu")),
        cooperativeId: stringValue(formData.get("cooperativeId")),
        cooperativeName: stringValue(formData.get("cooperativeName")),
        cooperativeDisplay: stringValue(formData.get("cooperativeDisplay")),
        manualCooperativeName: stringValue(formData.get("manualCooperativeName")),
        subject: stringValue(formData.get("subject")),
        visibility: stringValue(formData.get("visibility")),
        message: stringValue(formData.get("message")),
        category: stringValue(formData.get("category")),
        parentRequestId: stringValue(formData.get("parentRequestId")),
        consent: boolValue(formData.get("consent")),
        marketingConsent: boolValue(formData.get("marketingConsent")),
        attachments: formData
          .getAll("attachments")
          .filter((value): value is File => value instanceof File && value.size > 0),
      };
    } else {
      body = (await req.json()) as Payload;
    }

    if (
      !body.visibility?.trim() ||
      !body.subject?.trim() ||
      !body.message?.trim() ||
      !body.consent
    ) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const authorization = req.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "missing_token" }, { status: 401 });
    }

    let decoded;
    try {
      decoded = await adminAuth().verifyIdToken(token);
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
    }

    const db = adminDb();
    const requestRef = db.collection("consultRequests").doc();
    const userSnapshot = await db.collection("users").doc(decoded.uid).get();
    const userData = userSnapshot.exists ? userSnapshot.data() : undefined;
    const now = new Date().toISOString();
    const requestNumber = generateRequestNumber();
    const userCooperativeId = String(userData?.cooperativeId ?? body.cooperativeId ?? "");
    const requestedCategoryKey = (body.category ?? "AUTO").toUpperCase();
    const requestedCategoryLabel = CATEGORY_LABELS[requestedCategoryKey] ?? "자동 배정";
    const isAutoCategory = requestedCategoryKey === "AUTO" || !CATEGORY_LABELS[requestedCategoryKey];

    if (!userCooperativeId) {
      return NextResponse.json(
        { ok: false, error: "missing_user_cooperative" },
        { status: 400 }
      );
    }
    if (userData?.status !== "active") {
      return NextResponse.json(
        { ok: false, error: "approval_pending" },
        { status: 403 }
      );
    }

    const record: ConsultRequestRecord = {
      id: requestRef.id,
      uid: decoded.uid,
      user_id: decoded.uid,
      userEmail: decoded.email ?? String(userData?.email ?? ""),
      userName: String(userData?.name ?? decoded.name ?? ""),
      cooperativeId: userCooperativeId,
      nh_org_id: String(userData?.nh_org_id ?? userCooperativeId),
      cooperativeName:
        body.cooperativeName || String(userData?.cooperativeName ?? ""),
      cooperativeDisplay: body.cooperativeDisplay,
      manualCooperativeName: body.manualCooperativeName,
      sido: body.sido,
      sigungu: body.sigungu,
      subject: body.subject.trim(),
      visibility: normalizeStoredVisibility(body.visibility) as ConsultRequestRecord["visibility"],
      message: body.message.trim(),
      internalCategory: isAutoCategory ? undefined : requestedCategoryLabel,
      internal_category: isAutoCategory ? undefined : requestedCategoryLabel,
      adminTags: [],
      parentRequestId: body.parentRequestId?.trim(),
      isFollowUp: Boolean(body.parentRequestId?.trim()),
      attachmentNames:
        body.attachmentNames ?? body.attachments?.map((attachment) => attachment.name) ?? [],
      attachments: [],
      consent: Boolean(body.consent),
      marketingConsent: Boolean(body.marketingConsent),
      status: "SUBMITTED",
      requestNumber,
      createdAt: now,
      updatedAt: now,
    };

    const attachments = body.attachments ?? [];
    if (attachments.length > MAX_ATTACHMENTS) {
      return NextResponse.json({ ok: false, error: "too_many_attachments" }, { status: 400 });
    }
    if (
      attachments.some(
        (attachment) =>
          attachment.size > MAX_ATTACHMENT_SIZE ||
          !attachment.type.startsWith("image/")
      )
    ) {
      return NextResponse.json({ ok: false, error: "invalid_attachment" }, { status: 400 });
    }

    const storedAttachments: StoredAttachment[] = [];
    if (attachments.length > 0) {
      const bucket = adminStorage().bucket();
      for (const [index, attachment] of attachments.entries()) {
        const fileName = `${Date.now()}-${index}-${safeFileName(attachment.name)}`;
        const path = `consult-attachments/${decoded.uid}/${requestRef.id}/${fileName}`;
        const file = bucket.file(path);
        const buffer = Buffer.from(await attachment.arrayBuffer());
        await file.save(buffer, {
          metadata: {
            contentType: attachment.type,
            metadata: {
              ownerUid: decoded.uid,
              requestId: requestRef.id,
            },
          },
        });
        const [url] = await file.getSignedUrl({
          action: "read",
          expires: "03-01-2036",
        });
        storedAttachments.push({
          name: attachment.name,
          contentType: attachment.type,
          size: attachment.size,
          path,
          url,
        });
      }
    }
    record.attachments = storedAttachments;

    await requestRef.set(withoutUndefined(record));

    if (record.parentRequestId) {
      try {
        const parentRef = db
          .collection("consultRequests")
          .doc(record.parentRequestId);
        const parentSnapshot = await parentRef.get();
        if (parentSnapshot.exists) {
          const parentStatus = String(
            (parentSnapshot.data() as { status?: string } | undefined)?.status ??
              "",
          ).toUpperCase();
          if (parentStatus !== "COMPLETED") {
            await parentRef.update({
              status: "FOLLOWUP",
              updatedAt: now,
            });
          }
        }
      } catch {
        // 부모 문의 상태 갱신 실패는 본 요청 처리에 영향을 주지 않습니다.
      }
    }

    await addAuditLog(db, {
      actorUid: decoded.uid,
      actorEmail: decoded.email,
      action: "request.created",
      targetType: "request",
      targetId: requestRef.id,
      metadata: {
        visibility: record.visibility,
        cooperativeId: record.cooperativeId ?? null,
        parentRequestId: record.parentRequestId ?? null,
        attachmentCount: storedAttachments.length,
        category: requestedCategoryLabel,
        autoAssign: isAutoCategory,
      },
      createdAt: now,
    });

    return NextResponse.json({ ok: true, id: requestRef.id, requestNumber });
  } catch (err) {
    const message = err instanceof Error ? err.message : "consult_submit_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
