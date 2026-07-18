import type { ReportView } from "@/lib/report-schema";

export function NextActions({ items }: { items: ReportView["nextActions"] }) {
  // ボトルネック直撃の施策(high)を先頭に寄せる
  const sorted = [...items].sort((a, b) =>
    a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1
  );
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-bold" style={{ color: "var(--brand)" }}>
        来月のアクションプラン
      </h2>
      <ol className="space-y-4">
        {sorted.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-3 print:break-inside-avoid"
          >
            <span
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: "var(--brand)" }}
            >
              {i + 1}
            </span>
            <div>
              <div className="flex items-center gap-2">
                {item.priority === "high" && (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20">
                    最優先
                  </span>
                )}
                <span className="font-semibold leading-relaxed text-slate-800">
                  {item.action}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                {item.why}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
