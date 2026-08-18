/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 blocks cross-origin access to /_next/* in dev. Local testing often
  // uses 127.0.0.1 while the server advertises localhost (and vice versa).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/audit-evaluations/*/reports": [
      "./node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf",
      "./node_modules/pretendard/dist/public/static/alternative/Pretendard-SemiBold.ttf",
      "./node_modules/pretendard/dist/public/static/alternative/Pretendard-Bold.ttf",
    ],
    "/api/admin/audit-evaluations/*/reports/*/regenerate": [
      "./node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf",
      "./node_modules/pretendard/dist/public/static/alternative/Pretendard-SemiBold.ttf",
      "./node_modules/pretendard/dist/public/static/alternative/Pretendard-Bold.ttf",
    ],
    "/api/admin/quote-screens/*/preview": [
      "./node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf",
      "./node_modules/pretendard/dist/public/static/alternative/Pretendard-SemiBold.ttf",
      "./node_modules/pretendard/dist/public/static/alternative/Pretendard-Bold.ttf",
      "./node_modules/@napi-rs/canvas/**",
    ],
    "/api/partner/quotes/*": [
      "./node_modules/@napi-rs/canvas/**",
    ],
    "/api/admin/audit-quotes/proxy-send": [
      "./node_modules/@napi-rs/canvas/**",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
