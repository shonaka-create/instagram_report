import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  fetchRawInsights,
  computeMetrics,
  type Metrics,
  type ModulesConfig,
} from "@/mcp-server/src/insights";

export const dynamic = "force-dynamic";
// Hobbyプランの関数上限は60秒。fetch+計算のみ(LLM呼び出しなし)なので
// クライアント数件なら十分。将来クライアントが増えたら分割 or Proへ。
export const maxDuration = 60;

// 前月を "YYYY-MM" で返す(月初実行なので対象は前月)
function previousPeriod(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Vercel Cron から月初に呼ばれる。全アクティブクライアントの前月データを
// 取得・指標計算して保存する(status: fetched)。分析(文章)はここでは行わない —
// 月次の分析はMCP経由でスキル(/instagram-monthly-report)から実行する。
// 取得・計算は mcp-server/src/insights.ts の単一実装を使うため、
// MCP経由で取得した場合と数値が食い違うことはない。
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const period = previousPeriod();
  const db = supabaseAdmin();

  const { data: clients, error } = await db
    .from("clients")
    .select("id, slug, name, ig_access_token, modules")
    .eq("active", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ client: string; ok: boolean; detail: string }> = [];
  for (const client of clients ?? []) {
    try {
      if (!client.ig_access_token) {
        results.push({
          client: client.slug ?? client.name,
          ok: false,
          detail: "igAccessToken未設定(upsert_clientで登録が必要)",
        });
        continue;
      }

      // 公開済みなら再取得しない(冪等)
      const { data: existing } = await db
        .from("reports")
        .select("id, status")
        .eq("client_id", client.id)
        .eq("period", period)
        .maybeSingle();
      if (existing?.status === "published") {
        results.push({
          client: client.slug ?? client.name,
          ok: true,
          detail: "公開済みのためスキップ",
        });
        continue;
      }

      const raw = await fetchRawInsights(client.ig_access_token, period);

      // 前月比のために前月metricsを参照
      const [y, m] = period.split("-").map(Number);
      const prevDate = new Date(Date.UTC(y, m - 2, 1));
      const prevPeriod = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;
      const { data: prevRow } = await db
        .from("reports")
        .select("metrics_json")
        .eq("client_id", client.id)
        .eq("period", prevPeriod)
        .maybeSingle();

      const metrics = computeMetrics(raw, {
        prevMetrics: (prevRow?.metrics_json as Metrics | null) ?? null,
        modules: (client.modules as ModulesConfig | null) ?? null,
      });

      const { error: upErr } = await db.from("reports").upsert(
        {
          client_id: client.id,
          period,
          raw_insights: raw,
          metrics_json: metrics,
          status: "fetched",
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id,period" }
      );
      if (upErr) throw new Error(upErr.message);

      results.push({
        client: client.slug ?? client.name,
        ok: true,
        detail: `${metrics.account.postCount}投稿を取得・計算済み`,
      });
    } catch (e) {
      // 1クライアントの失敗で他を止めない。error_messageに記録して続行
      await db.from("reports").upsert(
        {
          client_id: client.id,
          period,
          status: "failed",
          error_message: String(e).slice(0, 2000),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id,period" }
      );
      results.push({
        client: client.slug ?? client.name,
        ok: false,
        detail: String(e),
      });
    }
  }

  return NextResponse.json({ period, results });
}
