import type { ReportView } from "@/lib/report-schema";

// クライアント固有の観点モジュール(clients.modules.add で有効化)ごとの分析セクション
export function AdditionalSections({
  sections,
}: {
  sections: ReportView["additionalSections"];
}) {
  if (sections.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-bold" style={{ color: "var(--brand)" }}>
        追加分析
      </h2>
      <div className="space-y-4">
        {sections.map((s) => (
          <div
            key={s.moduleKey}
            className="rounded-xl border border-slate-200 p-5 print:break-inside-avoid"
          >
            <p className="mb-2 text-sm font-bold text-slate-700">{s.title}</p>
            <p className="text-sm leading-relaxed text-slate-600">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
