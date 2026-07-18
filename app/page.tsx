export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">Instagram 月次レポート システム</h1>
      <p className="text-slate-600">
        レポートは発行された専用URL(/reports/…)からご覧いただけます。
      </p>
    </main>
  );
}
