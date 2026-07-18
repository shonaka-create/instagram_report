import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { claimReport, updateReport } from "@/lib/reports";
import { enqueueJob } from "@/lib/qstash";

export const maxDuration = 60;

// 公開処理: statusをpublishedにして閲覧URLを確定させる。
// access_token はDB側で行作成時に発行済み(推測不能なUUID)。
// PDFはレポートの付属物なので、必要なクライアントのみ別ジョブで後追い生成する
// (PDF生成が失敗してもHTMLレポートの納品は成立する = graceful degradation)。
async function handler(req: Request) {
  const { reportId } = await req.json();

  const report = await claimReport(reportId, "analyzed", "publishing");
  if (!report) {
    return NextResponse.json({ skipped: true });
  }

  await updateReport(reportId, { status: "published" });

  if (report.clients.wants_pdf) {
    await enqueueJob(
      "/api/jobs/render-pdf",
      { reportId },
      `${report.client_id}-${report.period}-pdf`
    );
  }

  const url = `${process.env.APP_URL}/reports/${report.access_token}`;
  // TODO: ここでクライアントへのメール送信(Resend等)を行う場合は url を本文に載せる
  return NextResponse.json({ ok: true, url });
}

// 署名検証はリクエスト時に初期化する(ビルド時に環境変数を要求させないため)
export async function POST(req: Request) {
  return verifySignatureAppRouter(handler)(req);
}
