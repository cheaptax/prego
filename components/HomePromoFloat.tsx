"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import {
  cmsSectionSelectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import type { CmsSection } from "@/lib/cms/schemas";

const DISMISS_KEY = "nh-home-promo-float-dismissed";

export function HomePromoFloat({
  section,
  editing = false,
  selectedSectionId,
  onSelectSection,
}: {
  section: CmsSection;
} & CmsSectionEditingOptions) {
  const [dismissed, setDismissed] = useState(false);
  const action = section.actions[0];

  useEffect(() => {
    if (editing) {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === section.id);
    } catch {
      setDismissed(false);
    }
  }, [editing, section.id]);

  if (section.deleted && !editing) return null;
  if (!section.visible && !editing) return null;
  if (!action) return null;
  if (dismissed && !editing) return null;

  const selectionProps = cmsSectionSelectionProps(section, "home-promo-float", {
    editing,
    selectedSectionId,
    onSelectSection,
  });

  function dismiss(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    try {
      sessionStorage.setItem(DISMISS_KEY, section.id);
    } catch {
      // Ignore storage failures and keep the banner dismissible for this view.
    }
    setDismissed(true);
  }

  return (
    <aside
      {...selectionProps}
      className={[
        "home-promo-float",
        selectionProps.className,
        !section.visible ? "is-hidden" : "",
        section.deleted ? "is-deleted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={section.title}
    >
      {!editing ? (
        <button
          className="home-promo-float__close"
          type="button"
          onClick={dismiss}
          aria-label="임시 안내 닫기"
        >
          ×
        </button>
      ) : null}
      <Link className="home-promo-float__link" href={action.href}>
        {section.eyebrow ? (
          <span className="home-promo-float__eyebrow">{section.eyebrow}</span>
        ) : null}
        <strong className="home-promo-float__title">{section.title}</strong>
        {section.description ? (
          <span className="home-promo-float__description">
            {section.description}
          </span>
        ) : null}
        <span className="home-promo-float__cta">{action.label}</span>
      </Link>
    </aside>
  );
}
