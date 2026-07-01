import type { Firestore } from "firebase-admin/firestore";
import type { FaqRecord } from "@/lib/firebase/schema";

export type PublicFaq = Pick<FaqRecord, "id" | "question" | "answer" | "category">;

export const DEFAULT_PUBLIC_FAQS: PublicFaq[] = [
  {
    id: "default-platform-role",
    question: "농협지원센터가 직접 세무·감사 업무를 수행하나요?",
    answer:
      "농협지원센터는 문의를 접수하고 업무 성격을 확인한 뒤 필요한 상담 또는 견적 절차를 안내하는 플랫폼입니다. 정식 업무는 별도 절차에 따라 진행됩니다.",
    category: "일반",
  },
  {
    id: "default-expert-flow",
    question: "전문가 연결은 어떻게 진행되나요?",
    answer:
      "문의 내용을 확인한 뒤 업무 성격에 맞는 전문가 상담 또는 견적 절차를 안내합니다. 필요한 자료는 고객 동의 후 전달됩니다.",
    category: "일반",
  },
  {
    id: "default-cooperative-signup",
    question: "회원가입할 때 농협은 어떻게 선택하나요?",
    answer:
      "회원가입 단계에서 지역과 농협명을 검색해 소속 농협을 선택합니다. 선택한 농협은 소속 확인 절차 후 마이페이지와 문의 관리에 사용됩니다.",
    category: "회원가입",
  },
  {
    id: "default-points",
    question: "포인트는 어디에서 확인하나요?",
    answer:
      "포인트 잔액과 사용 내역은 마이페이지에서 확인할 수 있습니다. 포인트는 플랫폼 내 답변 확인과 사후지원에 사용할 수 있습니다.",
    category: "포인트",
  },
];

export async function ensureDefaultFaqRecords(db: Firestore) {
  const snapshot = await db.collection("faqs").limit(1).get();
  if (!snapshot.empty) return;

  const now = new Date().toISOString();
  const batch = db.batch();
  DEFAULT_PUBLIC_FAQS.forEach((faq, index) => {
    const ref = db.collection("faqs").doc(faq.id);
    batch.set(ref, {
      ...faq,
      isPublic: true,
      displayStatus: "published",
      order: (index + 1) * 10,
      createdBy: "system",
      createdByEmail: "system",
      updatedBy: "system",
      updatedByEmail: "system",
      createdAt: now,
      updatedAt: now,
    } satisfies FaqRecord);
  });
  await batch.commit();
}
