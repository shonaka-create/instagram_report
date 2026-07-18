import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { updateReport } from "@/lib/reports";
import type { ReportRow } from "@/lib/reports";

// Chromiumの実行時取得+起動+レンダリングがあるため長めに確保
export const maxDuration = 300;

// @sparticuz/chromium-min: Chromium本体はバンドルに含めず、
// Supabase Storageの公開バケットに置いたbrotliパックを実行時に /tmp へ展開する。
// これでVercelの関数サイズ50MB制限に一切かからない。
async function renderPdf(reportUrl: string): Promise<Buffer> {
  const chromium = (await import("@sparticuz/chromium-min")).default;
  const puppeteer = (await import("puppeteer-core")).default;

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(process.env.CHROMIUM_PACK_URL!),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    // レポートページ自身がWebフォント(Noto Sans JP)を読み込むため、
    // networkidle0 + document.fonts.ready を待てば日本語が豆腐化しない
    await page.goto(reportUrl, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function handler(req: Request) {
  const { reportId } = await req.json();
  const db = supabaseAdmin();

  const { data } = await db
    .from("reports")
    .select("*, clients(name, wants_pdf)")
    .eq("id", reportId)
    .eq("status", "published")
    .maybeSingle();
  const report = data as ReportRow | null;

  if (!report) {
    return NextResponse.json({ skipped: true });
  }
  if (report.pdf_path) {
    // 既に生成済み(重複配送)
    return NextResponse.json({ skipped: true });
  }

  try {
    const pdf = await renderPdf(
      `${process.env.APP_URL}/reports/${report.access_token}?print=1`
    );

    const path = `${report.client_id}/${report.period}.pdf`;
    const { error } = await db.storage
      .from("reports")
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`Storage upload: ${error.message}`);

    await updateReport(reportId, { pdf_path: path });
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    // Chromium起動失敗などは大抵一時的なもの → 500でQStashにリトライさせる。
    // リトライが尽きてもHTMLレポートは公開済みなので納品自体は成立している。
    return NextResponse.json(
      { retry: true, message: String(e) },
      { status: 500 }
    );
  }
}

// 署名検証はリクエスト時に初期化する(ビルド時に環境変数を要求させないため)
export async function POST(req: Request) {
  return verifySignatureAppRouter(handler)(req);
}
