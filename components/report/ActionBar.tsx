"use client";

// 画面表示専用のボタン群(印刷/PDFには写らない)。
// 「PDFで保存」はブラウザの印刷機能 = Chromiumの印刷エンジンなので、
// サーバーでPuppeteerを動かすのと同品質のPDFが無料で得られる。
export function ActionBar({ token, hasPdf }: { token: string; hasPdf: boolean }) {
  return (
    <div className="no-print mb-6 flex items-center justify-between gap-3">
      <a
        href="/reports"
        className="text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        ← レポート一覧に戻る
      </a>
      <div className="flex gap-3">
        {hasPdf && (
          <a
            href={`/api/reports/${token}/pdf`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            PDFをダウンロード
          </a>
        )}
        <button
          onClick={() => window.print()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          style={{ backgroundColor: "var(--brand)" }}
        >
          PDFで保存 / 印刷
        </button>
      </div>
    </div>
  );
}
