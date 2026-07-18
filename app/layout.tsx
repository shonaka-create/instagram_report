import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// next/font がビルド時にサブセット化して self-host するため、
// サーバー側でのフォント埋め込み(PDF文字化けの元凶)が不要になる
const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Instagram 月次レポート",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body
        className={`${notoSansJP.className} bg-slate-100 text-slate-900 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
