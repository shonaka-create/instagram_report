#!/usr/bin/env node
/**
 * Instagram運用代行 MCPサーバー
 *
 * Claude Desktop / claude.ai から Tools として呼び出される:
 *  - get_instagram_insights: Graph APIからデータ取得 → 軽量JSONで返却(社内分析用)
 *  - export_report:          Claudeが作った分析結果をGoogleスプレッドシートへ転記(納品用)
 *
 * 注意: stdioトランスポートではstdoutがプロトコル通信路なので、
 * ログは必ず console.error (stderr) に出すこと。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

// ---------------------------------------------------------------------------
// クライアント設定 (clients.json)
// ---------------------------------------------------------------------------

type ClientConfig = {
  name: string;
  igUserId: string;
  igAccessToken: string;
  spreadsheetId?: string; // export_report を使うクライアントのみ
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
// Instagram Graph API
// ---------------------------------------------------------------------------

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

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
  const [year, month] = period.split("-").map(Number);
  const since = Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  const until = Math.floor(Date.UTC(year, month, 1) / 1000);

  const profile = await igGet(
    cfg.igUserId,
    { fields: "followers_count,media_count,username" },
    cfg.igAccessToken
  );

  const mediaRes = await igGet(
    `${cfg.igUserId}/media`,
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
  const posts = [];
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
    // AIが分析しやすいよう、不要なメタデータを削った軽量JSONに整形
    posts.push({
      id: m.id,
      date: m.timestamp?.slice(0, 10),
      type: m.media_type,
      permalink: m.permalink,
      caption: (m.caption ?? "").slice(0, 120),
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      reach: insights.reach ?? null,
      saved: insights.saved ?? null,
      views: insights.views ?? null,
    });
  }

  return {
    client: cfg.name,
    period,
    account: {
      username: profile.username,
      followers: profile.followers_count,
      totalMedia: profile.media_count,
    },
    postCount: posts.length,
    posts,
  };
}

// ---------------------------------------------------------------------------
// Google Sheets 転記
// ---------------------------------------------------------------------------

const SHEET_HEADERS = [
  "date",
  "period",
  "client",
  "summary",
  "next_action",
  "kpi_json",
];

async function appendReportRow(
  cfg: ClientConfig,
  args: {
    period?: string;
    summaryText: string;
    nextAction: string;
    kpiData: Record<string, string | number>;
  }
) {
  if (!cfg.spreadsheetId) {
    throw new Error(
      `このクライアントには spreadsheetId が設定されていません (clients.json)`
    );
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY が未設定です (.env)"
    );
  }

  const jwt = new JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(cfg.spreadsheetId, jwt);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle["reports"] ?? doc.sheetsByIndex[0];
  // 空シートだとaddRowが失敗するため、ヘッダー行がなければ作る
  try {
    await sheet.loadHeaderRow();
  } catch {
    await sheet.setHeaderRow(SHEET_HEADERS);
  }

  await sheet.addRow({
    date: new Date().toISOString().slice(0, 10),
    period: args.period ?? "",
    client: cfg.name,
    summary: args.summaryText,
    next_action: args.nextAction,
    kpi_json: JSON.stringify(args.kpiData),
  });

  return { spreadsheetTitle: doc.title, sheetTitle: sheet.title };
}

// ---------------------------------------------------------------------------
// MCPサーバー本体
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "instagram-report", version: "0.1.0" });

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
        .describe('対象月。"YYYY-MM" 形式 (例: "2026-06")'),
    },
  },
  async ({ clientId, period }) => {
    try {
      const result = await fetchInsights(getClient(clientId), period);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: String(e) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "export_report",
  {
    title: "レポートをスプレッドシートへ転記",
    description:
      "分析済みの月次レポート(総括・次月の打ち手・主要KPI)を、クライアントに紐づいたGoogleスプレッドシートに1行追記する。",
    inputSchema: {
      clientId: z
        .string()
        .describe("clients.json に登録したクライアントのキー"),
      period: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe('レポート対象月 "YYYY-MM"'),
      summaryText: z.string().describe("当月の総括(クライアント提出用の文章)"),
      nextAction: z.string().describe("次月の打ち手(箇条書き可)"),
      kpiData: z
        .record(z.union([z.string(), z.number()]))
        .describe('主要KPI。例: {"リーチ数": 45200, "フォロワー数": 8340}'),
    },
  },
  async ({ clientId, period, summaryText, nextAction, kpiData }) => {
    try {
      const cfg = getClient(clientId);
      const result = await appendReportRow(cfg, {
        period,
        summaryText,
        nextAction,
        kpiData,
      });
      return {
        content: [
          {
            type: "text",
            text: `転記に成功しました: 「${result.spreadsheetTitle}」の「${result.sheetTitle}」シートに1行追加`,
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `転記に失敗しました: ${String(e)}` }],
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
