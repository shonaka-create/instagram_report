// 社内向けの簡易ログイン画面。POST先の /api/login がcookieを発行する
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { error, from } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form
        method="POST"
        action="/api/login"
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-lg font-bold text-slate-800">Instagram 月次レポート</h1>
        <p className="mt-1 text-sm text-slate-500">
          閲覧にはパスワードが必要です
        </p>
        {error && (
          <p className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">
            パスワードが違います
          </p>
        )}
        <input type="hidden" name="from" value={from ?? "/reports"} />
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="パスワード"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          ログイン
        </button>
      </form>
    </main>
  );
}
