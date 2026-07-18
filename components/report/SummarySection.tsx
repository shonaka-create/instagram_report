export function SummarySection({
  headline,
  text,
}: {
  headline: string;
  text: string;
}) {
  return (
    <section className="mb-10">
      {/* 今月の結論を一言で(まず読ませる) */}
      <p
        className="mb-4 border-l-4 pl-4 text-xl font-bold leading-snug text-slate-800"
        style={{ borderColor: "var(--brand)" }}
      >
        {headline}
      </p>
      <h2 className="mb-2 text-sm font-bold text-slate-500">エグゼクティブサマリー</h2>
      <p className="whitespace-pre-wrap leading-relaxed text-slate-700">{text}</p>
    </section>
  );
}
