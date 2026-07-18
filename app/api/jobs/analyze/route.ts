import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import {
  analyzeInsights,
  AnalysisPermanentError,
  isRetryableAnthropicError,
} from "@/lib/claude";
import { claimReport, markFailed, releaseReport, updateReport } from "@/lib/reports";
import { enqueueJob } from "@/lib/qstash";

// Claude呼び出しは時間がかかるため長めに確保(Fluid compute前提。旧Hobbyは60に下げる)
export const maxDuration = 300;

async function handler(req: Request) {
  const { reportId } = await req.json();

  const report = await claimReport(reportId, "fetched", "analyzing");
  if (!report) {
    return NextResponse.json({ skipped: true });
  }

  try {
    const reportJson = await analyzeInsights(
      report.raw_insights,
      report.period,
      report.clients.name
    );
    await updateReport(reportId, { report_json: reportJson, status: "analyzed" });
    await enqueueJob(
      "/api/jobs/publish-report",
      { reportId },
      `${report.client_id}-${report.period}-publish`
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AnalysisPermanentError) {
      await markFailed(reportId, `Claude分析: ${e.message}`);
      return NextResponse.json({ failed: true });
    }
    if (isRetryableAnthropicError(e)) {
      await releaseReport(reportId, "fetched");
      return NextResponse.json(
        { retry: true, message: String(e) },
        { status: 500 }
      );
    }
    // 分類できないエラーは failed にして人間に通知(error_message参照)
    await markFailed(reportId, `Claude分析(不明なエラー): ${String(e)}`);
    return NextResponse.json({ failed: true });
  }
}

// 署名検証はリクエスト時に初期化する(ビルド時に環境変数を要求させないため)
export async function POST(req: Request) {
  return verifySignatureAppRouter(handler)(req);
}
