export function SummarySection({ text }: { text: string }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-bold" style={{ color: "var(--brand)" }}>
        今月の総評
      </h2>
      <p className="whitespace-pre-wrap leading-relaxed text-slate-700">{text}</p>
    </section>
  );
}
