import Link from "next/link";
import type { PortalSitemapModel } from "@/lib/sitemap/portal-sitemap";

export type PortalSitemapCopy = {
  title: string;
  description: string;
  publicGroupTitle: string;
  roleGroupTitle: string;
  countPrefix: string;
  countSuffix: string;
  automaticUpdateLabel: string;
  openLabel: string;
};

export function PortalSitemap({
  sitemap,
  copy,
}: {
  sitemap: PortalSitemapModel;
  copy: PortalSitemapCopy;
}) {
  return (
    <section className="portal-sitemap" aria-labelledby="portal-sitemap-title">
      <header className="admin-card portal-sitemap__header">
        <div>
          <p className="admin-eyebrow">{copy.automaticUpdateLabel}</p>
          <h2 id="portal-sitemap-title">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <span className="admin-chip">
          {copy.countPrefix}
          {sitemap.routeCount}
          {copy.countSuffix}
        </span>
      </header>

      <div className="portal-sitemap__groups">
        {sitemap.groups.map((group) => (
          <section className="admin-card" key={group.id}>
            <header className="admin-card__head">
              <h3>
                {group.id === "public"
                  ? copy.publicGroupTitle
                  : copy.roleGroupTitle}
              </h3>
            </header>
            <ul className="portal-sitemap__list">
              {group.items.map((item) => (
                <li key={item.route}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <code>{item.route}</code>
                  </div>
                  <Link className="admin-btn admin-btn--ghost" href={item.route}>
                    {copy.openLabel}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
