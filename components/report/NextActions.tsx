export function NextActions({ items }: { items: string[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-bold" style={{ color: "var(--brand)" }}>
        来月のアクションプラン
      </h2>
      <ol className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 print:break-inside-avoid">
            <span
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: "var(--brand)" }}
            >
              {i + 1}
            </span>
            <span className="leading-relaxed text-slate-700">{item}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
