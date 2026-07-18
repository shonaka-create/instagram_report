import { z } from "zod";

// Claude の Structured Outputs (output_config.format) に渡すスキーマ。
// API 側でこの形が保証されるため、受信後の再検証・リトライは不要。
export const ReportSchema = z.object({
  period: z.string().describe('レポート対象月。"YYYY-MM" 形式'),
  summary: z
    .string()
    .describe(
      "当月の総評。定量データに基づく定性分析を300〜400字で。クライアントに提出する文章なので丁寧語で書く"
    ),
  kpis: z
    .array(
      z.object({
        label: z.string().describe("KPI名(例: リーチ数、フォロワー数)"),
        value: z.number().describe("当月の値"),
        momChangePct: z
          .number()
          .nullable()
          .describe("前月比の変化率(%)。前月データがなければ null"),
      })
    )
    .describe("主要KPI。4〜6項目"),
  topPosts: z
    .array(
      z.object({
        mediaId: z.string().describe("InstagramのメディアID"),
        permalink: z.string().describe("投稿のパーマリンクURL"),
        caption: z.string().describe("キャプションの冒頭50字程度"),
        likeCount: z.number(),
        commentsCount: z.number(),
        insight: z
          .string()
          .describe("この投稿がなぜ伸びたか(または伸びなかったか)の分析。100字程度"),
      })
    )
    .describe("エンゲージメント上位の投稿。最大3件"),
  nextActions: z
    .array(z.string())
    .describe("翌月に向けた具体的な改善アクション。3〜5個"),
});

export type Report = z.infer<typeof ReportSchema>;
