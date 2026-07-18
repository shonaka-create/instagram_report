import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Puppeteer / Chromium はバンドルせず Node.js の require で解決させる
  // (Vercel 50MB 制限回避のため、chromium 本体は実行時に Storage から取得する)
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium-min"],
};

export default nextConfig;
