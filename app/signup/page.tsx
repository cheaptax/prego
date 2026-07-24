import type { Metadata } from "next";
import { SignupPageRenderer } from "@/components/SignupPageRenderer";
import { TemporaryAccountActivationForm } from "@/components/TemporaryAccountActivationForm";
import { TemporaryMemberConversionForm } from "@/components/TemporaryMemberConversionForm";
import { Footer } from "@/components/Footer";
import { Topbar } from "@/components/Topbar";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";
import { requirePortalPageSession } from "@/lib/auth/portal-page-guard";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("auth.signup");
  return cmsPageMetadata(bundle.content, bundle.assetUrls);
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ activation?: string; complete?: string }>;
}) {
  const { content } = await loadPublishedCmsPage("auth.signup");
  const query = await searchParams;
  const activationToken = query.activation?.trim();
  const completingMembership = query.complete === "1";
  if (completingMembership) {
    const account = await requirePortalPageSession("customer", {
      allowQuoteOnlyCustomer: true,
    });
    if (account.customerAccessLevel !== "QUOTE_ONLY") {
      redirect("/mypage");
    }
  }
  return (
    <>
      <Topbar />
      {activationToken ? (
        <TemporaryAccountActivationForm
          content={content}
          token={activationToken}
        />
      ) : completingMembership ? (
        <TemporaryMemberConversionForm content={content} />
      ) : (
        <SignupPageRenderer content={content} />
      )}
      <Footer />
    </>
  );
}
