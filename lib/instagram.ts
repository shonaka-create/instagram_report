const GRAPH_BASE = "https://graph.facebook.com/v21.0";

// retryable=true のエラーはQStashのリトライに委ねる(レート制限・一時障害)。
// false は恒久エラー(トークン失効など)なのでリトライせず failed にする。
export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
}

async function igGet(
  path: string,
  params: Record<string, string>,
  accessToken: string
) {
  const qs = new URLSearchParams({ ...params, access_token: accessToken });
  const res = await fetch(`${GRAPH_BASE}/${path}?${qs}`);
  const json = await res.json();
  if (!res.ok || json.error) {
    const err = json.error ?? {};
    // code 4/17/32 = レート制限(リトライ可)、190 = トークン失効(恒久)
    const retryable =
      [4, 17, 32].includes(err.code) || res.status >= 500;
    throw new InstagramApiError(
      err.message ?? `Graph API error (HTTP ${res.status})`,
      err.code ?? null,
      retryable
    );
  }
  return json;
}

export async function fetchMonthlyInsights(
  igUserId: string,
  accessToken: string,
  period: string // "YYYY-MM"
) {
  const [year, month] = period.split("-").map(Number);
  const since = Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  const until = Math.floor(Date.UTC(year, month, 1) / 1000);

  const profile = await igGet(
    igUserId,
    { fields: "followers_count,media_count,username,name" },
    accessToken
  );

  const media = await igGet(
    `${igUserId}/media`,
    {
      fields:
        "id,caption,media_type,permalink,like_count,comments_count,timestamp",
      since: String(since),
      until: String(until),
      limit: "50",
    },
    accessToken
  );

  const accountInsights = await igGet(
    `${igUserId}/insights`,
    {
      metric: "reach,profile_views,accounts_engaged",
      metric_type: "total_value",
      period: "day",
      since: String(since),
      until: String(until - 1),
    },
    accessToken
  );

  return {
    period,
    fetchedAt: new Date().toISOString(),
    profile,
    media: media.data ?? [],
    accountInsights: accountInsights.data ?? [],
  };
}
