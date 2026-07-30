import { CMS_FEATURE_REGISTRY } from "@/lib/cms/feature-registry";
import {
  GENERATED_APP_PAGES,
  type GeneratedPortalAudience,
} from "@/lib/sitemap/generated-app-pages";

export type PortalSitemapRole = "customer" | "partner" | "admin";

export type PortalSitemapItem = {
  route: string;
  title: string;
  description: string;
  audience: GeneratedPortalAudience;
};

export type PortalSitemapGroup = {
  id: "public" | PortalSitemapRole;
  items: PortalSitemapItem[];
};

export type PortalSitemapModel = {
  role: PortalSitemapRole;
  groups: PortalSitemapGroup[];
  routeCount: number;
};

export type PortalSitemapOptions = {
  isSuperAdmin?: boolean;
};

const HIDDEN_ROUTES = new Set([
  "/login",
  "/signup",
  "/pending-approval",
  "/portal-access-denied",
  "/admin/login",
  "/partner/login",
]);

const ROUTE_PRESENTATION: Record<
  string,
  { title: string; description: string }
> = {
  "/admin/test-data": {
    title: "테스트 데이터 관리",
    description: "테스트 고객·문의 지표와 안전한 데이터 초기화를 관리합니다.",
  },
};

const registryByRoute = new Map(
  Object.values(CMS_FEATURE_REGISTRY).map((definition) => [
    definition.route,
    definition,
  ]),
);

function fallbackTitle(route: string) {
  if (route === "/") return "농협지원센터 홈";
  return route
    .split("/")
    .filter(Boolean)
    .at(-1)!
    .replaceAll("-", " ");
}

function presentationForRoute(route: string) {
  const registered = registryByRoute.get(route);
  if (registered) {
    return {
      title: registered.userFacingName,
      description: registered.defaultContent.seo.description,
    };
  }
  return (
    ROUTE_PRESENTATION[route] ?? {
      title: fallbackTitle(route),
      description: route,
    }
  );
}

export function buildPortalSitemap(
  role: PortalSitemapRole,
  options: PortalSitemapOptions = {},
): PortalSitemapModel {
  const allowedAudiences = new Set<GeneratedPortalAudience>(["public", role]);
  const items = GENERATED_APP_PAGES.flatMap((page): PortalSitemapItem[] => {
    if (
      page.dynamic ||
      HIDDEN_ROUTES.has(page.route) ||
      (page.route === "/admin/test-data" && !options.isSuperAdmin) ||
      !allowedAudiences.has(page.audience)
    ) {
      return [];
    }
    return [
      {
        route: page.route,
        ...presentationForRoute(page.route),
        audience: page.audience,
      },
    ];
  });
  const groups = (["public", role] as const).flatMap((audience) => {
    const groupItems = items
      .filter((item) => item.audience === audience)
      .sort((left, right) => left.route.localeCompare(right.route));
    return groupItems.length
      ? [{ id: audience, items: groupItems } satisfies PortalSitemapGroup]
      : [];
  });
  return {
    role,
    groups,
    routeCount: items.length,
  };
}
