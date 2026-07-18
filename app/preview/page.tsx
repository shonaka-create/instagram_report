import { notFound } from "next/navigation";
import type { Report } from "@/lib/report-schema";
import { ReportHeader } from "@/components/report/ReportHeader";
import { KpiGrid } from "@/components/report/KpiGrid";
import { SummarySection } from "@/components/report/SummarySection";
import { TopPosts } from "@/components/report/TopPosts";
import { NextActions } from "@/components/report/NextActions";

// デザイン確認用プレビュー(npm run dev → http://localhost:3000/preview)。
// DBもAPIキーも不要。本番環境では404を返す。
const sample: Report = {
  period: "2026-06",
  summary:
    "6月はリール投稿を週2本に増やした効果が明確に表れた月でした。リーチ数は前月比24.5%増の45,200となり、特に「スタッフ紹介リール」が新規層への到達を牽引しています。一方でプロフィール閲覧からフォローへの転換率は横ばいのため、プロフィールのハイライト整理と固定投稿の刷新が次の課題です。保存数の多いお役立ち系投稿はフィードでの反応が安定しており、リールとフィードの役割分担が機能し始めています。",
  kpis: [
    { label: "リーチ数", value: 45200, momChangePct: 24.5 },
    { label: "フォロワー数", value: 8340, momChangePct: 3.2 },
    { label: "プロフィール閲覧", value: 2150, momChangePct: 11.8 },
    { label: "いいね合計", value: 6820, momChangePct: 18.9 },
    { label: "コメント合計", value: 342, momChangePct: -4.1 },
    { label: "投稿数", value: 14, momChangePct: null },
  ],
  topPosts: [
    {
      mediaId: "1",
      permalink: "https://www.instagram.com/p/sample1/",
      caption: "【スタッフ紹介】入社3年目のデザイナーに聞く、仕事のこだわり…",
      likeCount: 1240,
      commentsCount: 89,
      insight:
        "人物の顔が見えるリールは保存・シェアが通常投稿の約3倍。冒頭2秒のフックが視聴維持率を高め、発見タブ経由の新規リーチが全体の72%を占めました。",
    },
    {
      mediaId: "2",
      permalink: "https://www.instagram.com/p/sample2/",
      caption: "保存版!知らないと損する◯◯の選び方5選",
      likeCount: 980,
      commentsCount: 45,
      insight:
        "カルーセル形式のお役立ち投稿は保存率6.8%と高水準。「保存版」の文言がアクションを明示し、後から見返す動機を作れています。",
    },
    {
      mediaId: "3",
      permalink: "https://www.instagram.com/p/sample3/",
      caption: "お客様の声をご紹介します。「初めてでも安心して…」",
      likeCount: 720,
      commentsCount: 61,
      insight:
        "UGC(お客様の声)はコメント率が最も高く、既存フォロワーとの関係強化に寄与。信頼性の訴求として月1〜2本の定期化が有効です。",
    },
  ],
  nextActions: [
    "スタッフ紹介リールを月4本に定例化し、冒頭2秒のフック(質問形式)をテンプレート化する",
    "プロフィールのハイライトを「サービス/お客様の声/よくある質問」の3本に再編成する",
    "保存率の高いカルーセル投稿のテーマを月初にアンケート(ストーリーズ)で募集する",
    "コメント返信を24時間以内に統一し、コメント率の回復を図る",
  ],
};

export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main
      className="mx-auto max-w-3xl bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none"
      style={{ "--brand": "#0f766e" } as React.CSSProperties}
    >
      <div className="no-print mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        これはサンプルデータによるデザインプレビューです(本番では表示されません)
      </div>
      <ReportHeader clientName="株式会社サンプル" period={sample.period} />
      <KpiGrid kpis={sample.kpis} />
      <SummarySection text={sample.summary} />
      <div className="page-break" />
      <TopPosts posts={sample.topPosts} />
      <NextActions items={sample.nextActions} />
      <footer className="mt-12 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
        本レポートはInstagram公式APIのデータに基づき自動生成されています
      </footer>
    </main>
  );
}
