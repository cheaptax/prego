"use client";

import { About } from "@/components/About";
import { CaseStudies } from "@/components/CaseStudies";
import { Expertise } from "@/components/Expertise";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { HomePromoFloat } from "@/components/HomePromoFloat";
import { Process } from "@/components/Process";
import { Services } from "@/components/Services";
import { Topbar } from "@/components/Topbar";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import { useCmsGlobals } from "@/components/cms/CmsGlobalsProvider";
import { cmsSectionSelectionProps } from "@/lib/cms/editable-section";
import { getCmsSection } from "@/lib/cms/runtime";
import type { CmsPublicGlobals } from "@/lib/cms/public-content";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

function applyOverride(
  base: CmsPublicGlobals["header"],
  override: NonNullable<CmsPageContent["commonOverrides"]>["header"],
) {
  if (!override) return base;
  return {
    ...base,
    text: { ...base.text, ...override.text },
    links: { ...base.links, ...override.links },
    navigation: override.navigation ?? base.navigation,
  };
}

function HomeSection({
  section,
  assetUrls,
}: {
  section: CmsSection;
  assetUrls: Record<string, string>;
}) {
  switch (section.id) {
    case "hero":
      return (
        <Hero
          section={section}
          imageUrl={
            section.media && !section.media.deleted
              ? assetUrls[section.media.assetId]
              : undefined
          }
        />
      );
    case "about":
      return <About section={section} />;
    case "expertise":
      return <Expertise section={section} />;
    case "services":
      return <Services section={section} />;
    case "process":
      return <Process section={section} />;
    case "caseStudies":
      return <CaseStudies section={section} />;
    case "faqPreview":
      return <FAQ section={section} />;
    default:
      return null;
  }
}

export function HomePageRenderer({
  content,
  globals: globalsProp,
  editing = false,
  selectedSectionId,
  assetUrls = {},
  mainId = "main",
  onSelectSection,
}: {
  content: CmsPageContent;
  globals?: CmsPublicGlobals;
  editing?: boolean;
  selectedSectionId?: string;
  assetUrls?: Record<string, string>;
  mainId?: string | null;
  onSelectSection?: (sectionId: string) => void;
}) {
  const contextGlobals = useCmsGlobals();
  const baseGlobals = globalsProp ?? contextGlobals;
  const overrides = content.commonOverrides;
  const globals: CmsPublicGlobals = {
    siteIdentity: applyOverride(
      baseGlobals.siteIdentity,
      overrides?.siteIdentity,
    ),
    header: applyOverride(baseGlobals.header, overrides?.header),
    footer: applyOverride(baseGlobals.footer, overrides?.footer),
    support: applyOverride(baseGlobals.support, overrides?.support),
  };
  const combinedAssetUrls = {
    ...contextGlobals.assetUrls,
    ...assetUrls,
  };
  const logoMedia = globals.siteIdentity.sections.find(
    (section) => section.id === "brand",
  )?.media;
  return (
    <div className={`home-page-renderer${editing ? " is-editing" : ""}`}>
      {!overrides?.header?.hidden ? (
        <Topbar
          siteIdentity={globals.siteIdentity}
          header={globals.header}
          logoSrc={
            logoMedia && !logoMedia.deleted
              ? combinedAssetUrls[logoMedia.assetId]
              : undefined
          }
        />
      ) : null}
      <main id={mainId ?? undefined}>
        {content.sections.map((section) => {
          if (section.deleted && !editing) return null;
          if (!section.visible && !editing) return null;
          if (
            ![
              "hero",
              "about",
              "expertise",
              "services",
              "process",
              "caseStudies",
              "faqPreview",
            ].includes(section.id)
          ) {
            return null;
          }
          const rendered = (
            <HomeSection
              section={section}
              assetUrls={combinedAssetUrls}
              key={section.id}
            />
          );
          if (!editing) return rendered;
          const editableProps = cmsSectionSelectionProps(section, "", {
            editing,
            selectedSectionId,
            onSelectSection,
          });
          return (
            <div
              {...editableProps}
              key={section.id}
            >
              {rendered}
            </div>
          );
        })}
        <CmsSupplementalSections
          pageKey="home"
          content={content}
          assetUrls={combinedAssetUrls}
          editing={editing}
          selectedSectionId={selectedSectionId}
          onSelectSection={onSelectSection}
        />
      </main>
      {!overrides?.footer?.hidden ? (
        <Footer content={globals.footer} />
      ) : null}
      <HomePromoFloat
        section={getCmsSection(content, "home", "promoFloat")}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    </div>
  );
}
