"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PUBLIC_FAQS, type PublicFaq } from "@/lib/default-faqs";

type FaqBoardResponse = {
  ok?: boolean;
  error?: string;
  faqs?: PublicFaq[];
};

export function FaqBoard() {
  const [faqs, setFaqs] = useState<PublicFaq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/faqs", { cache: "no-store" });
        const data = (await res.json()) as FaqBoardResponse;
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? "faq_load_failed");
        }
        if (!cancelled) setFaqs(data.faqs?.length ? data.faqs : DEFAULT_PUBLIC_FAQS);
      } catch {
        if (!cancelled) {
          setFaqs(DEFAULT_PUBLIC_FAQS);
          setError("FAQ 목록을 불러오지 못해 기본 안내를 표시합니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(
    () =>
      Array.from(new Set(faqs.map((faq) => faq.category).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "ko"),
      ),
    [faqs],
  );

  const filteredFaqs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return faqs.filter((faq) => {
      const matchesCategory = !category || faq.category === category;
      const matchesQuery =
        !normalizedQuery ||
        [faq.question, faq.answer, faq.category]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, faqs, query]);

  return (
    <section className="faq-board" aria-label="FAQ 게시판">
      <div className="inquiry-board__toolbar faq-board__toolbar">
        <div>
          <strong>FAQ {filteredFaqs.length.toLocaleString("ko-KR")}건</strong>
          <span>유형을 선택하거나 키워드를 검색해 필요한 안내를 빠르게 확인하세요.</span>
        </div>
        <div className="faq-board__controls">
          <label>
            <span>유형 선택</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">전체 유형</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>FAQ 검색</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="질문, 답변, 유형 검색"
            />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="inquiry-board__state">FAQ 목록을 불러오는 중입니다.</div>
      ) : (
        <>
          {error && <div className="inquiry-board__state inquiry-board__state--error">{error}</div>}
          {filteredFaqs.length === 0 ? (
            <div className="inquiry-board__state">조건에 맞는 FAQ가 없습니다.</div>
          ) : (
            <div className="faq-board__list">
              {filteredFaqs.map((faq, index) => (
                <details className="faq-board__row" key={faq.id} open={index === 0}>
                  <summary>
                    <span className="inquiry-chip inquiry-chip--org">{faq.category}</span>
                    <strong>{faq.question}</strong>
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
                  <div className="faq-board__answer">
                    {faq.answer.split(/\n+/).map((paragraph, paragraphIndex) => (
                      <p key={`${faq.id}-${paragraphIndex}`}>{paragraph}</p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
