import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { ReportSchema, toReportView } from "@/lib/report-schema";
import { ReportHeader } from "@/components/report/ReportHeader";
import { SummarySection } from "@/components/report/SummarySection";
import { FunnelDiagnosis } from "@/components/report/FunnelDiagnosis";
import { ContentInsight } from "@/components/report/ContentInsight";
import { AdditionalSections } from "@/components/report/AdditionalSections";
import { NextActions } from "@/components/report/NextActions";
import { KpiStrip } from "@/components/report/KpiStrip";
import { ActionBar } from "@/components/report/ActionBar";
import { AutoPrint } from "@/components/report/AutoPrint";

export const dynamic = "force-dynamic";

// 正本はDBのreport_json({metrics, analysis})。HTMLは都度レンダリングするため、
// テンプレート改善が過去レポートにも即反映される。
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { token } = await params;
  const { print } = await searchParams;

  const { data } = await supabaseAdmin()
    .from("reports")
    .select("report_json, period, pdf_path, clients(name, brand_color, ig_username)")
    .eq("access_token", token)
    .eq("status", "published")
    .maybeSingle();

  if (!data?.report_json) notFound();

  const parsed = ReportSchema.safeParse(data.report_json);
  if (!parsed.success) notFound(); // 旧形式のレポートは再publishが必要
  const view = toReportView(parsed.data);
  const client = data.clients as unknown as {
    name: string;
    brand_color: string;
    ig_username: string | null;
  };

  return (
    <main
      className="mx-auto max-w-3xl bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none"
      style={{ "--brand": client.brand_color } as React.CSSProperties}
    >
      {print === "1" && <AutoPrint />}
      <ActionBar token={token} hasPdf={Boolean(data.pdf_path)} />
      <ReportHeader
        clientName={client.name}
        period={view.period}
        igUsername={client.ig_username}
      />
      <SummarySection headline={view.headline} text={view.executiveSummary} />
      <FunnelDiagnosis
        stages={view.stages}
        bottleneck={view.bottleneck}
        dataNotes={view.dataNotes}
      />
      <div className="page-break" />
      <ContentInsight
        contentInsight={view.contentInsight}
        topPosts={view.topPosts}
        worstPosts={view.worstPosts}
      />
      <AdditionalSections sections={view.additionalSections} />
      <NextActions items={view.nextActions} />
      {view.show.kpiStrip && <KpiStrip kpis={view.kpiStrip} />}
    </main>
  );
}
