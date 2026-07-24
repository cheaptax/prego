import type { Metadata } from "next";
import { CmsSimplePage } from "@/components/CmsSimplePage";
import { Footer } from "@/components/Footer";
import { PortalAccessDeniedActions } from "@/components/PortalAccessDeniedActions";
import { Topbar } from "@/components/Topbar";
import { getPortalAccessDeniedNavigation } from "@/lib/auth/portal-page-guard";
import { isPortalType } from "@/lib/auth/portal";
import { cmsPageMetadata } from "@/lib/cms/metadata";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";
import { getCmsSection } from "@/lib/cms/runtime";

export async function generateMetadata(): Promise<Metadata> {
  const bundle = await loadPublishedCmsPage("auth.portalAccessDenied");
  return {
    ...cmsPageMetadata(bundle.content, bundle.assetUrls),
    robots: { index: false, follow: false },
  };
}

type Props = {
  searchParams?: Promise<{
    portal?: string | string[];
  }>;
};

export default async function PortalAccessDeniedPage({
  searchParams,
}: Props) {
  const params = await searchParams;
  const portalValue = Array.isArray(params?.portal)
    ? params?.portal[0]
    : params?.portal;
  const requestedPortal = isPortalType(portalValue)
    ? portalValue
    : "customer";
  const [{ content }, navigation] = await Promise.all([
    loadPublishedCmsPage("auth.portalAccessDenied"),
    getPortalAccessDeniedNavigation(requestedPortal),
  ]);
  const status = getCmsSection(
    content,
    "auth.portalAccessDenied",
    "status",
  );
  const actionLabels = new Map(
    status.actions.map((action) => [action.id, action.label]),
  );

  return (
    <>
      <Topbar />
      <CmsSimplePage
        pageKey="auth.portalAccessDenied"
        content={content}
        cardActions={
          <PortalAccessDeniedActions
            homePath={navigation.homePath}
            loginPath={navigation.loginPath}
            homeLabel={actionLabels.get("home") ?? "내 포털로 이동"}
            loginLabel={
              actionLabels.get("login") ?? "로그인 화면으로 이동"
            }
            logoutLabel={actionLabels.get("logout") ?? "로그아웃"}
            logoutFailedMessage={
              content.messages.logoutFailed ??
              "로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요."
            }
          />
        }
      />
      <Footer showPortalLinks={false} />
    </>
  );
}
