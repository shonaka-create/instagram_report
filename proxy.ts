import { NextRequest, NextResponse } from "next/server";

// サイト全体の簡易パスワード保護(社内向け運用のため)。Next.js 16のproxy規約。
// - 認証cookie: SITE_PASSWORD のSHA-256ハッシュ。/api/login が発行する
// - Cron(/api/cron)は Bearer CRON_SECRET で独自認証するため除外
// - SITE_PASSWORD 未設定時: 開発では素通し、本番では503(閉め忘れ防止)

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function proxy(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("SITE_PASSWORD が未設定です(Vercelの環境変数に設定してください)", {
      status: 503,
    });
  }

  const expected = await sha256Hex(password);
  const cookie = req.cookies.get("site_auth")?.value;
  if (cookie === expected) return NextResponse.next();

  // API には HTML リダイレクトではなく 401 を返す
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?from=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // 静的アセット・ログイン・Cronは対象外。それ以外(レポート含む)は全て保護
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|api/login|api/cron).*)",
  ],
};
