import type { Metadata, Viewport } from "next";
import { CmsGlobalsProvider } from "@/components/cms/CmsGlobalsProvider";
import { SupportWidget } from "@/components/SupportWidget";
import { loadPublicCmsGlobals } from "@/lib/cms/public-content";
import "./globals.css";

export const metadata: Metadata = {
  title: "농협지원센터 · 주식회사 프리고",
  description:
    "농협 대상 상담 접수·분류·전문가 연결 플랫폼. 세무·노무·감사·회계 일반 문의를 안전하게 분류하고 필요한 전문가에게 연결합니다.",
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='16' fill='%233182F6'/><path d='M20 42 L20 20 L30 38 L30 20' stroke='white' stroke-width='4' stroke-linecap='round' stroke-linejoin='round' fill='none'/><path d='M39 39 C39 31 46 28 50 22 C50 31 46 37 39 39 Z' fill='white' opacity='.9'/></svg>",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#3182F6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const globals = await loadPublicCmsGlobals();
  return (
    <html lang="ko">
      <head>
        <link
          rel="preload"
          href="/fonts/PretendardVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <a className="skip" href="#main">
          본문 바로가기
        </a>
        <CmsGlobalsProvider globals={globals}>
          {children}
          <SupportWidget />
        </CmsGlobalsProvider>
      </body>
    </html>
  );
}
