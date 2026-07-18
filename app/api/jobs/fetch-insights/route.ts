import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { fetchMonthlyInsights, InstagramApiError } from "@/lib/instagram";
import { claimReport, markFailed, releaseReport, updateReport } from "@/lib/reports";
import { enqueueJob } from "@/lib/qstash";

export const maxDuration = 60;

async function handler(req: Request) {
  const { reportId } = await req.json();

  const report = await claimReport(reportId, "queued", "fetching");
  if (!report) {
    // 重複配送 or 既に処理済み — 200を返してリトライを止める
    return NextResponse.json({ skipped: true });
  }

  try {
    const raw = await fetchMonthlyInsights(
      report.clients.ig_user_id,
      report.clients.ig_access_token,
      report.period
    );
    await updateReport(reportId, { raw_insights: raw, status: "fetched" });
    await enqueueJob(
      "/api/jobs/analyze",
      { reportId },
      `${report.client_id}-${report.period}-analyze`
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof InstagramApiError && !e.retryable) {
      // トークン失効など。リトライしても無駄なので failed 確定
      await markFailed(reportId, `Instagram API: ${e.message} (code=${e.code})`);
      return NextResponse.json({ failed: true });
    }
    // レート制限・一時障害: statusを戻して500 → QStashが指数バックオフで再配送
    await releaseReport(reportId, "queued");
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
