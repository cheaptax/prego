"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { logoutPortalSession } from "@/lib/auth/login-client";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { CMS_PUBLIC_GLOBAL_KEYS } from "@/lib/cms/constants";
import {
  createAdminConsoleCopy,
  type AdminConsoleCopy,
  type AdminConsoleMenuKey,
  type AdminConsolePageFilter,
} from "@/lib/cms/admin-console-content";
import { ADMIN_CONSOLE_PREVIEW_OVERVIEW } from "@/lib/cms/admin-console-preview";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import { getCmsSection } from "@/lib/cms/runtime";
import type {
  CmsAdminActivity,
  CmsAdminIssue,
  CmsAdminOverview,
  CmsAdminOverviewApiResponse,
  CmsAdminPageRow,
} from "@/lib/cms/admin-console-types";
import type { CmsPageContent } from "@/lib/cms/schemas";

type ConsoleState = "loading" | "ready" | "denied" | "error";
type MenuKey = AdminConsoleMenuKey;

function formatDate(
  value: string | null,
  missingLabel: string,
  includeTime = true,
) {
  if (!value) return missingLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return missingLabel;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : {}),
  }).format(date);
}

function ConsoleStatePanel({
  state,
  onRetry,
  copy,
}: {
  state: Exclude<ConsoleState, "ready">;
  onRetry: () => void;
  copy: AdminConsoleCopy;
}) {
  if (state === "loading") {
    return (
      <div className="cms-console-state" role="status" aria-live="polite">
        <span className="cms-console-spinner" aria-hidden="true" />
        <strong>{copy.message("loading")}</strong>
        <p>{copy.message("loadingDescription")}</p>
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="cms-console-state cms-console-state--denied" role="alert">
        <span className="cms-console-state__icon" aria-hidden="true">!</span>
        <strong>{copy.message("denied")}</strong>
        <p>{copy.message("deniedDescription")}</p>
        <Link className="cms-console-button cms-console-button--primary" href="/login">
          {copy.message("loginAgain")}
        </Link>
      </div>
    );
  }
  return (
    <div className="cms-console-state cms-console-state--error" role="alert">
      <span className="cms-console-state__icon" aria-hidden="true">!</span>
      <strong>{copy.message("genericError")}</strong>
      <p>{copy.message("genericErrorDescription")}</p>
      <button
        className="cms-console-button cms-console-button--primary"
        type="button"
        onClick={onRetry}
      >
        {copy.message("retry")}
      </button>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="cms-console-empty">
      <span aria-hidden="true">○</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function ActivityList({
  activities,
  emptyTitle,
  copy,
}: {
  activities: CmsAdminActivity[];
  emptyTitle: string;
  copy: AdminConsoleCopy;
}) {
  if (activities.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={copy.section("shell").text("activityEmptyDescription")}
      />
    );
  }
  return (
    <ul className="cms-console-activity">
      {activities.map((activity) => (
        <li key={activity.id}>
          <span
            className={`cms-console-activity__dot cms-console-activity__dot--${activity.tone}`}
            aria-hidden="true"
          />
          <div>
            <strong>{activity.target}</strong>
            <p>{activity.action}</p>
            <span>
              {activity.actor} ·{" "}
              {formatDate(
                activity.createdAt,
                copy.section("shell").text("recordMissing"),
              )}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function IssueList({
  issues,
  onOpen,
  copy,
}: {
  issues: CmsAdminIssue[];
  onOpen: (menu: CmsAdminIssue["targetMenu"]) => void;
  copy: AdminConsoleCopy;
}) {
  if (issues.length === 0) {
    return (
      <div className="cms-console-ok">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>{copy.section("dashboard").text("noIssuesTitle")}</strong>
          <p>{copy.section("dashboard").text("noIssuesDescription")}</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="cms-console-issues">
      {issues.map((issue) => (
        <li key={issue.id} className={`is-${issue.severity}`}>
          <span aria-hidden="true">{issue.severity === "error" ? "!" : "△"}</span>
          <div>
            <strong>{issue.title}</strong>
            <p>{issue.description}</p>
          </div>
          <button type="button" onClick={() => onOpen(issue.targetMenu)}>
            {copy.section("dashboard").text("issueReview")}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DashboardView({
  overview,
  onOpenMenu,
  copy,
}: {
  overview: CmsAdminOverview;
  onOpenMenu: (menu: MenuKey) => void;
  copy: AdminConsoleCopy;
}) {
  const dashboard = copy.section("dashboard");
  const stats = [
    {
      label: dashboard.item("editablePages").title,
      value: overview.counts.editablePages,
      unit: dashboard.item("editablePages").value,
      hint: dashboard.item("editablePages").description,
      tone: "blue",
      menu: "pages" as const,
    },
    {
      label: dashboard.item("unpublishedDrafts").title,
      value: overview.counts.unpublishedDrafts,
      unit: dashboard.item("unpublishedDrafts").value,
      hint: dashboard.item("unpublishedDrafts").description,
      tone: "amber",
      menu: "pages" as const,
    },
    {
      label: dashboard.item("recentlyModified").title,
      value: overview.counts.recentlyModified,
      unit: dashboard.item("recentlyModified").value,
      hint: dashboard.item("recentlyModified").description,
      tone: "violet",
      menu: "history" as const,
    },
    {
      label: dashboard.item("recentlyPublished").title,
      value: overview.counts.recentlyPublished,
      unit: dashboard.item("recentlyPublished").value,
      hint: dashboard.item("recentlyPublished").description,
      tone: "green",
      menu: "history" as const,
    },
    {
      label: dashboard.item("reviewRequired").title,
      value: overview.counts.reviewRequired,
      unit: dashboard.item("reviewRequired").value,
      hint: dashboard.item("reviewRequired").description,
      tone: "red",
      menu: "dashboard" as const,
    },
  ];

  return (
    <div className="cms-console-dashboard">
      <section
        className="cms-console-kpis"
        aria-label={dashboard.text("summaryAriaLabel")}
      >
        {stats.map((stat) => (
          <button
            className={`cms-console-kpi is-${stat.tone}`}
            type="button"
            key={stat.label}
            onClick={() => onOpenMenu(stat.menu)}
          >
            <span>{stat.label}</span>
            <strong>
              {stat.value}
              <small>{stat.unit}</small>
            </strong>
            <p>{stat.hint}</p>
          </button>
        ))}
      </section>

      <div className="cms-console-dashboard__grid">
        <section className="cms-console-panel">
          <header className="cms-console-panel__head">
            <div>
              <h2>{dashboard.text("recentChangesTitle")}</h2>
              <p>{dashboard.text("recentChangesDescription")}</p>
            </div>
            <button type="button" onClick={() => onOpenMenu("history")}>
              {dashboard.text("viewAll")}
            </button>
          </header>
          <ActivityList
            activities={overview.recentChanges.slice(0, 5)}
            emptyTitle={dashboard.text("recentChangesEmpty")}
            copy={copy}
          />
        </section>

        <section className="cms-console-panel">
          <header className="cms-console-panel__head">
            <div>
              <h2>{dashboard.text("recentPublishesTitle")}</h2>
              <p>{dashboard.text("recentPublishesDescription")}</p>
            </div>
            <button type="button" onClick={() => onOpenMenu("history")}>
              {dashboard.text("viewAll")}
            </button>
          </header>
          <ActivityList
            activities={overview.recentPublishes.slice(0, 5)}
            emptyTitle={dashboard.text("recentPublishesEmpty")}
            copy={copy}
          />
        </section>

        <section className="cms-console-panel cms-console-panel--wide">
          <header className="cms-console-panel__head">
            <div>
              <h2>{dashboard.text("issuesTitle")}</h2>
              <p>{dashboard.text("issuesDescription")}</p>
            </div>
            <span className="cms-console-count">{overview.issues.length}</span>
          </header>
          <IssueList
            issues={overview.issues}
            onOpen={(menu) => onOpenMenu(menu)}
            copy={copy}
          />
        </section>
      </div>
    </div>
  );
}

function PageDetails({
  page,
  onClose,
  onPreview,
  copy,
  previewMode,
}: {
  page: CmsAdminPageRow;
  onClose: () => void;
  onPreview: (page: CmsAdminPageRow) => void;
  copy: AdminConsoleCopy;
  previewMode: boolean;
}) {
  const dialog = copy.section("pageInfoDialog");
  return (
    <aside
      className="cms-console-detail"
      aria-labelledby="cms-page-detail-title"
    >
      <header>
        <div>
          <span>{dialog.text("eyebrow")}</span>
          <h2 id="cms-page-detail-title">{page.name}</h2>
          <p>{page.description}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={dialog.text("closeAriaLabel")}
        >
          ×
        </button>
      </header>
      <div className="cms-console-detail__summary">
        <div>
          <span>{dialog.text("addressLabel")}</span>
          <strong>{page.url}</strong>
        </div>
        <div>
          <span>{dialog.text("audienceLabel")}</span>
          <strong>{page.audienceLabel}</strong>
        </div>
        <div>
          <span>{dialog.text("statusLabel")}</span>
          <strong>{page.statusLabel}</strong>
        </div>
      </div>
      <section>
        <div className="cms-console-section-title">
          <div>
            <h3>{dialog.text("sectionsTitle")}</h3>
            <p>{dialog.text("sectionsDescription")}</p>
          </div>
          <span>
            {page.sections.length}
            {dialog.text("sectionCountSuffix")}
          </span>
        </div>
        <ul className="cms-console-section-list">
          {page.sections.map((section, index) => (
            <li key={`${page.id}-${section.name}-${index}`}>
              <span className="cms-console-section-list__number" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <strong>{section.name}</strong>
                <p>
                  {section.visible
                    ? dialog.text("visible")
                    : dialog.text("hidden")}
                  {section.itemCount > 0
                    ? ` · ${dialog.text("itemCountPrefix")} ${section.itemCount}${dialog.text("itemCountSuffix")}`
                    : ""}
                </p>
              </div>
              {section.protected ? (
                <span>{dialog.text("required")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <details className="cms-console-advanced">
        <summary>{dialog.text("advanced")}</summary>
        <dl>
          <div>
            <dt>{dialog.text("draftVersion")}</dt>
            <dd>{page.draftVersion ?? dialog.text("none")}</dd>
          </div>
          <div>
            <dt>{dialog.text("publishedVersion")}</dt>
            <dd>{page.publishedVersion ?? dialog.text("none")}</dd>
          </div>
        </dl>
      </details>
      <div className="cms-console-notice">
        <strong>{dialog.text("safetyTitle")}</strong>
        <p>{dialog.text("safetyDescription")}</p>
      </div>
      <footer>
        <button
          className="cms-console-button"
          type="button"
          onClick={() => onPreview(page)}
          disabled={!page.previewUrl || previewMode}
        >
          {dialog.text("preview")}
        </button>
        {previewMode ? (
          <button
            className="cms-console-button cms-console-button--primary"
            type="button"
            disabled
          >
            {dialog.text("openEditor")}
          </button>
        ) : (
          <Link
            className="cms-console-button cms-console-button--primary"
            href={`/admin/pages/${encodeURIComponent(page.id)}`}
          >
            {dialog.text("openEditor")}
          </Link>
        )}
      </footer>
    </aside>
  );
}

function PagesView({
  overview,
  onPublish,
  copy,
  previewMode,
}: {
  overview: CmsAdminOverview;
  onPublish: (page: CmsAdminPageRow) => void;
  copy: AdminConsoleCopy;
  previewMode: boolean;
}) {
  const pages = copy.section("pages");
  const [query, setQuery] = useState("");
  const [category, setCategory] =
    useState<AdminConsolePageFilter>("all");
  const [selectedPageId, setSelectedPageId] =
    useState<CmsAdminPageRow["id"] | null>(null);
  const selectedPage =
    overview.pages.find((page) => page.id === selectedPageId) ?? null;
  const filteredPages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return overview.pages.filter((page) => {
      const matchesCategory =
        category === "all" || page.category === category;
      const matchesQuery =
        !normalizedQuery ||
        [page.name, page.description, page.url, page.audienceLabel]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, overview.pages, query]);

  const preview = useCallback((page: CmsAdminPageRow) => {
    if (!page.previewUrl || previewMode) return;
    window.open(page.previewUrl, "_blank", "noopener,noreferrer");
  }, [previewMode]);

  return (
    <div className={`cms-console-pages${selectedPage ? " has-detail" : ""}`}>
      <section className="cms-console-panel cms-console-page-list">
        <div className="cms-console-toolbar">
          <label className="cms-console-search">
            <span className="sr-only">{pages.text("searchAriaLabel")}</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={pages.text("searchPlaceholder")}
            />
          </label>
          <label className="cms-console-filter">
            <span className="sr-only">{pages.text("filterAriaLabel")}</span>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as AdminConsolePageFilter)
              }
            >
              {copy.pageFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <span className="cms-console-toolbar__count">
            {filteredPages.length}
            {pages.text("countSuffix")}
          </span>
        </div>

        {filteredPages.length === 0 ? (
          <EmptyState
            title={pages.text("emptyTitle")}
            description={pages.text("emptyDescription")}
          />
        ) : (
          <div className="cms-console-page-cards">
            {filteredPages.map((page) => (
              <article className="cms-console-page-card" key={page.id}>
                <button
                  className="cms-console-page-card__preview"
                  type="button"
                  onClick={() => setSelectedPageId(page.id)}
                  aria-label={`${page.name} ${pages.text("detailsAriaSuffix")}`}
                >
                  <span className="cms-console-page-card__browser">
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>{page.name}</strong>
                  <span>{page.description}</span>
                </button>
                <div className="cms-console-page-card__body">
                  <div className="cms-console-page-card__head">
                    <div>
                      <span>{page.categoryLabel}</span>
                      <h2>{page.name}</h2>
                      <code>{page.url}</code>
                    </div>
                    <span className={`cms-console-status is-${page.status}`}>
                      {page.statusLabel}
                    </span>
                  </div>
                  <dl className="cms-console-page-card__meta">
                    <div>
                      <dt>{pages.text("audienceLabel")}</dt>
                      <dd>{page.audienceLabel}</dd>
                    </div>
                    <div>
                      <dt>{pages.text("modifiedLabel")}</dt>
                      <dd>
                        {page.modifiedBy}
                        <small>
                          {formatDate(
                            page.modifiedAt,
                            copy.section("shell").text("recordMissing"),
                            false,
                          )}
                        </small>
                      </dd>
                    </div>
                  </dl>
                  <div className="cms-console-page-card__actions">
                    {previewMode ? (
                      <button className="cms-console-button" type="button" disabled>
                        {pages.text("edit")}
                      </button>
                    ) : (
                      <Link
                        className="cms-console-button"
                        href={`/admin/pages/${encodeURIComponent(page.id)}`}
                      >
                        {pages.text("edit")}
                      </Link>
                    )}
                    <button
                      className="cms-console-button"
                      type="button"
                      onClick={() => preview(page)}
                      disabled={!page.previewUrl || previewMode}
                    >
                      {pages.text("preview")}
                    </button>
                    <button
                      className="cms-console-button cms-console-button--primary"
                      type="button"
                      onClick={() => onPublish(page)}
                      disabled={
                        previewMode ||
                        !page.hasUnpublishedChanges ||
                        !page.draftVersion
                      }
                      title={
                        page.hasUnpublishedChanges
                          ? pages.text("publishAvailableTitle")
                          : pages.text("publishUnavailableTitle")
                      }
                    >
                      {pages.text("publish")}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {selectedPage ? (
        <PageDetails
          page={selectedPage}
          onClose={() => setSelectedPageId(null)}
          onPreview={preview}
          copy={copy}
          previewMode={previewMode}
        />
      ) : null}
    </div>
  );
}

function GlobalsView({
  overview,
  copy,
  previewMode,
}: {
  overview: CmsAdminOverview;
  copy: AdminConsoleCopy;
  previewMode: boolean;
}) {
  const commonAreas = copy.section("commonAreas");
  return (
    <div className="cms-console-common-grid">
      {overview.commonAreas.map((area) => (
        <article className="cms-console-common-card" key={area.id}>
          <div className="cms-console-common-card__icon" aria-hidden="true">
            {area.name.slice(0, 1)}
          </div>
          <div className="cms-console-common-card__content">
            <div>
              <span>{area.affectedArea}</span>
              <h2>{area.name}</h2>
              <p>{area.description}</p>
            </div>
            <dl>
              <div>
                <dt>{commonAreas.text("statusLabel")}</dt>
                <dd>
                  <span className={`cms-console-status is-${area.status}`}>
                    {area.statusLabel}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{commonAreas.text("modifiedLabel")}</dt>
                <dd>
                  {area.modifiedBy} ·{" "}
                  {formatDate(
                    area.modifiedAt,
                    copy.section("shell").text("recordMissing"),
                    false,
                  )}
                </dd>
              </div>
            </dl>
            {(CMS_PUBLIC_GLOBAL_KEYS as readonly string[]).includes(area.id) &&
            !previewMode ? (
              <Link
                className="cms-console-button"
                href={`/admin/globals/${area.id}`}
              >
                {commonAreas.text("edit")}
              </Link>
            ) : (
              <button className="cms-console-button" type="button" disabled>
                {previewMode
                  ? commonAreas.text("edit")
                  : commonAreas.text("comingSoon")}
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function DesignView({
  overview,
  copy,
}: {
  overview: CmsAdminOverview;
  copy: AdminConsoleCopy;
}) {
  const design = copy.section("design");
  const settings = [
    {
      label: design.item("palette").title,
      value: overview.design.paletteLabel,
      description: design.item("palette").description,
      sample: <span className={`cms-console-palette is-${overview.design.palette}`} />,
    },
    {
      label: design.item("textScale").title,
      value: overview.design.textScaleLabel,
      description: design.item("textScale").description,
      sample: <strong className={`cms-console-type-sample is-${overview.design.textScale}`}>{design.text("sampleText")}</strong>,
    },
    {
      label: design.item("spacing").title,
      value: overview.design.spacingLabel,
      description: design.item("spacing").description,
      sample: <span className={`cms-console-spacing-sample is-${overview.design.spacing}`}><i /><i /><i /></span>,
    },
    {
      label: design.item("radius").title,
      value: overview.design.radiusLabel,
      description: design.item("radius").description,
      sample: <span className={`cms-console-radius-sample is-${overview.design.radius}`} />,
    },
    {
      label: design.item("alignment").title,
      value: overview.design.alignmentLabel,
      description: design.item("alignment").description,
      sample: <span className={`cms-console-align-sample is-${overview.design.alignment}`}><i /><i /><i /></span>,
    },
  ];
  return (
    <div className="cms-console-design">
      <div className="cms-console-callout">
        <span aria-hidden="true">i</span>
        <div>
          <strong>{design.text("calloutTitle")}</strong>
          <p>{design.text("calloutDescription")}</p>
        </div>
        <span>{overview.design.sourceLabel}</span>
      </div>
      <div className="cms-console-design-grid">
        {settings.map((setting) => (
          <article className="cms-console-design-card" key={setting.label}>
            <div className="cms-console-design-card__sample" aria-hidden="true">
              {setting.sample}
            </div>
            <div>
              <span>{setting.label}</span>
              <h2>{setting.value}</h2>
              <p>{setting.description}</p>
            </div>
            <button className="cms-console-button" type="button" disabled>
              {design.text("change")}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function AssetsView({
  overview,
  copy,
}: {
  overview: CmsAdminOverview;
  copy: AdminConsoleCopy;
}) {
  const assets = copy.section("assets");
  return (
    <section className="cms-console-panel">
      <header className="cms-console-panel__head cms-console-panel__head--stack-mobile">
        <div>
          <h2>{assets.text("listTitle")}</h2>
          <p>{assets.text("listDescription")}</p>
        </div>
        <button className="cms-console-button cms-console-button--primary" type="button" disabled>
          {assets.text("add")}
        </button>
      </header>
      {overview.assets.length === 0 ? (
        <EmptyState
          title={assets.text("emptyTitle")}
          description={assets.text("emptyDescription")}
        />
      ) : (
        <div className="cms-console-assets">
          {overview.assets.map((asset) => (
            <article key={asset.id}>
              <div className="cms-console-assets__thumb" aria-hidden="true">
                {asset.kind === assets.text("pdfKind")
                  ? assets.text("pdfBadge")
                  : assets.text("imageBadge")}
              </div>
              <div>
                <h2>{asset.name}</h2>
                <p>{asset.alt}</p>
                <span>
                  {asset.kind} · {asset.sizeLabel}
                </span>
              </div>
              <dl>
                <div>
                  <dt>{assets.text("statusLabel")}</dt>
                  <dd>{asset.statusLabel}</dd>
                </div>
                <div>
                  <dt>{assets.text("modifiedLabel")}</dt>
                  <dd>
                    {asset.updatedBy} ·{" "}
                    {formatDate(
                      asset.updatedAt,
                      copy.section("shell").text("recordMissing"),
                      false,
                    )}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryView({
  overview,
  copy,
}: {
  overview: CmsAdminOverview;
  copy: AdminConsoleCopy;
}) {
  const history = copy.section("history");
  const activities = [...overview.recentChanges, ...overview.recentPublishes]
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="cms-console-panel">
      <header className="cms-console-panel__head">
        <div>
          <h2>{history.text("listTitle")}</h2>
          <p>{history.text("listDescription")}</p>
        </div>
        <span className="cms-console-count">{activities.length}</span>
      </header>
      <ActivityList
        activities={activities}
        emptyTitle={history.text("empty")}
        copy={copy}
      />
    </section>
  );
}

function PublishDialog({
  page,
  submitting,
  onCancel,
  onConfirm,
  copy,
}: {
  page: CmsAdminPageRow;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  copy: AdminConsoleCopy;
}) {
  const dialog = copy.section("publishDialog");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="cms-console-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cms-publish-title"
        aria-describedby="cms-publish-description"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting) onCancel();
          if (event.key === "Tab") {
            const first = cancelRef.current;
            const last = confirmRef.current;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <span className="cms-console-modal__icon" aria-hidden="true">↑</span>
        <h2 id="cms-publish-title">
          {page.name}
          {dialog.text("titleSuffix")}
        </h2>
        <p id="cms-publish-description">{dialog.text("description")}</p>
        <div className="cms-console-impact">
          <span>{dialog.text("impactLabel")}</span>
          <strong>{page.name}</strong>
          <code>{page.url}</code>
        </div>
        <div className="cms-console-modal__actions">
          <button
            ref={cancelRef}
            className="cms-console-button"
            type="button"
            onClick={onCancel}
            disabled={submitting}
          >
            {dialog.text("cancel")}
          </button>
          <button
            ref={confirmRef}
            className="cms-console-button cms-console-button--primary"
            type="button"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting
              ? dialog.text("publishing")
              : dialog.text("confirm")}
          </button>
        </div>
      </section>
    </div>
  );
}

export function CmsAdminConsole({
  content,
  previewMode = false,
  canManageTestData = false,
  editing = false,
  selectedSectionId,
  onSelectSection,
}: {
  content: CmsPageContent;
  previewMode?: boolean;
  canManageTestData?: boolean;
} & CmsSectionEditingOptions) {
  const router = useRouter();
  const copy = useMemo(() => createAdminConsoleCopy(content), [content]);
  const [state, setState] = useState<ConsoleState>(
    previewMode ? "ready" : "loading",
  );
  const [activeMenu, setActiveMenu] = useState<MenuKey>("dashboard");
  const [overview, setOverview] = useState<CmsAdminOverview | null>(
    previewMode ? ADMIN_CONSOLE_PREVIEW_OVERVIEW : null,
  );
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [publishTarget, setPublishTarget] = useState<CmsAdminPageRow | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const fetchOverview = useCallback(async (user: User) => {
    const token = await user.getIdToken();
    const response = await fetch("/api/admin/cms/overview", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as
      | CmsAdminOverviewApiResponse
      | null;
    if (response.status === 401 || response.status === 403) {
      throw new Error("permission_denied");
    }
    if (!response.ok || !data?.ok) {
      throw new Error("overview_unavailable");
    }
    setOverview(data.overview);
  }, []);

  const boot = useCallback(
    async (user: User) => {
      setState("loading");
      try {
        const tokenResult = await user.getIdTokenResult(true);
        if (tokenResult.claims.admin !== true) {
          setState("denied");
          return;
        }
        await fetchOverview(user);
        setState("ready");
      } catch (error) {
        setState(
          error instanceof Error && error.message === "permission_denied"
            ? "denied"
            : "error",
        );
      }
    },
    [fetchOverview],
  );

  useEffect(() => {
    if (previewMode) return undefined;
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        setCurrentUser(null);
        router.replace("/admin/login");
        return;
      }
      setCurrentUser(user);
      void boot(user);
    });
    return unsubscribe;
  }, [boot, previewMode, router]);

  const refresh = useCallback(async () => {
    if (!currentUser || previewMode) return;
    setRefreshing(true);
    setMessage(null);
    try {
      await fetchOverview(currentUser);
      setMessage({ tone: "info", text: copy.message("refreshed") });
    } catch {
      setMessage({
        tone: "error",
        text: copy.message("refreshFailed"),
      });
    } finally {
      setRefreshing(false);
    }
  }, [copy, currentUser, fetchOverview, previewMode]);

  const publish = useCallback(async () => {
    if (previewMode || !currentUser || !publishTarget?.draftVersion) return;
    setPublishing(true);
    setMessage(null);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(
        `/api/admin/cms/pages/${encodeURIComponent(publishTarget.id)}/publish`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedDraftVersion: publishTarget.draftVersion,
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        if (response.status === 409) throw new Error("conflict");
        throw new Error("publish_failed");
      }
      setPublishTarget(null);
      await fetchOverview(currentUser);
      setMessage({
        tone: "success",
        text: `${publishTarget.name} ${copy.message("publishSuccessSuffix")}`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error && error.message === "conflict"
            ? copy.message("publishConflict")
            : copy.message("publishFailed"),
      });
      setPublishTarget(null);
    } finally {
      setPublishing(false);
    }
  }, [copy, currentUser, fetchOverview, previewMode, publishTarget]);

  if (state !== "ready" || !overview) {
    return (
      <main id="main" className="cms-console-shell cms-console-shell--state">
        <ConsoleStatePanel
          state={state === "ready" ? "error" : state}
          copy={copy}
          onRetry={() => {
            if (currentUser) void boot(currentUser);
          }}
        />
      </main>
    );
  }

  const activeSection = copy.section(
    activeMenu === "globals" ? "commonAreas" : activeMenu,
  );
  const shell = copy.section("shell");
  const editingOptions = { editing, selectedSectionId, onSelectSection };
  const shellSection = getCmsSection(content, "admin.console", "shell");
  const navigationSection = getCmsSection(
    content,
    "admin.console",
    "navigation",
  );
  const activeContentSection = getCmsSection(
    content,
    "admin.console",
    activeMenu === "globals" ? "commonAreas" : activeMenu,
  );
  return (
    <div className="cms-console-shell">
      <aside
        {...cmsEditableSectionProps(
          navigationSection,
          "cms-console-sidebar",
          editingOptions,
        )}
      >
        {previewMode ? (
          <div
            className="cms-console-brand"
            aria-label={shell.text("homeAriaLabel")}
          >
            <span aria-hidden="true">{shell.text("brandMark")}</span>
            <span>
              <strong>{shell.text("brandName")}</strong>
              <small>{shell.text("brandSubtitle")}</small>
            </span>
          </div>
        ) : (
        <Link
          className="cms-console-brand"
          href="/admin"
          aria-label={shell.text("homeAriaLabel")}
        >
          <span aria-hidden="true">{shell.text("brandMark")}</span>
          <span>
            <strong>{shell.text("brandName")}</strong>
            <small>{shell.text("brandSubtitle")}</small>
          </span>
        </Link>
        )}
        <nav
          className="cms-console-nav"
          aria-label={copy.section("navigation").text("ariaLabel")}
        >
          {copy.menus.map((item) => (
            <button
              type="button"
              key={item.key}
              className={activeMenu === item.key ? "is-active" : ""}
              onClick={() => setActiveMenu(item.key)}
              aria-current={activeMenu === item.key ? "page" : undefined}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="cms-console-sidebar__footer">
          {previewMode ? (
            <span>{shell.text("operationsLink")}</span>
          ) : (
            <Link href="/admin/operations">{shell.text("operationsLink")}</Link>
          )}
          {!previewMode && canManageTestData ? (
            <Link href="/admin/test-data">
              {shell.text("testDataManagementLink")}
            </Link>
          ) : null}
          <div className="cms-console-user">
            <span aria-hidden="true">
              {(currentUser?.displayName ??
                shell.text("userInitialFallback")).slice(0, 1)}
            </span>
            <div>
              <strong>
                {currentUser?.displayName ?? shell.text("userFallback")}
              </strong>
              <small>{shell.text("permissionLabel")}</small>
            </div>
          </div>
          <button
            type="button"
            disabled={previewMode}
            onClick={() =>
              previewMode
                ? undefined
                : logoutPortalSession().then(() =>
                    router.replace("/admin/login"),
                  )
            }
          >
            {shell.text("logout")}
          </button>
        </div>
      </aside>

      <main
        {...cmsEditableSectionProps(
          activeContentSection,
          "cms-console-main",
          editingOptions,
        )}
        id="main"
      >
        <header
          {...cmsEditableSectionProps(
            shellSection,
            "cms-console-topbar",
            editingOptions,
          )}
        >
          <div>
            <p>{shell.text("breadcrumb")}</p>
            <h1>{activeSection.title}</h1>
            <span>{activeSection.description}</span>
          </div>
          <div>
            <span>
              {shell.text("lastChecked")}{" "}
              {formatDate(
                overview.generatedAt,
                shell.text("recordMissing"),
              )}
            </span>
            <button
              className="cms-console-button"
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing || previewMode}
            >
              {refreshing
                ? shell.text("refreshing")
                : shell.text("refresh")}
            </button>
          </div>
        </header>

        {message ? (
          <div
            className={`cms-console-message is-${message.tone}`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            <span aria-hidden="true">
              {message.tone === "success" ? "✓" : message.tone === "error" ? "!" : "i"}
            </span>
            <p>{message.text}</p>
            <button
              type="button"
              onClick={() => setMessage(null)}
              aria-label={shell.text("noticeCloseAriaLabel")}
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="cms-console-content">
          {activeMenu === "dashboard" ? (
            <DashboardView
              overview={overview}
              onOpenMenu={setActiveMenu}
              copy={copy}
            />
          ) : null}
          {activeMenu === "pages" ? (
            <PagesView
              overview={overview}
              onPublish={setPublishTarget}
              copy={copy}
              previewMode={previewMode}
            />
          ) : null}
          {activeMenu === "globals" ? (
            <GlobalsView
              overview={overview}
              copy={copy}
              previewMode={previewMode}
            />
          ) : null}
          {activeMenu === "design" ? (
            <DesignView overview={overview} copy={copy} />
          ) : null}
          {activeMenu === "assets" ? (
            <AssetsView overview={overview} copy={copy} />
          ) : null}
          {activeMenu === "history" ? (
            <HistoryView overview={overview} copy={copy} />
          ) : null}
        </div>
      </main>

      {publishTarget ? (
        <PublishDialog
          page={publishTarget}
          submitting={publishing}
          onCancel={() => setPublishTarget(null)}
          onConfirm={() => void publish()}
          copy={copy}
        />
      ) : null}
      <CmsSupplementalSections
        pageKey="admin.console"
        content={content}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    </div>
  );
}
