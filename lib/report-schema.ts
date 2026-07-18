import { z } from "zod";

// ---------------------------------------------------------------------------
// レポートの正本 report_json = { schemaVersion: 2, metrics, analysis }
//
//  - metrics: サーバー計算の数値ブロック(mcp-server/src/insights.ts が唯一の計算元)
//  - analysis: 分析モデルが書いた文章ブロック(数値を含まない)
//
// 数値と文章を分離することで、どのモデル(Sonnet等)が分析しても
// レポート上の数値が壊れることは構造的に起きない。
// 型は mcp-server/src/insights.ts / index.ts と同期すること。
// ---------------------------------------------------------------------------

const funnelKey = z.enum([
  "save_rate",
  "home_rate",
  "profile_transition_rate",
  "follower_conversion_rate",
]);

const postMetric = z.object({
  id: z.string(),
  date: z.string().nullable(),
  type: z.string().nullable(),
  permalink: z.string().nullable(),
  caption: z.string(),
  likes: z.number(),
  comments: z.number(),
  reach: z.number().nullable(),
  saved: z.number().nullable(),
  views: z.number().nullable(),
  engagement: z.number(),
  viewsPerReach: z.number().nullable(),
  saveRate: z.number().nullable(),
});

export const MetricsSchema = z.object({
  schemaVersion: z.literal(2),
  period: z.string(),
  account: z.object({
    username: z.string().nullable(),
    followers: z.number(),
    postCount: z.number(),
  }),
  posts: z.array(postMetric),
  funnel: z.object({
    stages: z.array(
      z.object({
        key: funnelKey,
        label: z.string(),
        value: z.number().nullable(),
        benchmark: z.number(),
        gapPt: z.number().nullable(),
        verdict: z.enum(["pass", "warn", "fail", "unknown"]),
      })
    ),
    raw: z.record(z.string(), z.number().nullable()),
    dataNotes: z.array(z.string()),
  }),
  topPosts: z.array(postMetric),
  worstPosts: z.array(postMetric),
  kpiStrip: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.number(),
      momChangePct: z.number().nullable(),
    })
  ),
  flags: z.array(z.string()),
  sections: z.object({
    addModules: z.array(z.string()),
    removed: z.array(z.string()),
    note: z.string().nullable(),
  }),
});

export const AnalysisSchema = z.object({
  headline: z.string(),
  executiveSummary: z.string(),
  stageDiagnoses: z.object({
    save_rate: z.string(),
    home_rate: z.string(),
    profile_transition_rate: z.string(),
    follower_conversion_rate: z.string(),
  }),
  bottleneck: z.string(),
  contentInsight: z
    .object({ winPattern: z.string(), losePattern: z.string() })
    .nullish(),
  postInsights: z.array(z.object({ mediaId: z.string(), insight: z.string() })),
  nextActions: z.array(
    z.object({
      action: z.string(),
      why: z.string(),
      priority: z.enum(["high", "mid"]),
    })
  ),
  additionalSections: z
    .array(
      z.object({ moduleKey: z.string(), title: z.string(), body: z.string() })
    )
    .nullish(),
});

export const ReportSchema = z.object({
  schemaVersion: z.literal(2),
  metrics: MetricsSchema,
  analysis: AnalysisSchema,
});

export type Metrics = z.infer<typeof MetricsSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
export type Report = z.infer<typeof ReportSchema>;

// ---------------------------------------------------------------------------
// レンダリング用ビューモデル: 数値(metrics)と文章(analysis)をここで合流させる
// ---------------------------------------------------------------------------

export type StageView = Metrics["funnel"]["stages"][number] & {
  diagnosis: string;
};
export type PostView = z.infer<typeof postMetric> & { insight: string };

export type ReportView = {
  period: string;
  headline: string;
  executiveSummary: string;
  stages: StageView[];
  bottleneck: string;
  dataNotes: string[];
  contentInsight: { winPattern: string; losePattern: string } | null;
  topPosts: PostView[];
  worstPosts: PostView[];
  nextActions: Analysis["nextActions"];
  additionalSections: NonNullable<Analysis["additionalSections"]>;
  kpiStrip: Metrics["kpiStrip"];
  show: { worstPosts: boolean; contentInsight: boolean; kpiStrip: boolean };
};

export function toReportView(report: Report): ReportView {
  const { metrics, analysis } = report;
  const insightById = new Map(
    analysis.postInsights.map((p) => [p.mediaId, p.insight])
  );
  const attach = (posts: Metrics["topPosts"]): PostView[] =>
    posts.map((p) => ({ ...p, insight: insightById.get(p.id) ?? "" }));

  const removed = new Set(metrics.sections.removed);
  return {
    period: metrics.period,
    headline: analysis.headline,
    executiveSummary: analysis.executiveSummary,
    stages: metrics.funnel.stages.map((s) => ({
      ...s,
      diagnosis: analysis.stageDiagnoses[s.key],
    })),
    bottleneck: analysis.bottleneck,
    dataNotes: metrics.funnel.dataNotes,
    contentInsight: removed.has("content_insight")
      ? null
      : (analysis.contentInsight ?? null),
    topPosts: attach(metrics.topPosts),
    worstPosts: removed.has("worst_posts") ? [] : attach(metrics.worstPosts),
    nextActions: analysis.nextActions,
    additionalSections: analysis.additionalSections ?? [],
    kpiStrip: metrics.kpiStrip,
    show: {
      worstPosts: !removed.has("worst_posts"),
      contentInsight: !removed.has("content_insight"),
      kpiStrip: !removed.has("kpi_strip"),
    },
  };
}
