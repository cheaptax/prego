import type { Metadata } from "next";
import { FaqBoard } from "@/components/FaqBoard";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";

export const metadata: Metadata = {
  title: "FAQ · 농협지원센터",
  description:
    "농협지원센터 FAQ 게시판에서 자주 묻는 질문을 유형별로 찾고 검색할 수 있습니다.",
};

export default function FaqPage() {
  return (
    <>
      <Topbar />
      <main id="main" className="inquiries-page">
        <section className="inquiries-hero">
          <span className="kicker">FAQ Board</span>
          <h1 className="inquiries-hero__title">
            <span className="inquiries-hero__line">자주 묻는 질문을</span>
            <span className="inquiries-hero__line">
              <em>유형별로</em> 확인하세요
            </span>
          </h1>
          <p>
            회원가입, 문의 진행, 포인트 등 자주 찾는 안내를 한곳에서 검색하고
            확인할 수 있습니다.
          </p>
        </section>
        <FaqBoard />
      </main>
      <Footer />
    </>
  );
}
