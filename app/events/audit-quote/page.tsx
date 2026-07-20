import type { Metadata } from "next";
import { Topbar } from "@/components/Topbar";
import { Footer } from "@/components/Footer";
import { AuditQuoteEventPage } from "@/components/AuditQuoteEventPage";
import { getPublicAuditQuoteConfig } from "@/lib/audit-quote/public-config";
import { loadPublishedAuditQuote } from "@/lib/cms/public-content";

export async function generateMetadata(): Promise<Metadata> {
  const { content } = await loadPublishedAuditQuote();
  return {
    title: content.seo.title,
    description: content.seo.description,
    robots: content.seo.indexable
      ? { index: true, follow: true }
      : { index: false, follow: false },
  };
}

export default async function AuditQuoteEventRoutePage() {
  const config = getPublicAuditQuoteConfig();
  const { content } = await loadPublishedAuditQuote();

  return (
    <>
      <Topbar />
      <AuditQuoteEventPage config={config} content={content} />
      <Footer />
    </>
  );
}
