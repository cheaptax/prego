import type {
  AnswerRatingRecord,
  AnswerRecord,
  AnswerViewRecord,
  AuditLogRecord,
  ConsultRequestRecord,
  FaqRecord,
  OrganizationRecord,
  PointLedgerRecord,
  PointTransactionRecord,
  UserRecord,
} from "@/lib/firebase/schema";

const now = "2026-07-20T09:30:00.000Z";
const yesterday = "2026-07-19T04:20:00.000Z";

const consents = {
  terms: true,
  privacy: true,
  marketing: true,
  email: true,
  sms: false,
  kakao: true,
};

export const ADMIN_OPERATIONS_PREVIEW_DATA: {
  users: UserRecord[];
  requests: ConsultRequestRecord[];
  answers: AnswerRecord[];
  answerViews: AnswerViewRecord[];
  ratings: AnswerRatingRecord[];
  organizations: OrganizationRecord[];
  ledger: PointLedgerRecord[];
  pointTransactions: PointTransactionRecord[];
  auditLogs: AuditLogRecord[];
  faqs: FaqRecord[];
} = {
  users: [
    {
      uid: "preview-member-active",
      name: "김농협",
      phone: "010-1234-5678",
      email: "member@example.com",
      cooperativeId: "NH-001",
      cooperativeName: "서울중앙농협",
      position: "과장",
      duty: "기획",
      consents,
      role: "member",
      status: "active",
      createdAt: "2026-07-14T02:00:00.000Z",
      updatedAt: now,
    },
    {
      uid: "preview-member-pending",
      name: "이승인",
      phone: "010-9876-5432",
      email: "pending@example.com",
      cooperativeId: "NH-002",
      cooperativeName: "경기서부농협",
      position: "대리",
      duty: "총무",
      consents: { ...consents, marketing: false, email: false, kakao: false },
      role: "member",
      status: "pending_cooperative_review",
      createdAt: yesterday,
      updatedAt: yesterday,
    },
    {
      uid: "preview-admin",
      name: "박운영",
      phone: "010-0000-0000",
      email: "admin@example.com",
      position: "운영자",
      duty: "슈퍼관리자",
      consents,
      role: "admin",
      status: "active",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: now,
    },
  ],
  requests: [
    {
      id: "preview-request-1",
      uid: "preview-member-active",
      userEmail: "member@example.com",
      userName: "김농협",
      cooperativeId: "NH-001",
      cooperativeName: "서울중앙농협",
      subject: "법인세 신고 검토 요청",
      visibility: "ORG_ONLY",
      message: "법인세 신고 전 검토가 필요한 항목을 확인해 주세요.",
      attachmentNames: [],
      consent: true,
      marketingConsent: true,
      status: "ANSWERED",
      internalCategory: "세무",
      adminTags: ["박운영"],
      requestNumber: "NH-2026-0719",
      createdAt: yesterday,
      updatedAt: now,
    },
    {
      id: "preview-request-2",
      uid: "preview-member-pending",
      userEmail: "pending@example.com",
      userName: "이승인",
      cooperativeId: "NH-002",
      cooperativeName: "경기서부농협",
      subject: "노무 규정 개정 문의",
      visibility: "PRIVATE",
      message: "취업규칙 개정 절차를 상담받고 싶습니다.",
      attachmentNames: [],
      consent: true,
      marketingConsent: false,
      status: "SUBMITTED",
      requestNumber: "NH-2026-0720",
      createdAt: now,
      updatedAt: now,
    },
  ],
  answers: [
    {
      id: "preview-answer-1",
      requestId: "preview-request-1",
      body: "신고 전 확인해야 할 주요 항목과 준비 자료를 안내드립니다.",
      pointCost: 3000,
      status: "ANSWER_READY",
      createdBy: "preview-admin",
      createdByEmail: "admin@example.com",
      createdAt: now,
      updatedAt: now,
    },
  ],
  answerViews: [],
  ratings: [
    {
      id: "preview-rating-1",
      requestId: "preview-request-1",
      answerId: "preview-answer-1",
      uid: "preview-member-active",
      score: 5,
      helpful: true,
      comment: "필요한 내용을 빠르게 확인했습니다.",
      createdAt: now,
      updatedAt: now,
    },
  ],
  organizations: [
    {
      cooperativeId: "NH-001",
      cooperativeName: "서울중앙농협",
      walletBalance: 127000,
      users: ["preview-member-active"],
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: now,
    },
    {
      cooperativeId: "NH-002",
      cooperativeName: "경기서부농협",
      walletBalance: 50000,
      users: ["preview-member-pending"],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: yesterday,
    },
  ],
  ledger: [
    {
      id: "preview-ledger-1",
      cooperativeId: "NH-001",
      userId: "preview-member-active",
      event: "answer_view",
      points: -3000,
      balanceAfter: 127000,
      reason: "전문가 답변 열람",
      createdAt: now,
    },
  ],
  pointTransactions: [
    {
      id: "preview-transaction-1",
      cooperativeId: "NH-001",
      user_id: "preview-member-active",
      type: "question_answer_usage",
      amount: -3000,
      balance_before: 130000,
      balance_after: 127000,
      reason: "전문가 답변 열람",
      createdAt: now,
    },
  ],
  auditLogs: [
    {
      id: "preview-audit-1",
      actorUid: "preview-admin",
      actorEmail: "admin@example.com",
      action: "answer.upserted",
      targetType: "answer",
      targetId: "preview-answer-1",
      metadata: { requestId: "preview-request-1" },
      createdAt: now,
    },
  ],
  faqs: [
    {
      id: "preview-faq-1",
      question: "상담 답변은 어디에서 확인하나요?",
      answer: "마이페이지 상담 내역에서 답변과 사용 포인트를 확인할 수 있습니다.",
      category: "문의 진행",
      isPublic: true,
      displayStatus: "published",
      order: 1,
      createdBy: "preview-admin",
      createdByEmail: "admin@example.com",
      updatedBy: "preview-admin",
      updatedByEmail: "admin@example.com",
      createdAt: yesterday,
      updatedAt: now,
    },
  ],
};
