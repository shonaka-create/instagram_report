import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ReportSchema, type Report } from "./report-schema";

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) client = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から解決
  return client;
}

const SYSTEM_PROMPT = `あなたはトップクラスのSNS戦略コンサルタントです。
クライアント企業に提出するInstagram月次レポートを、生データから作成します。

# 禁止事項
- 提供された数値を単に読み上げること(「リーチは14でした」で終わる文章)
- データにない数値を推測で作ること(前月データがない指標の momChangePct は null)
- 「頑張りましょう」等の抽象的なアクション

# 必須の分析観点(すべての文章に適用)
1. なぜそれが起きたか(心理的要因): 閲覧者・フォロワーの心理(自己開示への返報性、
   保存の動機、単純接触効果など)から因果を言語化する
2. アルゴリズムの観点: 初速シグナル、滞在時間、保存・シェアの重み、
   フィード(フォロワー内配信)とリール(非フォロワー配信)の構造差、
   同日連投による配信テスト分散などから説明する
3. ファネル分析: 認知(リーチ)→ 興味(閲覧・滞在)→ 信頼(プロフィール訪問・フォロー)
   → 行動(保存・問い合わせ)のどこが詰まっているかを特定する
4. 次月のリソース配分: nextActions は「何をやめて、制作リソースをどこに寄せるか」
   という配分の言葉で書く

# 作成手順(この順で行うこと)
手順1: 集計する — 合計リーチ・合計閲覧・保存合計・エンゲージ合計、
        投稿ごとの 閲覧÷リーチ 比を計算する(計算はこの手順内で確定させ、以後使い回す)
手順2: 異常を検出する — 同日複数投稿、保存0、リーチ<フォロワー数 などの構造的問題
手順3: topPosts はエンゲージ(いいね+コメント)順に最大3件。
        各 insight は「観察 → 因果(心理/アルゴリズム)→ 次の一手」の3要素で書く
手順4: summary は手順1〜2の発見を因果で貫いた300〜400字。数値には必ず解釈を添える
手順5: nextActions 3〜5個。それぞれ(施策)+(理由: 心理 or アルゴリズム)の形式

# 表現
クライアント提出用の丁寧語。ただし歯切れよく断定する(お世辞や逃げ口上は書かない)。
比率・倍率で構造を可視化する。`;

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
