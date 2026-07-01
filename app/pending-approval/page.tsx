import type { Metadata } from "next";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "가입 승인 대기 · 농협지원센터",
  description: "관리자가 가입 신청 정보를 확인한 뒤 농협지원센터 이용을 안내합니다.",
};

export default function PendingApprovalPage() {
  return (
    <>
      <Topbar />
      <main id="main" className="login-page">
        <section className="login-shell">
          <header className="login-head">
            <span className="login-head__eyebrow">
              <span className="dot" aria-hidden="true" />
              Approval pending
            </span>
            <h1 className="login-head__title">
              관리자가 가입 신청을
              <br />
              <em>빠르게 확인 중이에요</em>
            </h1>
            <p className="login-head__lede">
              가입 신청 정보와 소속 농협을 확인하고 있어요.
              확인이 끝나면 상담·견적 요청과 마이페이지를 바로 이용하실 수 있습니다.
            </p>
          </header>

          <div className="login-card">
            <span className="login-card__tag">가입 승인 대기</span>
            <h2 className="login-card__title">확인이 완료되면 다시 로그인해 주세요.</h2>
            <p className="login-card__lede">
              관리자가 빠르게 확인 후 승인해 드릴 예정이에요.
            </p>
            <Link className="login-card__primary" href="/login">
              로그인 화면으로 이동
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
