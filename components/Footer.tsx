"use client";

import Link from "next/link";
import { useCmsGlobals } from "@/components/cms/CmsGlobalsProvider";
import {
  FOOTER_PORTAL_LINK_DEFAULTS,
  FOOTER_PORTAL_NAVIGATION_LABEL,
} from "@/lib/cms/footer-portal-links";
import type { CmsGlobalContent } from "@/lib/cms/schemas";
import { BrandMark } from "./BrandMark";

export function Footer({
  content,
  showPortalLinks = true,
}: {
  content?: CmsGlobalContent;
  showPortalLinks?: boolean;
} = {}) {
  const globals = useCmsGlobals();
  const footer = content ?? globals.footer;
  const customerLogin =
    footer.links.customerLogin ??
    FOOTER_PORTAL_LINK_DEFAULTS.customerLogin;
  const partnerLogin =
    footer.links.partnerLogin ??
    FOOTER_PORTAL_LINK_DEFAULTS.partnerLogin;
  const operatorLogin =
    footer.links.operatorLogin ??
    FOOTER_PORTAL_LINK_DEFAULTS.operatorLogin;
  const portalNavigationLabel =
    !footer.text.portalLoginNavigationLabel ||
    footer.text.portalLoginNavigationLabel === "제휴사 및 운영자 로그인"
      ? FOOTER_PORTAL_NAVIGATION_LABEL
      : footer.text.portalLoginNavigationLabel;
  return (
    <footer className="foot">
      <div className="foot__inner">
        <div className="foot__brand">
          <BrandMark size={36} />
          <div>
            <p className="foot__name">{footer.text.brandName}</p>
            <p className="foot__tag">
              {footer.text.brandTagline}
            </p>
          </div>
        </div>

        <div className="foot__cols">
          <div>
            <h5>{footer.text.operatorHeading}</h5>
            <p>
              {footer.text.operatorName}
              <br />
              <small>{footer.text.serviceLabel}</small>
            </p>
          </div>
          <div>
            <h5>{footer.text.policyHeading}</h5>
            <p>
              {footer.links.terms ? (
                <Link href={footer.links.terms.href}>{footer.links.terms.label}</Link>
              ) : null}
              {" · "}
              {footer.links.privacy ? (
                <Link href={footer.links.privacy.href}>
                  {footer.links.privacy.label}
                </Link>
              ) : null}
              <br />
              <small>{footer.text.privacyOfficer}</small>
            </p>
          </div>
          <div>
            <h5>{footer.text.contactHeading}</h5>
            <p>
              {footer.links.consult ? (
                <Link href={footer.links.consult.href}>
                  {footer.links.consult.label}
                </Link>
              ) : null}
              {" · "}
              {footer.links.inquiries ? (
                <Link href={footer.links.inquiries.href}>
                  {footer.links.inquiries.label}
                </Link>
              ) : null}
              <br />
              {footer.links.about ? (
                <Link href={footer.links.about.href}>{footer.links.about.label}</Link>
              ) : null}
              {" · "}
              {footer.links.signup ? (
                <Link href={footer.links.signup.href}>{footer.links.signup.label}</Link>
              ) : null}
              {" · "}
              {footer.links.mypage ? (
                <Link href={footer.links.mypage.href}>{footer.links.mypage.label}</Link>
              ) : null}
            </p>
          </div>
        </div>
      </div>

      <div className="foot__bar">
        <div className="foot__bar-copy">
          <p>{footer.text.copyright}</p>
          <p>{footer.text.brandTagline}</p>
        </div>
        {showPortalLinks ? (
          <nav
            className="foot__portal-links"
            aria-label={portalNavigationLabel}
          >
            <div className="foot__portal-links-row foot__portal-links-row--customer">
              <Link href={customerLogin.href}>{customerLogin.label}</Link>
            </div>
            <div className="foot__portal-links-row">
              <Link href={partnerLogin.href}>{partnerLogin.label}</Link>
              <span aria-hidden="true">|</span>
              <Link href={operatorLogin.href}>{operatorLogin.label}</Link>
            </div>
          </nav>
        ) : null}
      </div>
    </footer>
  );
}
