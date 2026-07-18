import type { Report } from "@/lib/report-schema";

export function KpiGrid({ kpis }: { kpis: Report["kpis"] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-bold" style={{ color: "var(--brand)" }}>
        主要指標
      </h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-3">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-slate-200 p-4 print:break-inside-avoid"
          >
            <p className="text-sm text-slate-500">{kpi.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {kpi.value.toLocaleString()}
            </p>
            {kpi.momChangePct !== null && (
              <p
                className={`mt-1 text-sm font-medium tabular-nums ${
                  kpi.momChangePct >= 0 ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {kpi.momChangePct >= 0 ? "▲" : "▼"} 前月比{" "}
                {Math.abs(kpi.momChangePct).toFixed(1)}%
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
