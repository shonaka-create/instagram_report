/**
 * Instagramデータ取得とファネル指標計算の「単一実装」。
 *
 * Vercel cron (app/api/cron/monthly) と MCPサーバー (src/index.ts) の両方が
 * このモジュールを直接importする。取得・計算のコードを一箇所に集約することで、
 * 「経路によって数値が食い違う」事故を構造的に排除する。
 *
 * 設計原則(数値安全):
 *  1. すべての数値はここで計算し、分析モデルは一切計算しない(文章のみ書く)
 *  2. 各比率は分子と分母の母集団を必ず揃える
 *     - save_rate: 投稿合算の保存 ÷ 投稿合算のリーチ
 *     - profile_transition_rate: プロフ遷移 ÷ アカウント重複排除リーチ
 *       (投稿合算リーチを分母に流用しない = 重複計上による過小評価を防ぐ)
 *  3. 取得できない指標は null → verdict "unknown"。推測値で埋めない
 *  4. 依存ゼロ(fetchのみ)。Next.js/MCPどちらのビルドにも安全に取り込める
 */

// ---------------------------------------------------------------------------
// ベンチマーク(合格ライン)と観点モジュール定義
// ---------------------------------------------------------------------------

export const FUNNEL_BENCHMARKS = {
  save_rate: 2.0, // 保存率: 発見タブ・外部露出の強さ
  home_rate: 30.0, // ホーム率: 既存フォロワーの熱狂度
  profile_transition_rate: 2.0, // プロフィール遷移率: 投稿→プロフの誘導力
  follower_conversion_rate: 10.0, // フォロワー転換率: プロフ→フォローの説得力
} as const;

export type FunnelKey = keyof typeof FUNNEL_BENCHMARKS;
export type Verdict = "pass" | "warn" | "fail" | "unknown";

export const FUNNEL_LABELS: Record<FunnelKey, string> = {
  save_rate: "保存率",
  home_rate: "ホーム率",
  profile_transition_rate: "プロフィール遷移率",
  follower_conversion_rate: "フォロワー転換率",
};

/**
 * クライアントごとに追加できる観点モジュール。
 * clients.modules = { "add": ["reels","timing"], "remove": ["worst_posts"] }
 * add のモジュールは analysis.additionalSections として文章化される。
 * remove はレポートの基本セクションを非表示にする。
 */
export const MODULE_DEFS: Record<string, { title: string; guidance: string }> = {
  reels: {
    title: "リール分析",
    guidance:
      "posts の type(VIDEO/REELS vs CAROUSEL_ALBUM/IMAGE)別に、リーチ・保存率の傾向差を比較し、リール(非フォロワー配信)とフィード(フォロワー内配信)の役割分担がとれているかを診断する。数値はpostsにある値のみ言及可。",
  },
  timing: {
    title: "投稿タイミング分析",
    guidance:
      "posts の date(曜日)と反応の関係から、初速シグナルが集まりやすい投稿タイミングの仮説を立てる。データが少ない月は「傾向を断定するには不足」と明記する。",
  },
  cta: {
    title: "キャプションCTA品質",
    guidance:
      "posts の caption を読み、保存・プロフィール誘導のCTA(行動喚起)が機能しているかを具体的な文言引用つきで診断し、改善文案を1つ提示する。",
  },
  trend: {
    title: "前月比トレンド",
    guidance:
      "kpiStrip の momChangePct(サーバー計算済み)を使い、伸び/鈍化の因果を心理×アルゴリズムで説明する。momChangePct が null の指標は言及しない。",
  },
};

/** remove で指定できる基本セクション */
export const REMOVABLE_SECTIONS = ["worst_posts", "content_insight", "kpi_strip"] as const;
export type RemovableSection = (typeof REMOVABLE_SECTIONS)[number];

export type ModulesConfig = {
  add?: string[]; // MODULE_DEFS のキー
  remove?: string[]; // REMOVABLE_SECTIONS のキー
  note?: string; // このクライアント固有の自由記述の観点メモ(分析指針に添付)
};

// ---------------------------------------------------------------------------
// Instagram API (Instagramログイン方式 / graph.instagram.com)
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

// ---------------------------------------------------------------------------
// 生データの形 (DBの reports.raw_insights に保存される正本)
// ---------------------------------------------------------------------------

export type RawPost = {
  id: string;
  date: string | null; // "YYYY-MM-DD"
  type: string | null; // IMAGE / VIDEO / CAROUSEL_ALBUM
  permalink: string | null;
  caption: string; // 冒頭200字
  likes: number;
  comments: number;
  reach: number | null;
  saved: number | null;
  views: number | null;
};

export type RawInsights = {
  schemaVersion: 2;
  period: string; // "YYYY-MM"
  fetchedAt: string;
  profile: { username: string | null; followers: number; mediaCount: number | null };
  posts: RawPost[];
  account: {
    profileViews: number | null;
    followerReach: number | null;
    nonFollowerReach: number | null;
    accountReach: number | null;
    netNewFollows: number | null;
    notes: string[]; // 取得できなかったメトリクスの記録
  };
};

// total_value 形式のアカウントインサイト応答から値を取り出すヘルパー群
type TotalValueMetric = {
  name?: string;
  total_value?: {
    value?: number;
    breakdowns?: Array<{
      results?: Array<{ dimension_values?: string[]; value?: number }>;
    }>;
  };
};

function totalValueOf(res: Record<string, unknown>): number | null {
  const item = ((res.data ?? []) as TotalValueMetric[])[0];
  const v = item?.total_value?.value;
  return typeof v === "number" ? v : null;
}

function breakdownByFollowType(res: Record<string, unknown>): {
  follower: number | null;
  nonFollower: number | null;
} {
  const item = ((res.data ?? []) as TotalValueMetric[])[0];
  const results = item?.total_value?.breakdowns?.[0]?.results ?? [];
  let follower: number | null = null;
  let nonFollower: number | null = null;
  for (const r of results) {
    const dim = (r.dimension_values?.[0] ?? "").toUpperCase();
    if (dim.includes("NON")) nonFollower = r.value ?? 0;
    else if (dim.includes("FOLLOW")) follower = r.value ?? 0;
  }
  return { follower, nonFollower };
}

/** 月間の生データを取得する(取得のみ。計算は computeMetrics が行う) */
export async function fetchRawInsights(
  accessToken: string,
  period: string
): Promise<RawInsights> {
  const [year, month] = period.split("-").map(Number);
  const since = Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  const until = Math.floor(Date.UTC(year, month, 1) / 1000);

  // "me" = トークンに紐づくInstagramアカウント自身
  const profile = await igGet(
    "me",
    { fields: "username,followers_count,media_count" },
    accessToken
  );

  const mediaRes = await igGet(
    "me/media",
    {
      fields:
        "id,caption,media_type,permalink,like_count,comments_count,timestamp",
      since: String(since),
      until: String(until),
      limit: "50",
    },
    accessToken
  );
  type MediaRow = {
    id: string;
    timestamp?: string;
    media_type?: string;
    permalink?: string;
    caption?: string;
    like_count?: number;
    comments_count?: number;
  };
  const media = (mediaRes.data ?? []) as MediaRow[];

  const posts: RawPost[] = [];
  for (const m of media) {
    let ins: Record<string, number> = {};
    try {
      const res = await igGet(
        `${m.id}/insights`,
        { metric: "reach,saved,views" },
        accessToken
      );
      for (const item of (res.data ?? []) as Array<{
        name: string;
        values?: Array<{ value: number }>;
      }>) {
        ins[item.name] = item.values?.[0]?.value ?? 0;
      }
    } catch {
      ins = {}; // このメディア種別では取得不可
    }
    posts.push({
      id: m.id,
      date: m.timestamp?.slice(0, 10) ?? null,
      type: m.media_type ?? null,
      permalink: m.permalink ?? null,
      caption: (m.caption ?? "").slice(0, 200),
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      reach: ins.reach ?? null,
      saved: ins.saved ?? null,
      views: ins.views ?? null,
    });
  }

  // --- アカウント単位インサイト(取得不可でも投稿分析は成立させる) ---
  // period=day は total_value メトリクスでも必須(欠けると "period is required" で全滅する)。
  const notes: string[] = [];
  const range = { period: "day", since: String(since), until: String(until) };

  let profileViews: number | null = null;
  try {
    const res = await igGet(
      "me/insights",
      { metric: "profile_views", metric_type: "total_value", ...range },
      accessToken
    );
    profileViews = totalValueOf(res);
    if (profileViews === null)
      notes.push("profile_views が空でした(プロフィール遷移率は測定不可)");
  } catch {
    notes.push("profile_views を取得できませんでした(プロフィール遷移率は測定不可)");
  }

  let followerReach: number | null = null;
  let nonFollowerReach: number | null = null;
  try {
    const res = await igGet(
      "me/insights",
      {
        metric: "reach",
        metric_type: "total_value",
        breakdown: "follow_type",
        ...range,
      },
      accessToken
    );
    const b = breakdownByFollowType(res);
    followerReach = b.follower;
    nonFollowerReach = b.nonFollower;
    if (followerReach === null && nonFollowerReach === null)
      notes.push("フォロワー種別リーチが空でした(ホーム率は測定不可)");
  } catch {
    notes.push("フォロワー種別リーチを取得できませんでした(ホーム率は測定不可)");
  }
  const accountReach =
    followerReach !== null || nonFollowerReach !== null
      ? (followerReach ?? 0) + (nonFollowerReach ?? 0)
      : null;

  let netNewFollows: number | null = null;
  try {
    const res = await igGet(
      "me/insights",
      { metric: "follows_and_unfollows", metric_type: "total_value", ...range },
      accessToken
    );
    netNewFollows = totalValueOf(res);
    if (netNewFollows === null)
      notes.push(
        "純増フォロワー(follows_and_unfollows)が空でした(フォロワー転換率は測定不可)"
      );
  } catch {
    notes.push(
      "純増フォロワー(follows_and_unfollows)を取得できませんでした(フォロワー転換率は測定不可)"
    );
  }

  return {
    schemaVersion: 2,
    period,
    fetchedAt: new Date().toISOString(),
    profile: {
      username: (profile.username as string) ?? null,
      followers: Number(profile.followers_count ?? 0),
      mediaCount: (profile.media_count as number) ?? null,
    },
    posts,
    account: {
      profileViews,
      followerReach,
      nonFollowerReach,
      accountReach,
      netNewFollows,
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// 指標計算 (決定的・純関数。生データが同じなら必ず同じ数値になる)
// ---------------------------------------------------------------------------

export type PostMetric = RawPost & {
  engagement: number;
  viewsPerReach: number | null;
  saveRate: number | null; // 保存÷リーチ の%
};

export type FunnelStageMetric = {
  key: FunnelKey;
  label: string;
  value: number | null; // %
  benchmark: number; // %
  gapPt: number | null; // value - benchmark (合格ラインまでの差、モデルが再計算しないよう提供)
  verdict: Verdict;
  caveat: string | null; // 数値がありえない値(100%超・負)のときだけ妥当性の一言。通常はnull
};

export type KpiItem = {
  key: string;
  label: string;
  value: number;
  momChangePct: number | null; // 前月metricsがある場合のみサーバー計算
};

export type Metrics = {
  schemaVersion: 2;
  period: string;
  account: { username: string | null; followers: number; postCount: number };
  posts: PostMetric[];
  funnel: {
    stages: FunnelStageMetric[];
    raw: {
      profileViews: number | null;
      followerReach: number | null;
      nonFollowerReach: number | null;
      accountReach: number | null;
      netNewFollows: number | null;
      totalPostReach: number;
      totalSaved: number;
    };
    dataNotes: string[];
  };
  topPosts: PostMetric[]; // 保存率降順 最大3件
  worstPosts: PostMetric[]; // エンゲージ昇順 最大3件(topと重複する投稿は除く)
  kpiStrip: KpiItem[];
  flags: string[];
  sections: { addModules: string[]; removed: string[]; note: string | null };
};

const pct = (num: number, den: number | null): number | null =>
  den && den > 0 ? Math.round((num / den) * 1000) / 10 : null;

function verdictFor(value: number | null, benchmark: number): Verdict {
  if (value === null) return "unknown";
  if (value >= benchmark) return "pass";
  if (value >= benchmark * 0.75) return "warn";
  return "fail";
}

// ありえない値(比率が100%超・負)のときだけ、その数値の妥当性を一言で返す。
// 通常の範囲なら null(注記を出さない)。母数が小さい月ほど比率は跳ねやすい。
function stageCaveat(key: FunnelKey, value: number | null): string | null {
  if (value === null) return null;
  if (value > 100) {
    if (key === "profile_transition_rate")
      return "参考値: プロフィール閲覧は検索・発見タブなど投稿以外からの流入や複数回訪問も含むため、リーチを上回り100%を超えることがあります。母数が小さいほど振れるため、確定値ではなく傾向として見てください。";
    if (key === "save_rate" || key === "home_rate")
      return "参考値: 母数が小さく比率が100%を超えています。数値が跳ねやすい状態のため、傾向として見てください。";
    return "参考値: 母数が小さく100%を超えています。傾向として見てください。";
  }
  if (value < 0)
    return "参考値: マイナスは純減(フォロー解除が新規獲得を上回った)を意味します。";
  return null;
}

export function computeMetrics(
  raw: RawInsights,
  opts?: { prevMetrics?: Metrics | null; modules?: ModulesConfig | null }
): Metrics {
  const posts: PostMetric[] = raw.posts.map((p) => ({
    ...p,
    engagement: p.likes + p.comments,
    viewsPerReach:
      p.reach && p.views !== null
        ? Math.round((p.views / p.reach) * 10) / 10
        : null,
    saveRate: p.saved !== null ? pct(p.saved, p.reach) : null,
  }));

  const followers = raw.profile.followers;
  const totalPostReach = posts.reduce((a, p) => a + (p.reach ?? 0), 0);
  const totalSaved = posts.reduce((a, p) => a + (p.saved ?? 0), 0);
  const totalLikes = posts.reduce((a, p) => a + p.likes, 0);
  const totalComments = posts.reduce((a, p) => a + p.comments, 0);
  const acct = raw.account;

  // --- ファネル4指標(分子分母の母集団を必ず揃える) ---
  const funnelValues: Record<FunnelKey, number | null> = {
    save_rate: totalPostReach > 0 ? pct(totalSaved, totalPostReach) : null,
    home_rate:
      acct.followerReach !== null && followers > 0
        ? pct(acct.followerReach, followers)
        : null,
    profile_transition_rate:
      acct.profileViews !== null && acct.accountReach
        ? pct(acct.profileViews, acct.accountReach)
        : null,
    follower_conversion_rate:
      acct.netNewFollows !== null && acct.profileViews
        ? pct(acct.netNewFollows, acct.profileViews)
        : null,
  };

  const stages: FunnelStageMetric[] = (
    Object.keys(FUNNEL_BENCHMARKS) as FunnelKey[]
  ).map((key) => {
    const value = funnelValues[key];
    const benchmark = FUNNEL_BENCHMARKS[key];
    return {
      key,
      label: FUNNEL_LABELS[key],
      value,
      benchmark,
      gapPt: value === null ? null : Math.round((value - benchmark) * 10) / 10,
      verdict: verdictFor(value, benchmark),
      caveat: stageCaveat(key, value),
    };
  });

  // --- top/worst の選定も決定的に(モデルに選ばせない) ---
  const topPosts = [...posts]
    .sort((a, b) => (b.saveRate ?? -1) - (a.saveRate ?? -1))
    .slice(0, 3);
  const topIds = new Set(topPosts.map((p) => p.id));
  const worstPosts = [...posts]
    .filter((p) => !topIds.has(p.id))
    .sort((a, b) => a.engagement - b.engagement)
    .slice(0, 3);

  // --- 参考KPI帯(前月metricsがあれば前月比もサーバー計算) ---
  const kpiBase: Array<{ key: string; label: string; value: number | null }> = [
    { key: "reach", label: "リーチ(投稿合算)", value: totalPostReach },
    { key: "followers", label: "フォロワー数", value: followers },
    { key: "profile_views", label: "プロフィール閲覧", value: acct.profileViews },
    { key: "net_follows", label: "純増フォロワー", value: acct.netNewFollows },
    { key: "saved", label: "保存合計", value: totalSaved },
    { key: "engagement", label: "エンゲージ合計", value: totalLikes + totalComments },
    { key: "posts", label: "投稿数", value: posts.length },
  ];
  const prevKpis = new Map(
    (opts?.prevMetrics?.kpiStrip ?? []).map((k) => [k.key, k.value])
  );
  const kpiStrip: KpiItem[] = kpiBase
    .filter((k): k is { key: string; label: string; value: number } => k.value !== null)
    .map((k) => {
      const prev = prevKpis.get(k.key);
      return {
        ...k,
        momChangePct:
          prev !== undefined && prev !== 0
            ? Math.round(((k.value - prev) / prev) * 1000) / 10
            : null,
      };
    });

  // --- 構造的問題の自動検出 ---
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
  if (posts.length > 0 && totalSaved === 0)
    flags.push(
      "全投稿で保存0(保存はアルゴリズムが最重視するシグナル。発見タブ露出の起点が欠けている)"
    );
  const reachToFollowerPct = pct(totalPostReach, followers || null);
  if (reachToFollowerPct !== null && reachToFollowerPct < 50)
    flags.push(
      `合計リーチがフォロワー数の${reachToFollowerPct}%に留まる(既存フォロワーにも届き切っていない)`
    );
  for (const s of stages) {
    if (s.verdict === "fail")
      flags.push(
        `${s.label} ${s.value}% が合格ライン${s.benchmark}%を下回る(ファネルの穴の候補)`
      );
  }

  // --- 観点モジュール設定の正規化 ---
  const modules = opts?.modules ?? {};
  const addModules = (modules.add ?? []).filter((k) => k in MODULE_DEFS);
  const removed = (modules.remove ?? []).filter((k) =>
    (REMOVABLE_SECTIONS as readonly string[]).includes(k)
  );

  return {
    schemaVersion: 2,
    period: raw.period,
    account: {
      username: raw.profile.username,
      followers,
      postCount: posts.length,
    },
    posts,
    funnel: {
      stages,
      raw: {
        profileViews: acct.profileViews,
        followerReach: acct.followerReach,
        nonFollowerReach: acct.nonFollowerReach,
        accountReach: acct.accountReach,
        netNewFollows: acct.netNewFollows,
        totalPostReach,
        totalSaved,
      },
      dataNotes: acct.notes,
    },
    topPosts,
    worstPosts,
    kpiStrip,
    flags,
    sections: {
      addModules,
      removed,
      note: modules.note ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// 分析指針の生成 (モデルは文章のみを書く。数値は一切出力させない)
// ---------------------------------------------------------------------------

export function buildAnalysisGuidelines(metrics: Metrics): string {
  const moduleLines = metrics.sections.addModules.map(
    (k) => `  - ${k}: 「${MODULE_DEFS[k].title}」 — ${MODULE_DEFS[k].guidance}`
  );
  const removedLine =
    metrics.sections.removed.length > 0
      ? `除外セクション: ${metrics.sections.removed.join(", ")}(このセクションの文章は書かない)`
      : null;

  return [
    "あなたはトップクラスのSNS戦略コンサルタントとして、このデータの分析文章を書く。",
    "",
    "【最重要】このレポートの価値は『アプリを見ればわかる素の数値』ではなく、合格ライン(ベンチマーク)に対する診断にある。",
    "",
    "== 数値の扱い(絶対厳守) ==",
    "- あなたは数値を一切計算しない・出力しない。数値はすべてサーバー計算済みで、レポートには自動で埋め込まれる",
    "- 文章内で具体的な数値に触れたいときは funnel.stages の value/benchmark/gapPt、posts の saveRate 等『この出力に存在する値』だけを引用してよい(自分で四則演算した値は禁止)",
    "- verdict が unknown の指標は「この指標は未取得のため測定不可」と書き、断定しない(dataNotes参照)",
    "",
    "== 診断ロジック ==",
    "- funnel.stages の verdict(pass/warn/fail/unknown)を軸に、認知→興味(保存)→信頼(プロフ遷移)→行動(フォロー転換)のどこが最優先の穴かを1つ特定する",
    "- fail のステージが今月のボトルネック。処方の定石: 保存率未達→まとめ系・図解カルーセル強化 / ホーム率未達→ストーリーズのアンケート・Q&Aで内側の熱量を先に上げる / プロフ遷移率未達→最終画像とキャプションのCTA改善 / フォロワー転換率未達→バイオ1行目とハイライト整理を最優先TODOに",
    "- flags の警告は必ず反映する",
    "",
    "== 文章の質 ==",
    "- 数値の読み上げ禁止。必ず『なぜこの水準か』を閲覧者心理(自己開示への返報性、保存の動機、単純接触効果)とアルゴリズム(初速シグナル、滞在時間、保存・シェアの重み、フィード=フォロワー内配信/リール=非フォロワー配信の構造差)で説明する",
    "- topPosts の insight は 観察→因果(心理/アルゴリズム)→次の一手 の3要素。winPattern は保存率トップの『なぜ後で見返したくなったか(テーマ・切り口・ターゲットの悩み)』を再現可能な勝ちパターンとして言語化する",
    "- worstPosts の insight は原因の仮説と改善案(批評で終わらせない)",
    "- nextActions は3〜5個。ボトルネック直撃の施策を priority:high に。最低1つは「やめること(リソースの引き上げ)」を含め、各施策に why を添える",
    "",
    "== 文体(AIっぽさを消す。実在の戦略コンサル/SNSマーケターとして) ==",
    "- 主語述語を短く、事実→原因→打ち手の順で言い切る。1文を長くしない",
    "- 使用禁止の常套句・AIっぽい表現: 「追い風」「崩さず活かす」「〜していきましょう」「引き続き注視」「〜と思われます」「本数の谷」等の凝った比喩、「頑張りましょう」、過度なポジティブ締め",
    "- 鉤括弧『』での強調は使わない(必要な固有名詞は「」でよいが多用しない)",
    "- 抽象比喩より具体語。例: ×『本数の谷を作らない』→ ○『1投稿ずつ日を分ける』",
    "- 逃げ口上・両論併記で締めない。断定して責任を持つ。ただし unknown 指標は測定不可と明記する",
    "",
    ...(moduleLines.length > 0
      ? ["== このクライアントの追加観点(additionalSections に各1セクション書く) ==", ...moduleLines, ""]
      : []),
    ...(removedLine ? [`== セクション除外 ==`, removedLine, ""] : []),
    ...(metrics.sections.note
      ? ["== クライアント固有メモ(分析時に考慮) ==", metrics.sections.note, ""]
      : []),
    "書き終えたら publish_report ツールに analysis として渡すこと(スキーマはツール定義のとおり)。",
  ].join("\n");
}
