"use client";

import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCmsGlobals } from "@/components/cms/CmsGlobalsProvider";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { CmsGlobalContent } from "@/lib/cms/schemas";
import { ConsultRequestLink } from "./ConsultRequestLink";

function hashFromHref(href: string) {
  return href.startsWith("/#") ? href.slice(1) : null;
}

export function Topbar({
  siteIdentity: siteIdentityProp,
  header: headerProp,
  logoSrc,
}: {
  siteIdentity?: CmsGlobalContent;
  header?: CmsGlobalContent;
  logoSrc?: string;
} = {}) {
  const globals = useCmsGlobals();
  const siteIdentity = siteIdentityProp ?? globals.siteIdentity;
  const header = headerProp ?? globals.header;
  const logoMedia = siteIdentity.sections.find(
    (section) => section.id === "brand",
  )?.media;
  const resolvedLogoSrc =
    logoSrc ??
    (logoMedia && !logoMedia.deleted
      ? globals.assetUrls[logoMedia.assetId]
      : undefined) ??
    "/images/prego-logo.svg";
  const navigation = header.navigation.filter((item) => !item.deleted);
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const activeId = isHome ? active : null;

  useEffect(() => {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (user) => {
      setSignedIn(Boolean(user));
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!isHome) {
      return;
    }
    if (typeof window === "undefined") return;
    if (!("IntersectionObserver" in window)) return;

    const ids = navigation
      .map((item) => hashFromHref(item.href))
      .filter((hash): hash is string => Boolean(hash))
      .map((hash) => hash.replace("#", ""));
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );

    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [isHome, navigation]);

  const navHref = (href: string) => {
    const hash = hashFromHref(href);
    return hash && isHome ? hash : href;
  };

  const onAnchorClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    hash: string
  ) => {
    if (!isHome) {
      router.push(`/${hash}`);
      setOpen(false);
      return;
    }
    const target = document.querySelector(hash);
    if (!target) return;
    e.preventDefault();
    const topbar = document.querySelector(".topbar");
    const offset = topbar ? topbar.getBoundingClientRect().height : 0;
    const top =
      target.getBoundingClientRect().top + window.scrollY - offset + 1;
    window.scrollTo({ top, behavior: "smooth" });
    history.replaceState(null, "", hash);
    setOpen(false);
  };

  return (
    <header className="topbar" id="top">
      <div className="topbar__main">
        <Link
          className="brand"
          href="/"
          aria-label={siteIdentity.text.homeAriaLabel}
          onClick={() => setOpen(false)}
        >
          <span className="brand__logos">
            <span className="brand__logoText brand__logoText--nonghyup">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolvedLogoSrc}
                alt={siteIdentity.text.logoAlt}
                className="brand__logoImg"
              />
              <span className="brand__wordmark">
                <strong>{siteIdentity.text.serviceName}</strong>
                <small>{siteIdentity.text.poweredBy}</small>
              </span>
            </span>
          </span>
        </Link>

        <nav className="nav" aria-label={header.text.mainNavigationLabel}>
          {navigation.map((item) => {
            const hash = hashFromHref(item.href);
            return (
            <a
              key={item.id}
              href={navHref(item.href)}
              target={item.openInNewWindow ? "_blank" : undefined}
              rel={item.openInNewWindow ? "noreferrer" : undefined}
              className={
                (hash && activeId === hash.replace("#", "")) ||
                (!hash && pathname === item.href)
                  ? "is-active"
                  : undefined
              }
              onClick={(e) => {
                if (hash) {
                  onAnchorClick(e, hash);
                  return;
                }
                setOpen(false);
              }}
            >
              {item.label}
            </a>
            );
          })}
        </nav>

        {header.links.consult ? (
          <ConsultRequestLink
            className="cta cta--solid cta--sm"
            onClick={() => setOpen(false)}
            style={{ marginLeft: "12px" }}
          >
            {header.links.consult.label}
          </ConsultRequestLink>
        ) : null}
        {!authReady ? null : signedIn ? (
          <Link className="topbar__auth" href="/mypage" onClick={() => setOpen(false)}>
            {header.links.mypage?.label ?? "마이페이지"}
          </Link>
        ) : (
          <>
            <Link className="topbar__auth" href="/signup" onClick={() => setOpen(false)}>
              {header.links.signup?.label ?? "회원가입"}
            </Link>
            <Link className="topbar__auth" href="/login" onClick={() => setOpen(false)}>
              {header.links.login?.label ?? "로그인"}
            </Link>
          </>
        )}

        <button
          className="menu-btn"
          aria-label={
            open ? header.text.closeMenuLabel : header.text.openMenuLabel
          }
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <nav
        className={`nav-mobile${open ? " is-open" : ""}`}
        aria-label={header.text.mobileNavigationLabel}
      >
        {navigation.map((item) => {
          const hash = hashFromHref(item.href);
          return (
          <a
            key={item.id}
            href={navHref(item.href)}
            target={item.openInNewWindow ? "_blank" : undefined}
            rel={item.openInNewWindow ? "noreferrer" : undefined}
            onClick={(e) => {
              if (hash) {
                onAnchorClick(e, hash);
                return;
              }
              setOpen(false);
            }}
          >
            {item.label}
          </a>
          );
        })}
        {header.links.consult ? (
          <ConsultRequestLink
            className="nav-mobile__cta"
            onClick={() => setOpen(false)}
          >
            {header.links.consult.label}
          </ConsultRequestLink>
        ) : null}
        {!authReady ? null : signedIn ? (
          <Link
            className="nav-mobile__cta nav-mobile__cta--ghost"
            href="/mypage"
            onClick={() => setOpen(false)}
          >
            {header.links.mypage?.label ?? "마이페이지"}
          </Link>
        ) : (
          <>
            <Link
              className="nav-mobile__cta nav-mobile__cta--ghost"
              href="/signup"
              onClick={() => setOpen(false)}
            >
              {header.links.signup?.label ?? "회원가입"}
            </Link>
            <Link
              className="nav-mobile__cta nav-mobile__cta--ghost"
              href="/login"
              onClick={() => setOpen(false)}
            >
              {header.links.login?.label ?? "로그인"}
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
