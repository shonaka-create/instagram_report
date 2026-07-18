import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ReportSchema, type Report } from "./report-schema";

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) client = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から解決
  return client;
}

const SYSTEM_PROMPT = `あなたはInstagram運用代行会社のシニアアナリストです。
クライアント企業に提出する月次レポートのために、Instagramの生データを定量・定性の両面から分析します。

分析方針:
- 数値は与えられたデータのみを根拠にする。データにない数値を推測で作らない
- 前月データが含まれていない指標の momChangePct は null にする
- topPosts はいいね数+コメント数の合計が多い順に最大3件選ぶ
- insight と summary は「なぜそうなったか」の仮説と、運用上の示唆を含める
- nextActions は翌月すぐ実行できる具体的な施策にする(抽象論は書かない)
- クライアント提出用の文章として、丁寧かつ簡潔な日本語で書く`;

// リトライすべきでない恒久エラー(呼び出し側で failed 扱いにする)
export class AnalysisPermanentError extends Error {}

export async function analyzeInsights(
  raw: unknown,
  period: string,
  clientName: string
): Promise<Report> {
  const response = await anthropic().messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `クライアント「${clientName}」の ${period} のInstagramデータ(Graph API生データ)です。月次レポートを作成してください。\n\n${JSON.stringify(raw)}`,
      },
    ],
    output_config: { format: zodOutputFormat(ReportSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new AnalysisPermanentError("Claudeがリクエストを拒否しました");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AnalysisPermanentError(
      "出力がmax_tokensで打ち切られました。入力データ量を減らすかmax_tokensを上げてください"
    );
  }
  const report = response.parsed_output;
  if (!report) {
    throw new AnalysisPermanentError("Structured outputのパースに失敗しました");
  }
  return report;
}

// Anthropic APIのエラーがリトライに値するかを判定(429 / 5xx / ネットワーク断)
export function isRetryableAnthropicError(e: unknown): boolean {
  if (e instanceof Anthropic.RateLimitError) return true;
  if (e instanceof Anthropic.InternalServerError) return true;
  if (e instanceof Anthropic.APIConnectionError) return true;
  return false;
}
