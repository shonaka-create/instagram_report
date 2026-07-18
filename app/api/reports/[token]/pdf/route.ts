import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// PDFダウンロード: Storageの直リンクは配らず、リクエスト時に
// 1時間有効の署名付きURLを発行してリダイレクトする(失効管理のため)。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const db = supabaseAdmin();

  const { data: report } = await db
    .from("reports")
    .select("pdf_path")
    .eq("access_token", token)
    .eq("status", "published")
    .maybeSingle();

  if (!report?.pdf_path) {
    return NextResponse.json(
      { error: "PDFはまだ生成されていません" },
      { status: 404 }
    );
  }

  const { data, error } = await db.storage
    .from("reports")
    .createSignedUrl(report.pdf_path, 3600);
  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "署名付きURLの発行に失敗しました" },
      { status: 500 }
    );
  }

  return NextResponse.redirect(data.signedUrl);
}
