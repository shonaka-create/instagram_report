import type { StageView } from "@/lib/report-schema";

// verdict ごとの見た目。診断の主役なので色で合否が一目でわかるようにする。
const VERDICT = {
  pass: { label: "合格", text: "text-emerald-700", bar: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  warn: { label: "要改善", text: "text-amber-700", bar: "bg-amber-500", chip: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  fail: { label: "未達", text: "text-rose-700", bar: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-600/20" },
  unknown: { label: "測定不可", text: "text-slate-500", bar: "bg-slate-300", chip: "bg-slate-100 text-slate-500 ring-slate-500/20" },
} as const;

function StageRow({ stage }: { stage: StageView }) {
  const v = VERDICT[stage.verdict];
  // バーは合格ライン=100%地点として実測値の到達度を描く(未達がどれだけ遠いか可視化)
  const ratio =
    stage.value === null ? 0 : Math.min((stage.value / stage.benchmark) * 100, 130);

  return (
    <div className="print:break-inside-avoid">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">{stage.label}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${v.chip}`}
          >
            {v.label}
          </span>
        </div>
        <div className="flex items-center gap-2 tabular-nums">
          <span className={`text-lg font-bold ${v.text}`}>
            {stage.value === null ? "—" : `${stage.value}%`}
          </span>
          <span className="inline-flex items-baseline gap-1 rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-700">
            <span className="text-[11px] font-semibold tracking-wide">合格ライン</span>
            <span className="text-sm font-bold">{stage.benchmark}%</span>
          </span>
        </div>
      </div>

      {/* 合格ラインを基準線としたバー */}
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${v.bar}`}
          style={{ width: `${ratio}%` }}
        />
        <div
          className="absolute -top-0.5 h-3 w-0.5 bg-slate-500"
          style={{ left: `${100 / 1.3}%` }}
          aria-hidden
        />
      </div>

      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        {stage.diagnosis}
      </p>
    </div>
  );
}

export function FunnelDiagnosis({
  stages,
  bottleneck,
  dataNotes,
}: {
  stages: StageView[];
  bottleneck: string;
  dataNotes: string[];
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-xl font-bold" style={{ color: "var(--brand)" }}>
        ファネル診断
      </h2>
      <p className="mb-5 text-sm text-slate-500">
        認知(リーチ)→ 興味(保存)→ 信頼(プロフィール遷移)→ 行動(フォロー転換)の
        どこで人が離脱しているかを、業界基準(合格ライン)と照らして診断します。
      </p>

      <div className="space-y-5 rounded-xl border border-slate-200 p-5">
        {stages.map((s) => (
          <StageRow key={s.key} stage={s} />
        ))}
      </div>

      {/* 最優先の穴 — レポートの核 */}
      <div
        className="mt-5 rounded-xl border-l-4 bg-slate-50 p-5 print:break-inside-avoid"
        style={{ borderColor: "var(--brand)" }}
      >
        <p className="mb-1 text-sm font-bold" style={{ color: "var(--brand)" }}>
          最優先の課題(ボトルネック)
        </p>
        <p className="leading-relaxed text-slate-700">{bottleneck}</p>
      </div>

      {dataNotes.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          ※ {dataNotes.join(" / ")}
        </p>
      )}
    </section>
  );
}
