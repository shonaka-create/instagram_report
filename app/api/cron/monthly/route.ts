import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enqueueJob } from "@/lib/qstash";

export const dynamic = "force-dynamic";

// 前月を "YYYY-MM" で返す(月初実行なので対象は前月)
function previousPeriod(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Vercel Cron から月初に呼ばれるエントリポイント。
// クライアントごとに reports 行を作成し、ジョブチェーンの先頭をQStashへ投入する。
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const period = previousPeriod();
  const db = supabaseAdmin();

  const { data: clients, error } = await db
    .from("clients")
    .select("id, name")
    .eq("active", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enqueued: string[] = [];
  for (const client of clients ?? []) {
    // 同月の行が既にあれば作らない(Cronの再実行に対して冪等)
    await db
      .from("reports")
      .upsert(
        { client_id: client.id, period },
        { onConflict: "client_id,period", ignoreDuplicates: true }
      );

    const { data: report } = await db
      .from("reports")
      .select("id, status")
      .eq("client_id", client.id)
      .eq("period", period)
      .single();

    if (report && report.status === "queued") {
      await enqueueJob(
        "/api/jobs/fetch-insights",
        { reportId: report.id },
        `${client.id}-${period}-fetch`
      );
      enqueued.push(client.name);
    }
  }

  return NextResponse.json({ period, enqueued });
}
