export function ReportHeader({
  clientName,
  period,
  igUsername,
}: {
  clientName: string;
  period: string;
  igUsername?: string | null;
}) {
  const [year, month] = period.split("-");
  return (
    <header className="mb-8 border-b-4 pb-6" style={{ borderColor: "var(--brand)" }}>
      <p className="text-sm font-medium text-slate-500">Instagram 月次レポート</p>
      <h1 className="mt-1 text-3xl font-bold">
        {year}年{Number(month)}月
      </h1>
      <p className="mt-2 text-lg text-slate-600">
        {clientName} 様
        {igUsername && (
          <span className="ml-2 text-sm text-slate-400">@{igUsername}</span>
        )}
      </p>
    </header>
  );
}
