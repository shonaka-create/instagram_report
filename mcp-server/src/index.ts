#!/usr/bin/env node
/**
 * Instagram運用代行 MCPサーバー
 *
 * Claude Desktop / Claude Code から Tools として呼び出される:
 *  - list_clients:            登録クライアントの棚卸(トークン有無・観点設定つき)
 *  - upsert_client:           クライアントの追加・更新(オンボーディング用)
 *  - get_instagram_insights:  データ取得→サーバー計算済み指標+分析指針を返す
 *  - publish_report:          モデルが書いた「文章のみ」の分析を受け取り、
 *                             サーバー保存済みの数値とマージして専用URLを発行
 *
 * 数値安全設計: モデルは数値を一切計算・出力しない。数値の正本は
 * reports.metrics_json(insights.ts で計算)で、publish時に文章とマージされる。
 *
 * クライアント台帳の正本は Supabase clients テーブル(cron自動取得のため)。
 * ローカルの clients.json はトークンのフォールバックとして残す。
 *
 * 注意: stdioトランスポートではstdoutがプロトコル通信路なので、
 * ログは必ず console.error (stderr) に出すこと。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import {
  fetchRawInsights,
  computeMetrics,
  buildAnalysisGuidelines,
  MODULE_DEFS,
  REMOVABLE_SECTIONS,
  type Metrics,
  type ModulesConfig,
  type RawInsights,
} from "./insights.js";

// ---------------------------------------------------------------------------
// Supabase / クライアント台帳
// ---------------------------------------------------------------------------

function supabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です (mcp-server/.env)"
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

type ClientRow = {
  id: string;
  slug: string | null;
  name: string;
  ig_username: string | null;
  ig_access_token: string | null;
  brand_color: string;
  modules: ModulesConfig | null;
  active: boolean;
};

// レガシー: ローカル clients.json (トークンのフォールバック用に残す)
const here = path.dirname(fileURLToPath(import.meta.url));
function loadLocalClients(): Record<
  string,
  { name: string; igAccessToken?: string }
> {
  const file = process.env.CLIENTS_FILE ?? path.join(here, "..", "clients.json");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

async function getClientBySlug(
  db: SupabaseClient,
  slug: string
): Promise<ClientRow> {
  const { data, error } = await db
    .from("clients")
    .select("id, slug, name, ig_username, ig_access_token, brand_color, modules, active")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`clients検索エラー: ${error.message}`);

  if (data) return data as ClientRow;

  // DBに無ければ clients.json から自動移行(初回のみ)
  const local = loadLocalClients()[slug];
  if (!local) {
    const { data: all } = await db.from("clients").select("slug");
    throw new Error(
      `clientId "${slug}" は未登録です。登録済み: ${(all ?? [])
        .map((r) => r.slug)
        .filter(Boolean)
        .join(", ") || "(なし)"}。upsert_client で追加してください`
    );
  }
  const { data: created, error: insErr } = await db
    .from("clients")
    .insert({
      slug,
      name: local.name,
      ig_access_token: local.igAccessToken ?? null,
      active: true,
    })
    .select("id, slug, name, ig_username, ig_access_token, brand_color, modules, active")
    .single();
  if (insErr) throw new Error(`clients作成エラー: ${insErr.message}`);
  console.error(`clients.json から "${slug}" をDBへ移行しました`);
  return created as ClientRow;
}

function resolveToken(row: ClientRow): string {
  if (row.ig_access_token) return row.ig_access_token;
  const local = row.slug ? loadLocalClients()[row.slug] : undefined;
  if (local?.igAccessToken) return local.igAccessToken;
  throw new Error(
    `クライアント "${row.slug}" の igAccessToken が未設定です(upsert_client で登録してください)`
  );
}

// ---------------------------------------------------------------------------
// データ取得 (raw取得 → metrics計算 → DBへ保存。cronと同じ insights.ts を使用)
// ---------------------------------------------------------------------------

async function getOrFetchMetrics(
  db: SupabaseClient,
  client: ClientRow,
  period: string,
  refresh: boolean
): Promise<{ metrics: Metrics; source: "stored" | "fetched" }> {
  const { data: row } = await db
    .from("reports")
    .select("id, raw_insights, status")
    .eq("client_id", client.id)
    .eq("period", period)
    .maybeSingle();

  let raw = row?.raw_insights as RawInsights | null | undefined;
  const hasStored = raw && (raw as RawInsights).schemaVersion === 2;
  let source: "stored" | "fetched" = "stored";

  if (!hasStored || refresh) {
    raw = await fetchRawInsights(resolveToken(client), period);
    source = "fetched";
  }

  // 前月のmetricsがあれば前月比をサーバー計算する
  const [y, m] = period.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const prevPeriod = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  const { data: prevRow } = await db
    .from("reports")
    .select("metrics_json")
    .eq("client_id", client.id)
    .eq("period", prevPeriod)
    .maybeSingle();

  const metrics = computeMetrics(raw as RawInsights, {
    prevMetrics: (prevRow?.metrics_json as Metrics | null) ?? null,
    modules: client.modules ?? null,
  });

  // raw と metrics を保存(publish時の数値マージの正本になる)
  const { error: upErr } = await db.from("reports").upsert(
    {
      client_id: client.id,
      period,
      raw_insights: raw,
      metrics_json: metrics,
      // 公開済みレポートを再取得しても status は戻さない
      ...(row?.status === "published" ? {} : { status: "fetched" }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,period" }
  );
  if (upErr) throw new Error(`reports保存エラー: ${upErr.message}`);

  return { metrics, source };
}

// ---------------------------------------------------------------------------
// 分析(文章のみ)スキーマ — モデルは数値を一切出力しない
// ---------------------------------------------------------------------------

const AnalysisSchema = z.object({
  headline: z
    .string()
    .describe("今月の最重要メッセージを1行(40字以内)。最大のボトルネック or 勝ち筋を断定"),
  executiveSummary: z
    .string()
    .describe("最大の課題を先頭にしたサマリー300〜400字。課題→原因→処方の順、丁寧語"),
  stageDiagnoses: z
    .object({
      save_rate: z.string().describe("保存率の診断 80〜150字"),
      home_rate: z.string().describe("ホーム率の診断 80〜150字"),
      profile_transition_rate: z
        .string()
        .describe("プロフィール遷移率の診断 80〜150字"),
      follower_conversion_rate: z
        .string()
        .describe("フォロワー転換率の診断 80〜150字"),
    })
    .describe(
      "各ファネル指標の診断文。verdict=unknown の指標は『未取得のため測定不可』の旨を書く"
    ),
  bottleneck: z
    .string()
    .describe("最優先の穴を1つ特定した統合診断 150〜250字。レポートの核"),
  contentInsight: z
    .object({
      winPattern: z
        .string()
        .describe("保存率トップ投稿から読み解く勝ちパターンの言語化 150〜250字"),
      losePattern: z.string().describe("反応が低かった投稿に共通する要因 100〜200字"),
    })
    .nullish()
    .describe("コンテンツ診断。セクション除外指定(content_insight)がある場合は省略"),
  postInsights: z
    .array(
      z.object({
        mediaId: z.string().describe("metrics の topPosts/worstPosts の id"),
        insight: z
          .string()
          .describe("観察→因果(心理/アルゴリズム)→次の一手 の3要素で100字程度"),
      })
    )
    .describe("topPosts と worstPosts の全投稿に1件ずつ対応させる"),
  nextActions: z
    .array(
      z.object({
        action: z.string().describe("翌月の具体TODO"),
        why: z.string().describe("効く理由(心理/アルゴリズム/ファネル上の位置づけ)"),
        priority: z.enum(["high", "mid"]).describe("high=ボトルネック直撃の施策"),
      })
    )
    .describe("3〜5個。最低1つは『やめること(リソースの引き上げ)』"),
  additionalSections: z
    .array(
      z.object({
        moduleKey: z.string().describe("観点モジュールのキー(reels/timing/cta/trend)"),
        title: z.string().describe("セクション見出し"),
        body: z.string().describe("分析本文 200〜400字"),
      })
    )
    .nullish()
    .describe("クライアント固有の追加観点。指定されたモジュールごとに1セクション"),
});

type Analysis = z.infer<typeof AnalysisSchema>;

// ---------------------------------------------------------------------------
// レポート公開 (metrics + analysis をマージして専用URL発行)
// ---------------------------------------------------------------------------

async function publishReport(
  db: SupabaseClient,
  client: ClientRow,
  period: string,
  analysis: Analysis
): Promise<string> {
  const { data: row, error } = await db
    .from("reports")
    .select("id, metrics_json")
    .eq("client_id", client.id)
    .eq("period", period)
    .maybeSingle();
  if (error) throw new Error(`reports検索エラー: ${error.message}`);
  const metrics = row?.metrics_json as Metrics | null | undefined;
  if (!row || !metrics) {
    throw new Error(
      `${period} の数値データが未保存です。先に get_instagram_insights を実行してください`
    );
  }

  // 文章が数値と正しく対応しているかの整合チェック
  const requiredIds = [...metrics.topPosts, ...metrics.worstPosts].map((p) => p.id);
  const providedIds = new Set(analysis.postInsights.map((p) => p.mediaId));
  const missing = requiredIds.filter((id) => !providedIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `postInsights が不足しています。次の mediaId の insight を追加して再実行: ${missing.join(", ")}`
    );
  }
  const expectedModules = metrics.sections.addModules;
  const providedModules = new Set(
    (analysis.additionalSections ?? []).map((s) => s.moduleKey)
  );
  const missingModules = expectedModules.filter((k) => !providedModules.has(k));
  if (missingModules.length > 0) {
    throw new Error(
      `additionalSections が不足しています。観点モジュール ${missingModules.join(", ")} のセクションを追加して再実行`
    );
  }

  const merged = { schemaVersion: 2, metrics, analysis };
  const { data: saved, error: upErr } = await db
    .from("reports")
    .update({
      analysis_json: analysis,
      report_json: merged,
      status: "published",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select("access_token")
    .single();
  if (upErr) throw new Error(`reports保存エラー: ${upErr.message}`);

  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/reports/${saved.access_token}`;
}

// ---------------------------------------------------------------------------
// MCPサーバー本体
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "instagram-report", version: "0.3.0" });

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: String(e) }],
  isError: true as const,
});

server.registerTool(
  "list_clients",
  {
    title: "クライアント一覧(棚卸)",
    description:
      "登録済みクライアントの一覧を返す。slug・IGユーザー名・トークン有無・観点モジュール設定・有効/無効と、直近のレポート状況を含む。",
    inputSchema: {},
  },
  async () => {
    try {
      const db = supabaseAdmin();
      const { data, error } = await db
        .from("clients")
        .select(
          "slug, name, ig_username, ig_access_token, brand_color, modules, active, reports(period, status)"
        )
        .order("created_at");
      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((c) => ({
        slug: c.slug,
        name: c.name,
        igUsername: c.ig_username,
        hasToken: Boolean(c.ig_access_token),
        active: c.active,
        modules: c.modules,
        reports: (c.reports as Array<{ period: string; status: string }>)
          .sort((a, b) => b.period.localeCompare(a.period))
          .slice(0, 6),
      }));
      return ok(JSON.stringify(rows, null, 2));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "upsert_client",
  {
    title: "クライアント追加・更新",
    description:
      "クライアントを台帳(Supabase)に登録・更新する。トークンや観点モジュール(add: reels/timing/cta/trend、remove: worst_posts/content_insight/kpi_strip)の設定もここで行う。指定したフィールドだけが更新される。",
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9_-]+$/).describe("クライアントのキー(例: akane)"),
      name: z.string().optional().describe("表示名(新規作成時は必須)"),
      igAccessToken: z
        .string()
        .optional()
        .describe("Instagramログイン版APIの長期トークン(60日)"),
      igUsername: z.string().optional().describe("Instagramのユーザー名(@なし)"),
      brandColor: z.string().optional().describe("レポートのブランド色(例: #0f766e)"),
      modulesAdd: z
        .array(z.enum(Object.keys(MODULE_DEFS) as [string, ...string[]]))
        .optional()
        .describe("追加する観点モジュール(全置換)"),
      modulesRemove: z
        .array(z.enum(REMOVABLE_SECTIONS))
        .optional()
        .describe("除外する基本セクション(全置換)"),
      moduleNote: z
        .string()
        .optional()
        .describe("このクライアント固有の自由記述の分析観点メモ"),
      active: z.boolean().optional().describe("false で月次対象から外す"),
    },
  },
  async (args) => {
    try {
      const db = supabaseAdmin();
      const { data: existing } = await db
        .from("clients")
        .select("id, modules, name")
        .eq("slug", args.slug)
        .maybeSingle();

      const prevModules = (existing?.modules ?? {}) as ModulesConfig;
      const modules: ModulesConfig = {
        add: args.modulesAdd ?? prevModules.add ?? [],
        remove: args.modulesRemove ?? prevModules.remove ?? [],
        note: args.moduleNote ?? prevModules.note ?? undefined,
      };

      const patch: Record<string, unknown> = { slug: args.slug, modules };
      if (args.name !== undefined) patch.name = args.name;
      if (args.igAccessToken !== undefined) patch.ig_access_token = args.igAccessToken;
      if (args.igUsername !== undefined) patch.ig_username = args.igUsername;
      if (args.brandColor !== undefined) patch.brand_color = args.brandColor;
      if (args.active !== undefined) patch.active = args.active;

      if (existing) {
        const { error } = await db.from("clients").update(patch).eq("id", existing.id);
        if (error) throw new Error(error.message);
        return ok(`クライアント "${args.slug}" を更新しました`);
      }
      if (!args.name) throw new Error("新規作成には name が必須です");
      const { error } = await db.from("clients").insert(patch);
      if (error) throw new Error(error.message);
      return ok(`クライアント "${args.slug}" を登録しました`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "get_instagram_insights",
  {
    title: "Instagramインサイト取得(サーバー計算済み)",
    description:
      "指定クライアントの月間データを取得し、ファネル4指標(保存率/ホーム率/プロフィール遷移率/フォロワー転換率)の合格ライン判定・投稿別指標・前月比をすべてサーバー計算済みで返す。cronが取得済みならその保存データを使う(数値の一貫性保証)。出力の analysisGuidelines に従って文章のみの分析を書き、publish_report に渡すこと。",
    inputSchema: {
      clientId: z.string().describe("クライアントのslug(list_clientsで確認)"),
      period: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .describe('対象月。"YYYY-MM" 形式 (例: "2026-07")'),
      refresh: z
        .boolean()
        .optional()
        .describe("true でInstagram APIから再取得(通常は不要)"),
    },
  },
  async ({ clientId, period, refresh }) => {
    try {
      const db = supabaseAdmin();
      const client = await getClientBySlug(db, clientId);
      const { metrics, source } = await getOrFetchMetrics(
        db,
        client,
        period,
        refresh ?? false
      );
      return ok(
        JSON.stringify(
          {
            client: client.name,
            dataSource: source === "stored" ? "保存済みデータ(cron取得)" : "Instagram APIから取得",
            metrics,
            analysisGuidelines: buildAnalysisGuidelines(metrics),
          },
          null,
          2
        )
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "publish_report",
  {
    title: "レポートを公開(専用URL発行)",
    description:
      "分析の文章(analysis)を受け取り、サーバー保存済みの数値(metrics)とマージして専用URLのHTMLレポートを発行する。数値はサーバーの計算値のみが使われるため、analysisに数値を書く必要はない(書いても使われない)。同じ月を再公開すると上書き。",
    inputSchema: {
      clientId: z.string().describe("クライアントのslug"),
      period: z.string().regex(/^\d{4}-\d{2}$/).describe('対象月 "YYYY-MM"'),
      analysis: AnalysisSchema.describe("分析の文章ブロック(数値なし)"),
    },
  },
  async ({ clientId, period, analysis }) => {
    try {
      const db = supabaseAdmin();
      const client = await getClientBySlug(db, clientId);
      const url = await publishReport(db, client, period, analysis);
      return ok(
        `レポートを公開しました。\n閲覧URL: ${url}\n(ページ右上の「PDFで保存 / 印刷」からPDF化できます)`
      );
    } catch (e) {
      return fail(e);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("instagram-report MCP server: 起動しました (stdio)");
}

main().catch((e) => {
  console.error("起動エラー:", e);
  process.exit(1);
});
