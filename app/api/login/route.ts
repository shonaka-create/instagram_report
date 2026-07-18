import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

// パスワード照合 → 認証cookie発行。cookieはSITE_PASSWORDのSHA-256ハッシュで、
// middleware.ts が同じ計算で照合する(パスワード変更で全端末が自動失効する)。
export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const from = String(form.get("from") ?? "/reports");
  const expected = process.env.SITE_PASSWORD;

  if (!expected || password !== expected) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("from", from);
    return NextResponse.redirect(url, 303);
  }

  const hash = createHash("sha256").update(expected).digest("hex");
  // オープンリダイレクト防止: サイト内パスのみ許可
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/reports";
  const res = NextResponse.redirect(new URL(safeFrom, req.url), 303);
  res.cookies.set("site_auth", hash, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30日
    path: "/",
  });
  return res;
}
