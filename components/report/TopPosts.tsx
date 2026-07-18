import type { Report } from "@/lib/report-schema";

export function TopPosts({ posts }: { posts: Report["topPosts"] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-bold" style={{ color: "var(--brand)" }}>
        人気投稿 TOP{posts.length}
      </h2>
      <div className="space-y-4">
        {posts.map((post, i) => (
          <article
            key={post.mediaId}
            className="rounded-xl border border-slate-200 p-5 print:break-inside-avoid"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: "var(--brand)" }}
                >
                  {i + 1}
                </span>
                <p className="mt-2 text-slate-700">{post.caption}</p>
              </div>
              <div className="shrink-0 text-right text-sm text-slate-500">
                <p className="tabular-nums">♥ {post.likeCount.toLocaleString()}</p>
                <p className="tabular-nums">💬 {post.commentsCount.toLocaleString()}</p>
              </div>
            </div>
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
              {post.insight}
            </p>
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="no-print mt-2 inline-block text-sm underline"
              style={{ color: "var(--brand)" }}
            >
              投稿を見る →
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
