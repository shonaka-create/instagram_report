import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { ReportSchema } from "@/lib/report-schema";
import { ReportHeader } from "@/components/report/ReportHeader";
import { KpiGrid } from "@/components/report/KpiGrid";
import { SummarySection } from "@/components/report/SummarySection";
import { TopPosts } from "@/components/report/TopPosts";
import { NextActions } from "@/components/report/NextActions";
import { ActionBar } from "@/components/report/ActionBar";

export const dynamic = "force-dynamic";

// 正本はDBのreport_json(Claudeの出力)。HTMLは都度レンダリングするため、
// テンプレート改善が過去レポートにも即反映される。
export default async function ReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data } = await supabaseAdmin()
    .from("reports")
    .select("report_json, period, pdf_path, clients(name, brand_color)")
    .eq("access_token", token)
    .eq("status", "published")
    .maybeSingle();

  if (!data?.report_json) notFound();

  const report = ReportSchema.parse(data.report_json);
  const client = data.clients as unknown as {
    name: string;
    brand_color: string;
  };

  return (
    <main
      className="mx-auto max-w-3xl bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none"
      style={{ "--brand": client.brand_color } as React.CSSProperties}
    >
      <ActionBar token={token} hasPdf={Boolean(data.pdf_path)} />
      <ReportHeader clientName={client.name} period={report.period} />
      <KpiGrid kpis={report.kpis} />
      <SummarySection text={report.summary} />
      <div className="page-break" />
      <TopPosts posts={report.topPosts} />
      <NextActions items={report.nextActions} />
      <footer className="mt-12 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
        本レポートはInstagram公式APIのデータに基づき自動生成されています
      </footer>
    </main>
  );
}
