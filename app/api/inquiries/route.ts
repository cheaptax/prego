import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  canReadRequest,
  getBearerToken,
  getUserRecord,
  normalizeVisibility,
} from "@/lib/firebase/server";
import { getPublicInquiryStatusLabel } from "@/lib/request-status";
import type {
  AnswerRecord,
  ConsultRequestRecord,
  UserRecord,
} from "@/lib/firebase/schema";

export const runtime = "nodejs";

const MAX_BOARD_ITEMS = 100;

function visibilityLabel(value: string) {
  const normalized = normalizeVisibility(value);
  if (normalized === "public") return "전체공개";
  if (normalized === "nonghyup") return "우리농협공개";
  return "비공개";
}

function detailNotice(request: ConsultRequestRecord, user: UserRecord | null) {
  const visibility = normalizeVisibility(String(request.visibility));
  if (visibility === "public") return "";
  if (!user) return "로그인 후 공개 범위에 따라 본문과 답변을 확인할 수 있습니다.";
  if (visibility === "nonghyup") {
    return "소속 농협 구성원에게만 본문과 답변이 공개됩니다.";
  }
  return "비공개 문의는 작성자와 운영자만 본문과 답변을 확인할 수 있습니다.";
}

async function getOptionalUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) return null;

  const decoded = await adminAuth().verifyIdToken(token);
  const user = await getUserRecord(decoded.uid);
  return user?.role === "member" && user.status === "active" ? user : null;
}

export async function GET(req: Request) {
  let user: UserRecord | null = null;
  try {
    user = await getOptionalUser(req);
  } catch {
    return NextResponse.json(
      { ok: false, error: "missing_or_invalid_token" },
      { status: 401 }
    );
  }

  const db = adminDb();
  const requestSnapshot = await db
    .collection("consultRequests")
    .orderBy("createdAt", "desc")
    .limit(MAX_BOARD_ITEMS)
    .get();

  const requests = requestSnapshot.docs.map((doc) => {
    const data = doc.data() as ConsultRequestRecord;
    return { ...data, id: data.id ?? doc.id };
  });

  const answerSnapshots = requests.length
    ? await db.getAll(
        ...requests.map((request) => db.collection("answers").doc(request.id))
      )
    : [];
  const answers = new Map(
    answerSnapshots
      .filter((doc) => doc.exists)
      .map((doc) => {
        const data = doc.data() as AnswerRecord;
        return [data.requestId ?? doc.id, data] as const;
      })
  );

  const items = requests.map((request) => {
    const visibility = normalizeVisibility(String(request.visibility));
    const canReadDetails =
      visibility === "public" || (user ? canReadRequest(request, user) : false);
    const answer = answers.get(request.id);
    const requestOrgId = request.nh_org_id ?? request.cooperativeId;
    const userOrgId = user?.nh_org_id ?? user?.cooperativeId;
    const isOrgInquiry =
      Boolean(user) &&
      visibility === "nonghyup" &&
      Boolean(requestOrgId && userOrgId && requestOrgId === userOrgId);

    return {
      id: request.id,
      requestNumber: request.requestNumber,
      subject: request.subject,
      visibility,
      visibilityLabel: visibilityLabel(String(request.visibility)),
      status: request.status,
      statusLabel: getPublicInquiryStatusLabel(request, Boolean(answer)),
      createdAt: request.createdAt,
      canReadDetails,
      isMine: Boolean(user && request.uid === user.uid),
      isOrgInquiry,
      detailNotice: canReadDetails ? "" : detailNotice(request, user),
      message: canReadDetails ? request.message : null,
      answer: canReadDetails && answer
        ? {
            body: answer.body,
            status: answer.status ?? null,
            pointCost: answer.pointCost,
            createdAt: answer.createdAt,
          }
        : null,
    };
  });

  return NextResponse.json({
    ok: true,
    auth: user ? "member" : "public",
    items,
  });
}
