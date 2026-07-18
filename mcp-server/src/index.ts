#!/usr/bin/env node
/**
 * Instagram運用代行 MCPサーバー
 *
 * Claude Desktop / claude.ai から Tools として呼び出される:
 *  - get_instagram_insights: Graph APIからデータ取得 → 軽量JSONで返却(分析用)
 *  - publish_report:         Claudeが作ったレポートJSONをSupabaseに保存し、
 *                            専用URL(HTMLレポート/PDF)を発行(納品用)
 *
 * 出力は Vercel パイプラインと同じ /reports/{token} に統一されるため、
 * MCPで分析しても自動バッチで生成しても、クライアントに渡すURLは同じ形式になる。
 *
 * 注意: stdioトランスポートではstdoutがプロトコル通信路なので、
 * ログは必ず console.error (stderr) に出すこと。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

// ---------------------------------------------------------------------------
// クライアント設定 (clients.json)
// ---------------------------------------------------------------------------

type ClientConfig = {
  name: string;
  igAccessToken: string; // Instagramログイン版APIの長期トークン(60日)
  igUserId?: string; // 旧Graph API用。新方式では不要
};

const here = path.dirname(fileURLToPath(import.meta.url));

function loadClients(): Record<string, ClientConfig> {
  const file =
    process.env.CLIENTS_FILE ?? path.join(here, "..", "clients.json");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(
      `clients.json を読み込めません (${file})。clients.json.example を参考に作成してください: ${e}`
    );
  }
}

function getClient(clientId: string): ClientConfig {
  const clients = loadClients();
  const cfg = clients[clientId];
  if (!cfg) {
    throw new Error(
      `clientId "${clientId}" は未登録です。登録済み: ${Object.keys(clients).join(", ")}`
    );
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Instagram API (Instagramログイン方式)
// Facebookページ連携が不要な新方式。エンドポイントは graph.instagram.com、
// トークンはMetaアプリ管理画面の「Instagram > APIセットアップ」で直接発行する。
// ---------------------------------------------------------------------------

const GRAPH_BASE = "https://graph.instagram.com/v21.0";

async function igGet(
  pathname: string,
  params: Record<string, string>,
  accessToken: string
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: accessToken });
  const res = await fetch(`${GRAPH_BASE}/${pathname}?${qs}`);
  const json = (await res.json()) as Record<string, unknown>;
  const err = json.error as { message?: string; code?: number } | undefined;
  if (!res.ok || err) {
    throw new Error(
      `Graph API error (HTTP ${res.status}, code=${err?.code}): ${err?.message}`
    );
  }
  return json;
}

type MediaRow = {
  id: string;
  timestamp?: string;
  media_type?: string;
  permalink?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
};

async function fetchInsights(cfg: ClientConfig, period: string) {
  if (!cfg.igAccessToken) {
    throw new Error(
      `このクライアントの igAccessToken が clients.json に未設定です`
    );
  }
  const [year, month] = period.split("-").map(Number);
  const since = Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  const until = Math.floor(Date.UTC(year, month, 1) / 1000);

  // "me" = トークンに紐づくInstagramアカウント自身(IDの事前特定が不要)
  const profile = await igGet(
    "me",
    { fields: "username,followers_count,media_count" },
    cfg.igAccessToken
  );

  const mediaRes = await igGet(
    "me/media",
    {
      fields:
        "id,caption,media_type,permalink,like_count,comments_count,timestamp",
      since: String(since),
      until: String(until),
      limit: "25",
    },
    cfg.igAccessToken
  );
  const media = (mediaRes.data ?? []) as MediaRow[];

  // 投稿ごとのインサイト(リーチ・保存数・閲覧数)。
  // メディア種別によって使えないメトリクスがあるため、失敗しても投稿自体は返す
  type PostRow = {
    id: string;
    date?: string;
    type?: string;
    permalink?: string;
    caption: string;
    likes: number;
    comments: number;
    reach: number | null;
    saved: number | null;
    views: number | null;
    engagement: number;
    viewsPerReach: number | null;
  };
  const posts: PostRow[] = [];
  for (const m of media) {
    let insights: Record<string, number> = {};
    try {
      const ins = await igGet(
        `${m.id}/insights`,
        { metric: "reach,saved,views" },
        cfg.igAccessToken
      );
      for (const item of (ins.data ?? []) as Array<{
        name: string;
        values?: Array<{ value: number }>;
      }>) {
        insights[item.name] = item.values?.[0]?.value ?? 0;
      }
    } catch {
      insights = {}; // このメディア種別では取得不可
    }
    // AIが分析しやすいよう、不要なメタデータを削った軽量JSONに整形。
    // 比率はここで計算して渡す(分析モデル側の計算ミスを構造的に排除するため)
    const likes = m.like_count ?? 0;
    const comments = m.comments_count ?? 0;
    const reach = insights.reach ?? null;
    const views = insights.views ?? null;
    posts.push({
      id: m.id,
      date: m.timestamp?.slice(0, 10),
      type: m.media_type,
      permalink: m.permalink,
      caption: (m.caption ?? "").slice(0, 120),
      likes,
      comments,
      reach,
      saved: insights.saved ?? null,
      views,
      engagement: likes + comments,
      viewsPerReach:
        reach && views !== null ? Math.round((views / reach) * 10) / 10 : null,
    });
  }

  // --- 集計・比率・警告フラグ(すべてサーバー側で計算済み。再計算不要) ---
  const followers = Number(profile.followers_count ?? 0);
  const sum = (k: "likes" | "comments") =>
    posts.reduce((a, p) => a + (p[k] ?? 0), 0);
  const sumNullable = (k: "reach" | "views" | "saved") =>
    posts.reduce((a, p) => a + (p[k] ?? 0), 0);
  const totalReach = sumNullable("reach");
  const derived = {
    totals: {
      reach: totalReach,
      views: sumNullable("views"),
      saved: sumNullable("saved"),
      likes: sum("likes"),
      comments: sum("comments"),
      engagement: sum("likes") + sum("comments"),
    },
    reachToFollowerPct:
      followers > 0 ? Math.round((totalReach / followers) * 1000) / 10 : null,
  };

  const flags: string[] = [];
  const byDate = new Map<string, number>();
  for (const p of posts) {
    if (p.date) byDate.set(p.date, (byDate.get(p.date) ?? 0) + 1);
  }
  for (const [date, n] of byDate) {
    if (n >= 2)
      flags.push(
        `${date} に${n}本を同日投稿(アルゴリズムの初速テストが分散し、後発の投稿が配信されにくくなる)`
      );
  }
  if (posts.length > 0 && derived.totals.saved === 0)
    flags.push(
      "全投稿で保存0(保存はアルゴリズムが最重視するシグナル。発見タブ露出の起点が欠けている)"
    );
  if (derived.reachToFollowerPct !== null && derived.reachToFollowerPct < 50)
    flags.push(
      `合計リーチがフォロワー数の${derived.reachToFollowerPct}%に留まる(既存フォロワーにも届き切っていない)`
    );

  return {
    client: cfg.name,
    period,
    account: {
      username: profile.username,
      followers,
      totalMedia: profile.media_count,
    },
    postCount: posts.length,
    posts,
    derived,
    flags,
    // どのモデル・どの画面で分析しても必ず目に入るよう、指針をデータに同梱する
    analysisGuidelines: [
      "このデータを分析してレポートを書く際の必須ルール(SNS戦略コンサルタントとして):",
      "1) 数値の再計算をしない。posts/derived の計算済みの値(viewsPerReach 等)をそのまま使う",
      "2) 数値の読み上げは禁止。必ず『なぜ起きたか』を閲覧者心理(自己開示への返報性、保存の動機、単純接触効果など)とアルゴリズム(初速シグナル、滞在時間、保存・シェアの重み、フィード=フォロワー内配信/リール=非フォロワー配信という構造差)で説明する",
      "3) ファネル(認知=リーチ → 興味=閲覧・滞在 → 信頼=プロフィール訪問・フォロー → 行動=保存・問い合わせ)のどこが詰まっているかを特定して述べる",
      "4) flags の警告は必ずレポートに反映する",
      "5) nextActions は『やめること』と『制作リソースをどこに寄せるか』という配分の言葉で書く(抽象論禁止)",
      "6) 各topPostの insight は 観察→因果(心理/アルゴリズム)→次の一手 の3要素で書く",
      "7) クライアント提出用の丁寧語で、歯切れよく断定する",
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// レポート公開 (Supabase → 専用URLのHTMLレポート)
// ---------------------------------------------------------------------------

// Next.js側 lib/report-schema.ts と同じ構造(こちらはzod v3)
const ReportSchema = z.object({
  period: z.string().describe('レポート対象月 "YYYY-MM"'),
  summary: z.string().describe("当月の総評(300〜400字、丁寧語)"),
  kpis: z
    .array(
      z.object({
        label: z.string().describe("KPI名(例: リーチ数)"),
        value: z.number(),
        momChangePct: z
          .number()
          .nullable()
          .describe("前月比%。前月データがなければ null"),
      })
    )
    .describe("主要KPI 4〜6項目"),
  topPosts: z
    .array(
      z.object({
        mediaId: z.string(),
        permalink: z.string(),
        caption: z.string().describe("キャプション冒頭50字程度"),
        likeCount: z.number(),
        commentsCount: z.number(),
        insight: z.string().describe("伸びた/伸びなかった理由の分析 100字程度"),
      })
    )
    .describe("人気投稿 最大3件"),
  nextActions: z.array(z.string()).describe("翌月の改善アクション 3〜5個"),
});

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です (mcp-server/.env)"
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function publishReport(
  cfg: ClientConfig,
  period: string,
  report: z.infer<typeof ReportSchema>
): Promise<string> {
  const db = supabaseAdmin();

  // clientsテーブルの行を名前で解決(なければ作成)
  const { data: existing, error: selErr } = await db
    .from("clients")
    .select("id")
    .eq("name", cfg.name)
    .maybeSingle();
  if (selErr) throw new Error(`clients検索エラー: ${selErr.message}`);

  let clientId = existing?.id as string | undefined;
  if (!clientId) {
    const { data: created, error: insErr } = await db
      .from("clients")
      .insert({
        name: cfg.name,
        ig_user_id: cfg.igUserId || null,
        active: true,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`clients作成エラー: ${insErr.message}`);
    clientId = created.id;
  }

  // 同月の行があれば上書き(再分析→再公開できるように)
  const { data: row, error: upErr } = await db
    .from("reports")
    .upsert(
      {
        client_id: clientId,
        period,
        report_json: report,
        status: "published",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,period" }
    )
    .select("access_token")
    .single();
  if (upErr) throw new Error(`reports保存エラー: ${upErr.message}`);

  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/reports/${row.access_token}`;
}

// ---------------------------------------------------------------------------
// MCPサーバー本体
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "instagram-report", version: "0.2.0" });

server.registerTool(
  "get_instagram_insights",
  {
    title: "Instagramインサイト取得",
    description:
      "指定クライアントのInstagram投稿データ(リーチ・保存数・いいね・コメント・キャプション)を指定月分取得し、分析用の軽量JSONで返す。",
    inputSchema: {
      clientId: z
        .string()
        .describe("clients.json に登録したクライアントのキー"),
      period: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .describe('対象月。"YYYY-MM" 形式 (例: "2026-07")'),
    },
  },
  async ({ clientId, period }) => {
    try {
      const result = await fetchInsights(getClient(clientId), period);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.registerTool(
  "publish_report",
  {
    title: "レポートを公開(専用URL発行)",
    description:
      "分析済みの月次レポートJSONをデータベースに保存し、クライアント納品用の専用URL(HTMLレポート。ブラウザ印刷でPDF化可)を発行する。同じ月を再公開すると上書きされる。",
    inputSchema: {
      clientId: z
        .string()
        .describe("clients.json に登録したクライアントのキー"),
      report: ReportSchema.describe("レポート本体"),
    },
  },
  async ({ clientId, report }) => {
    try {
      const cfg = getClient(clientId);
      const url = await publishReport(cfg, report.period, report);
      return {
        content: [
          {
            type: "text",
            text: `レポートを公開しました。\n閲覧URL: ${url}\n(ページ右上の「PDFで保存 / 印刷」からPDF化できます)`,
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `公開に失敗しました: ${String(e)}` }],
        isError: true,
      };
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
