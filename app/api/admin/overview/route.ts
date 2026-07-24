import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  authErrorCode,
  authErrorStatus,
  getAdminSession,
} from "@/lib/firebase/server";
import type {
  AnswerRecord,
  AnswerRatingRecord,
  AnswerViewRecord,
  AuditLogRecord,
  ConsultRequestRecord,
  OrganizationRecord,
  PointLedgerRecord,
  PointTransactionRecord,
  PartnerAnswerDraftRecord,
  PartnerAssignmentRecord,
  PartnerRecord,
  UserRecord,
} from "@/lib/firebase/schema";

export const runtime = "nodejs";

export async function GET(req: Request) {
  let session;
  try {
    session = await getAdminSession(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) }
    );
  }

  const capabilities = new Set(session.capabilities);
  const canReadMembers = capabilities.has("members:read");
  const canReadOperators = capabilities.has("operators:read");
  const canReadPartners = capabilities.has("partners:read");
  const canReadInquiries = capabilities.has("inquiries:read");
  const canReadPoints = capabilities.has("points:read");
  const canReadAudit = capabilities.has("audit:read");

  const db = adminDb();
  const [
    userSnapshot,
    requestSnapshot,
    answerSnapshot,
    ratingSnapshot,
    answerViewSnapshot,
    organizationSnapshot,
    ledgerSnapshot,
    pointTransactionSnapshot,
    auditSnapshot,
    partnerSnapshot,
    assignmentSnapshot,
    partnerDraftSnapshot,
  ] = await Promise.all([
    canReadMembers || canReadOperators
      ? db.collection("users").orderBy("createdAt", "desc").get()
      : Promise.resolve(null),
    canReadInquiries
      ? db.collection("consultRequests").orderBy("createdAt", "desc").get()
      : Promise.resolve(null),
    canReadInquiries
      ? db.collection("answers").orderBy("createdAt", "desc").get()
      : Promise.resolve(null),
    canReadInquiries
      ? db.collection("answerRatings").orderBy("updatedAt", "desc").get()
      : Promise.resolve(null),
    canReadInquiries
      ? db.collection("answerViews").orderBy("createdAt", "desc").get()
      : Promise.resolve(null),
    canReadMembers || canReadPoints
      ? db.collection("organizations").orderBy("updatedAt", "desc").get()
      : Promise.resolve(null),
    canReadPoints
      ? db.collection("pointLedger").orderBy("createdAt", "desc").get()
      : Promise.resolve(null),
    canReadPoints
      ? db.collection("point_transactions").orderBy("createdAt", "desc").get()
      : Promise.resolve(null),
    canReadAudit
      ? db.collection("auditLogs").orderBy("createdAt", "desc").get()
      : Promise.resolve(null),
    canReadPartners
      ? db.collection("partners").orderBy("updatedAt", "desc").get()
      : Promise.resolve(null),
    canReadPartners || canReadInquiries
      ? db.collection("partnerAssignments").orderBy("updatedAt", "desc").get()
      : Promise.resolve(null),
    canReadPartners || canReadInquiries
      ? db.collection("partnerAnswerDrafts").orderBy("updatedAt", "desc").get()
      : Promise.resolve(null),
  ]);

  const allUsers = userSnapshot?.docs
    .map((doc) => doc.data() as UserRecord)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")) ?? [];
  const users = allUsers.filter((user) =>
    user.role === "admin" ? canReadOperators : canReadMembers,
  );
  const requests = requestSnapshot?.docs.map(
    (doc) => doc.data() as ConsultRequestRecord
  ).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")) ?? [];
  const answers = answerSnapshot?.docs
    .map((doc) => doc.data() as AnswerRecord)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")) ?? [];
  const ratings = ratingSnapshot?.docs
    .map((doc) => doc.data() as AnswerRatingRecord)
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? "")) ?? [];
  const organizations = organizationSnapshot?.docs.map(
    (doc) => doc.data() as OrganizationRecord
  ).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")) ?? [];
  const ledger = ledgerSnapshot?.docs
    .map((doc) => doc.data() as PointLedgerRecord)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")) ?? [];
  const pointTransactions = pointTransactionSnapshot?.docs
    .map((doc) => doc.data() as PointTransactionRecord)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")) ?? [];
  const auditLogs = auditSnapshot?.docs
    .map((doc) => doc.data() as AuditLogRecord)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")) ?? [];
  const answerViews = answerViewSnapshot?.docs
    .map((doc) => doc.data() as AnswerViewRecord)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")) ?? [];
  const partners = partnerSnapshot?.docs
    .map((doc) => doc.data() as PartnerRecord)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")) ?? [];
  const partnerAssignments = assignmentSnapshot?.docs
    .map((doc) => doc.data() as PartnerAssignmentRecord)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")) ?? [];
  const partnerAnswerDrafts = partnerDraftSnapshot?.docs
    .map((doc) => doc.data() as PartnerAnswerDraftRecord)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")) ?? [];

  return NextResponse.json({
    ok: true,
    adminContext: session.context,
    adminCapabilities: session.capabilities,
    users,
    requests,
    answers,
    answerViews,
    ratings,
    organizations,
    ledger,
    pointTransactions,
    auditLogs,
    partners,
    partnerAssignments,
    partnerAnswerDrafts,
  });
}
