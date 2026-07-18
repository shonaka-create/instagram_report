import type { PostView, ReportView } from "@/lib/report-schema";

// 保存率が主指標(発見タブ露出の絶対基準)なので、いいね/コメントより保存率を主役に。
function PostCard({
  post,
  rank,
  tone,
}: {
  post: PostView;
  rank: number;
  tone: "win" | "lose";
}) {
  const badge = tone === "win" ? "bg-emerald-500" : "bg-slate-400";
  return (
    <article className="rounded-xl border border-slate-200 p-5 print:break-inside-avoid">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white ${badge}`}
          >
            {rank}
          </span>
          <p className="mt-2 text-slate-700">{post.caption.slice(0, 80)}</p>
        </div>
        <div className="shrink-0 text-right text-sm text-slate-500">
          <p className="tabular-nums font-semibold text-slate-700">
            保存率 {post.saveRate === null ? "—" : `${post.saveRate}%`}
          </p>
          <p className="tabular-nums text-xs">
            エンゲージ {post.engagement.toLocaleString()}
          </p>
        </div>
      </div>
      {post.insight && (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
          {post.insight}
        </p>
      )}
      {post.permalink && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="no-print mt-2 inline-block text-sm underline"
          style={{ color: "var(--brand)" }}
        >
          投稿を見る →
        </a>
      )}
    </article>
  );
}

export function ContentInsight({
  contentInsight,
  topPosts,
  worstPosts,
}: {
  contentInsight: ReportView["contentInsight"];
  topPosts: PostView[];
  worstPosts: PostView[];
}) {
  if (!contentInsight && topPosts.length === 0 && worstPosts.length === 0) {
    return null;
  }
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-bold" style={{ color: "var(--brand)" }}>
        コンテンツ診断
      </h2>

      {contentInsight && (
        <div className="mb-6 grid gap-4 md:grid-cols-2 print:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <p className="mb-1 text-sm font-bold text-emerald-700">
              刺さった訴求(勝ちパターン)
            </p>
            <p className="text-sm leading-relaxed text-slate-700">
              {contentInsight.winPattern}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="mb-1 text-sm font-bold text-slate-600">
              伸びなかった要因
            </p>
            <p className="text-sm leading-relaxed text-slate-700">
              {contentInsight.losePattern}
            </p>
          </div>
        </div>
      )}

      {topPosts.length > 0 && (
        <>
          <h3 className="mb-3 text-sm font-bold text-slate-500">
            保存率トップ {topPosts.length}
          </h3>
          <div className="mb-6 space-y-4">
            {topPosts.map((p, i) => (
              <PostCard key={p.id} post={p} rank={i + 1} tone="win" />
            ))}
          </div>
        </>
      )}

      {worstPosts.length > 0 && (
        <>
          <h3 className="mb-3 text-sm font-bold text-slate-500">
            反応が低かった投稿
          </h3>
          <div className="space-y-4">
            {worstPosts.map((p, i) => (
              <PostCard key={p.id} post={p} rank={i + 1} tone="lose" />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
