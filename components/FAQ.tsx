"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PUBLIC_FAQS, type PublicFaq } from "@/lib/default-faqs";

export function FAQ() {
  const [faqs, setFaqs] = useState<PublicFaq[]>([]);
  const [loading, setLoading] = useState(true);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/faqs", { cache: "no-store" });
        const data = (await res.json()) as { ok?: boolean; faqs?: PublicFaq[] };
        if (!cancelled && res.ok && data.ok && data.faqs && data.faqs.length > 0) {
          setFaqs(data.faqs);
          setUsedFallback(false);
          return;
        }
      } catch {
        // fallback below
      }
      if (!cancelled) {
        setFaqs(DEFAULT_PUBLIC_FAQS);
        setUsedFallback(true);
      }
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => faqs, [faqs]);

  return (
    <section className="section" id="faq">
      <div className="section__head">
        <span className="kicker">FAQ</span>
        <h2 className="display">
          자주 받는 <em>질문</em>
        </h2>
        {usedFallback && !loading && (
          <p className="section__lede faq__notice">
            운영자가 등록한 FAQ가 준비 중입니다. 아래는 기본 안내입니다.
          </p>
        )}
      </div>

      {loading ? (
        <p className="faq__loading">FAQ를 불러오는 중입니다.</p>
      ) : (
        <>
          <div className="faq__list-head">
            <strong>FAQ 목록</strong>
            <Link className="faq__all-link" href="/faq">
              전체보기
            </Link>
          </div>
          <div className="faq">
            {items.map((faq, index) => (
              <details className="faq__item" key={faq.id} open={index === 0}>
                <summary>
                  <span className="faq__meta">
                    <span className="faq__category">{faq.category}</span>
                    <span className="faq__q">{faq.question}</span>
                  </span>
                  <span className="faq__chev" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 18 18">
                      <path
                        d="M5 7 L9 11 L13 7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                  </span>
                </summary>
                <div className="faq__a">
                  {faq.answer.split(/\n+/).map((paragraph, paragraphIndex) => (
                    <p key={`${faq.id}-${paragraphIndex}`}>{paragraph}</p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
