"use client";

import { useCmsGlobals } from "@/components/cms/CmsGlobalsProvider";
import type { CmsGlobalContent } from "@/lib/cms/schemas";

export function SupportWidget({
  content,
}: {
  content?: CmsGlobalContent;
}) {
  const globals = useCmsGlobals();
  const support = content ?? globals.support;
  const link = support.links.support;
  if (!link) return null;
  return (
    <a
      className="chat-fab"
      href={link.href}
      aria-label={support.text.ariaLabel || link.label}
      target={link.openInNewWindow ? "_blank" : undefined}
      rel={link.openInNewWindow ? "noreferrer" : undefined}
      title={support.text.title}
    >
      <svg width="34" height="34" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path
          d="M11 3C6.58 3 3 6.07 3 9.86c0 2.12 1.13 4.02 2.9 5.28l-.6 2.62c-.09.39.32.71.67.52l2.78-1.5c.72.17 1.48.26 2.25.26 4.42 0 8-3.07 8-6.86S15.42 3 11 3Z"
          fill="currentColor"
        />
        <path
          d="M7.8 10.1H14.2M7.8 7.9H12.6"
          stroke="#3182F6"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </a>
  );
}
