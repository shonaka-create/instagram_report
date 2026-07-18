import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Row = {
  period: string;
  status: string;
  access_token: string;
  updated_at: string;
  clients: {
    name: string;
    slug: string | null;
    ig_username: string | null;
    brand_color: string;
  };
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  published: { label: "公開済み", cls: "bg-emerald-50 text-emerald-700" },
  fetched: { label: "データ取得済み(分析待ち)", cls: "bg-amber-50 text-amber-700" },
  failed: { label: "取得失敗", cls: "bg-rose-50 text-rose-700" },
  queued: { label: "待機中", cls: "bg-slate-100 text-slate-500" },
};

// レポート一覧(社内用)。クライアント・IGアカウント・対象月で絞り込み。
export default async function ReportsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; ig?: string; period?: string }>;
}) {
  const { client, ig, period } = await searchParams;
  const db = supabaseAdmin();

  const { data } = await db
    .from("reports")
    .select(
      "period, status, access_token, updated_at, clients!inner(name, slug, ig_username, brand_color)"
    )
    .order("period", { ascending: false })
    .order("updated_at", { ascending: false });

  let rows = (data ?? []) as unknown as Row[];
  if (client)
    rows = rows.filter(
      (r) =>
        r.clients.name.includes(client) || (r.clients.slug ?? "").includes(client)
    );
  if (ig) rows = rows.filter((r) => (r.clients.ig_username ?? "").includes(ig));
  if (period) rows = rows.filter((r) => r.period === period);

  // フィルタ選択肢
  const allClients = [...new Set((data ?? []).map((r) => (r as unknown as Row).clients.name))];
  const allPeriods = [...new Set((data ?? []).map((r) => (r as unknown as Row).period))];

  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">月次レポート一覧</h1>
        <p className="mt-1 text-sm text-slate-500">
          クライアント名・Instagramアカウント・対象月で絞り込めます
        </p>
      </header>

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-600">
          クライアント
          <select
            name="client"
            defaultValue={client ?? ""}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">すべて</option>
            {allClients.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          IGアカウント
          <input
            name="ig"
            defaultValue={ig ?? ""}
            placeholder="username"
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-slate-600">
          対象月
          <select
            name="period"
            defaultValue={period ?? ""}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">すべて</option>
            {allPeriods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          絞り込む
        </button>
        <Link href="/reports" className="text-sm text-slate-500 underline">
          クリア
        </Link>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          条件に一致するレポートがありません
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">対象月</th>
                <th className="px-4 py-3 font-medium">クライアント</th>
                <th className="px-4 py-3 font-medium">IGアカウント</th>
                <th className="px-4 py-3 font-medium">状態</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const st = STATUS_LABEL[r.status] ?? {
                  label: r.status,
                  cls: "bg-slate-100 text-slate-500",
                };
                return (
                  <tr key={`${r.clients.slug}-${r.period}`} className="bg-white">
                    <td className="px-4 py-3 font-semibold tabular-nums text-slate-700">
                      {r.period}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                        style={{ backgroundColor: r.clients.brand_color }}
                      />
                      {r.clients.name}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {r.clients.ig_username ? `@${r.clients.ig_username}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.status === "published" && (
                        <span className="inline-flex gap-3">
                          <Link
                            href={`/reports/${r.access_token}`}
                            className="font-medium text-slate-700 underline"
                          >
                            レポートを見る
                          </Link>
                          <Link
                            href={`/reports/${r.access_token}?print=1`}
                            className="text-slate-500 underline"
                            title="レポートを開いてブラウザの印刷からPDF保存"
                          >
                            PDF
                          </Link>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
