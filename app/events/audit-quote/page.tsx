import type { Metadata } from "next";
import { Topbar } from "@/components/Topbar";
import { Footer } from "@/components/Footer";
import { AuditQuoteEventPage } from "@/components/AuditQuoteEventPage";
import { getPublicAuditQuoteConfig } from "@/lib/audit-quote/public-config";

export const metadata: Metadata = {
  title: "FY27 회계감사 견적 요청 · 농협지원센터",
  description:
    "지역농협 회계감사 견적을 한 번 요청으로 비교할 수 있도록 지원하는 FY27 임시 이벤트 페이지입니다.",
};

export default function AuditQuoteEventRoutePage() {
  const config = getPublicAuditQuoteConfig();

  return (
    <>
      <Topbar />
      <AuditQuoteEventPage config={config} />
      <Footer />
    </>
  );
}
