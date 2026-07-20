"use client";

import { createContext, useContext, type ReactNode } from "react";
import { CMS_GLOBAL_DEFAULTS } from "@/lib/cms/defaults";
import type { CmsPublicGlobalsBundle } from "@/lib/cms/public-content";

const CmsGlobalsContext = createContext<CmsPublicGlobalsBundle>({
  siteIdentity: CMS_GLOBAL_DEFAULTS.siteIdentity,
  header: CMS_GLOBAL_DEFAULTS.header,
  footer: CMS_GLOBAL_DEFAULTS.footer,
  support: CMS_GLOBAL_DEFAULTS.support,
  assetUrls: {},
});

export function CmsGlobalsProvider({
  globals,
  children,
}: {
  globals: CmsPublicGlobalsBundle;
  children: ReactNode;
}) {
  return (
    <CmsGlobalsContext.Provider value={globals}>
      {children}
    </CmsGlobalsContext.Provider>
  );
}

export function useCmsGlobals() {
  return useContext(CmsGlobalsContext);
}
