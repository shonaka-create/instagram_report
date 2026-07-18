import type { ReportView } from "@/lib/report-schema";

// 素の数値は「参考」として下部の帯に格下げ(レポートの主役はファネル診断)。
export function KpiStrip({ kpis }: { kpis: ReportView["kpiStrip"] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-sm font-bold text-slate-500">参考指標</h2>
      <p className="mb-3 text-xs text-slate-400">
        アプリ内でも確認できる素の数値です。診断の裏付けとしてご参照ください。
      </p>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 md:grid-cols-3 print:grid-cols-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white p-3 print:break-inside-avoid">
            <p className="text-xs text-slate-500">{kpi.label}</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">
              {kpi.value.toLocaleString()}
            </p>
            {kpi.momChangePct !== null && (
              <p
                className={`text-xs font-medium tabular-nums ${
                  kpi.momChangePct >= 0 ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {kpi.momChangePct >= 0 ? "▲" : "▼"}{" "}
                {Math.abs(kpi.momChangePct).toFixed(1)}%
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
