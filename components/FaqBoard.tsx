"use client";

import { useMemo, useState } from "react";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";

export function FaqBoard({
  content,
  editing = false,
  selectedSectionId,
  onSelectSection,
}: { content: CmsPageContent } & CmsSectionEditingOptions) {
  const filtersCopy = getCmsSection(content, "public.faq", "filters");
  const listCopy = getCmsSection(content, "public.faq", "list");
  const faqs = useMemo(
    () =>
      listCopy.items
        .filter((item) => item.visible && !item.deleted)
        .map((item) => ({
          id: item.id,
          category: item.label ?? "",
          question: item.title,
          answer: item.description ?? "",
        })),
    [listCopy.items],
  );
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const editingOptions = { editing, selectedSectionId, onSelectSection };

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
    <section
      className="faq-board"
      aria-label={filtersCopy.text.boardAriaLabel}
    >
      <div
        {...cmsEditableSectionProps(
          filtersCopy,
          "inquiry-board__toolbar faq-board__toolbar",
          editingOptions,
        )}
      >
        <div>
          <strong>
            {filtersCopy.text.countPrefix}{" "}
            {filteredFaqs.length.toLocaleString("ko-KR")}
            {filtersCopy.text.countSuffix}
          </strong>
          <span>{filtersCopy.text.summary}</span>
        </div>
        <div className="faq-board__controls">
          <label>
            <span>{filtersCopy.text.categoryLabel}</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{filtersCopy.text.allCategoriesLabel}</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{filtersCopy.text.searchLabel}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={filtersCopy.text.searchPlaceholder}
            />
          </label>
        </div>
      </div>

      {filteredFaqs.length === 0 ? (
        <div
          {...cmsEditableSectionProps(
            listCopy,
            "inquiry-board__state",
            editingOptions,
          )}
        >
          {content.messages.empty}
        </div>
      ) : (
        <div
          {...cmsEditableSectionProps(
            listCopy,
            "faq-board__list",
            editingOptions,
          )}
          aria-label={listCopy.title}
        >
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
    </section>
  );
}
