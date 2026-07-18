import { supabaseAdmin } from "./supabase";

// reports.status の状態機械:
// queued → fetching → fetched → analyzing → analyzed → publishing → published
//                                                                → failed
//
// QStashはat-least-once配送なので、各ジョブは冒頭で「期待するstatusのときだけ
// 次のstatusへ更新できた場合のみ処理する」条件付きUPDATEで重複実行を防ぐ。

export type ReportRow = {
  id: string;
  client_id: string;
  period: string;
  status: string;
  raw_insights: unknown;
  report_json: unknown;
  access_token: string;
  pdf_path: string | null;
  clients: {
    name: string;
    ig_user_id: string;
    ig_access_token: string;
    brand_color: string;
    wants_pdf: boolean;
  };
};

// 期待statusのときだけ処理中statusへ遷移させて行を確保する。
// 確保できなければ null(= 重複配送か順序違反なのでスキップ)。
export async function claimReport(
  reportId: string,
  expectedStatus: string,
  nextStatus: string
): Promise<ReportRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("reports")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("status", expectedStatus)
    .select(
      "*, clients(name, ig_user_id, ig_access_token, brand_color, wants_pdf)"
    );
  if (error) throw new Error(`claimReport failed: ${error.message}`);
  return (data?.[0] as ReportRow | undefined) ?? null;
}

export async function updateReport(
  reportId: string,
  patch: Record<string, unknown>
) {
  const { error } = await supabaseAdmin()
    .from("reports")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", reportId);
  if (error) throw new Error(`updateReport failed: ${error.message}`);
}

// 恒久エラー: failed を記録して200を返し、QStashのリトライを止める
export async function markFailed(reportId: string, message: string) {
  await updateReport(reportId, {
    status: "failed",
    error_message: message.slice(0, 2000),
  });
}

// 一時エラー: statusを元に戻して500を返し、QStashにリトライさせる
export async function releaseReport(reportId: string, backToStatus: string) {
  await updateReport(reportId, { status: backToStatus });
}
