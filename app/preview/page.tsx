import { notFound } from "next/navigation";
import { type Report, toReportView } from "@/lib/report-schema";
import { ReportHeader } from "@/components/report/ReportHeader";
import { SummarySection } from "@/components/report/SummarySection";
import { FunnelDiagnosis } from "@/components/report/FunnelDiagnosis";
import { ContentInsight } from "@/components/report/ContentInsight";
import { AdditionalSections } from "@/components/report/AdditionalSections";
import { NextActions } from "@/components/report/NextActions";
import { KpiStrip } from "@/components/report/KpiStrip";

// デザイン確認用プレビュー(npm run dev → http://localhost:3000/preview)。
// DBもAPIキーも不要。本番環境では404を返す。
// 構造は本番と同じ {metrics(サーバー計算の数値), analysis(モデルの文章)}。

const post = (
  id: string,
  caption: string,
  saveRate: number | null,
  engagement: number
) => ({
  id,
  date: "2026-06-10",
  type: "CAROUSEL_ALBUM",
  permalink: `https://www.instagram.com/p/sample${id}/`,
  caption,
  likes: engagement - 40,
  comments: 40,
  reach: 10000,
  saved: saveRate !== null ? Math.round((saveRate / 100) * 10000) : null,
  views: 18000,
  engagement,
  viewsPerReach: 1.8,
  saveRate,
});

const sample: Report = {
  schemaVersion: 2,
  metrics: {
    schemaVersion: 2,
    period: "2026-06",
    account: { username: "sample_studio", followers: 8340, postCount: 14 },
    posts: [],
    funnel: {
      stages: [
        { key: "save_rate", label: "保存率", value: 2.8, benchmark: 2.0, gapPt: 0.8, verdict: "pass" },
        { key: "home_rate", label: "ホーム率", value: 34.1, benchmark: 30.0, gapPt: 4.1, verdict: "pass" },
        { key: "profile_transition_rate", label: "プロフィール遷移率", value: 2.3, benchmark: 2.0, gapPt: 0.3, verdict: "pass" },
        { key: "follower_conversion_rate", label: "フォロワー転換率", value: 6.2, benchmark: 10.0, gapPt: -3.8, verdict: "fail" },
      ],
      raw: {
        profileViews: 2150,
        followerReach: 2844,
        nonFollowerReach: 39500,
        accountReach: 42344,
        netNewFollows: 133,
        totalPostReach: 45200,
        totalSaved: 1266,
      },
      dataNotes: [],
    },
    topPosts: [
      post("1", "【スタッフ紹介】入社3年目のデザイナーに聞く、仕事のこだわり…", 4.1, 1329),
      post("2", "保存版!知らないと損する◯◯の選び方5選", 3.4, 1025),
      post("3", "お客様の声をご紹介します。「初めてでも安心して…」", 2.2, 781),
    ],
    worstPosts: [
      post("9", "【7月限定】お得なキャンペーンのお知らせです!詳細は…", 0.3, 42),
      post("10", "本日は定休日をいただいております。明日より通常営業…", 0.1, 18),
    ],
    kpiStrip: [
      { key: "reach", label: "リーチ(投稿合算)", value: 45200, momChangePct: 24.5 },
      { key: "followers", label: "フォロワー数", value: 8340, momChangePct: 3.2 },
      { key: "profile_views", label: "プロフィール閲覧", value: 2150, momChangePct: 11.8 },
      { key: "net_follows", label: "純増フォロワー", value: 133, momChangePct: -8.4 },
      { key: "saved", label: "保存合計", value: 1266, momChangePct: 21.0 },
      { key: "posts", label: "投稿数", value: 14, momChangePct: null },
    ],
    flags: [],
    sections: { addModules: ["reels"], removed: [], note: null },
  },
  analysis: {
    headline: "リーチは伸びた。だが『フォローされる理由』が伝わっていない。",
    executiveSummary:
      "今月の最大の課題は、プロフィールまで来た人をフォローに変えられていない点です。プロフィール遷移率は基準を超え、投稿からプロフィールへ誘導する導線は機能しています。しかしフォロワー転換率は合格ラインに届かず、プロフィール画面で「この人をフォローする理由」を提示できていません。一方、保存率トップのスタッフ紹介リールは発見タブ経由の新規到達を牽引しており、人物起点のコンテンツが勝ち筋であることは明確です。来月は自己紹介文の1行目とハイライトの再設計を最優先に、勝ち筋であるスタッフ起点コンテンツへリソースを寄せます。",
    stageDiagnoses: {
      save_rate:
        "保存はアルゴリズムが最重視するシグナルで、この水準は発見タブ露出の起点として十分です。後で見返す価値のある情報設計ができており、非フォロワーへの拡散エンジンが回っています。",
      home_rate:
        "既存フォロワーの3人に1人以上に届いており、内側のエンゲージは健全です。初速で反応が集まる下地があるため、新規向けの実験投稿を仕掛けても土台が崩れません。",
      profile_transition_rate:
        "投稿を見た人がプロフィールを訪ねる導線は機能しています。最終画像やキャプションのCTAが効いており、興味から信頼への移行は詰まっていません。",
      follower_conversion_rate:
        "プロフィールまで来た人の1割未満しかフォローに至っていません。訪問はあるのにフォローされない=プロフィール画面で「継続的に得られる価値」が一言で伝わっていない状態です。ここが今月最大の穴です。",
    },
    bottleneck:
      "ファネルの穴は明確に『信頼→行動(フォロー転換)』です。認知・興味・プロフィール遷移までの3段は合格ラインを超えており、集客の入口は機能しています。にもかかわらず純増が伸びないのは、プロフィール画面が『訪問者を素通りさせている』ため。原因は投稿内容ではなくプロフィール設計側にあり、自己紹介文の1行目が誰の何を解決するアカウントかを瞬時に伝えられていないことが最も疑わしい要因です。来月はコンテンツ制作より先に、この1画面の改善に着手すべきです。",
    contentInsight: {
      winPattern:
        "刺さったのは『人物の顔と物語が見えるコンテンツ』です。スタッフ紹介リールは、商品やサービスの説明ではなく『誰がやっているか』への関心を起点にしており、自己開示への返報性(相手が心を開くとこちらも応えたくなる心理)が保存とシェアを押し上げました。冒頭2秒で問いを立てる構成が視聴維持率を高め、発見タブ経由の新規到達を牽引しています。この『人起点 × 冒頭フック』は再現可能な勝ちパターンです。",
      losePattern:
        "反応が低かったのは、告知・キャンペーン系の投稿です。情報が『送り手の都合』で構成され、閲覧者が後で見返す動機も、誰かに共有する動機も生まれていません。ストーリーズで流すべき情報がフィードを占有しており、フィードの1枠あたりの価値を下げていました。",
    },
    postInsights: [
      {
        mediaId: "1",
        insight:
          "人物起点のリールで保存率が全体平均を大きく上回りました。冒頭2秒の問いかけが視聴維持を高め、発見タブ経由の新規到達を牽引。来月はこの構成をテンプレ化して本数を増やすべきです。",
      },
      {
        mediaId: "2",
        insight:
          "『保存版』の明示でアクションを誘導し、カルーセルの網羅性が後から見返す動機を作れています。まとめ系はプロフィール訪問の呼び水になるため、フォロー転換施策と組み合わせると効果が増幅します。",
      },
      {
        mediaId: "3",
        insight:
          "UGCはコメント率が最も高く、既存フォロワーとの関係を強化。信頼の訴求として有効なので、プロフィール改善後にフォロー動機を補強する素材として月1〜2本の定期化が有効です。",
      },
      {
        mediaId: "9",
        insight:
          "告知はフィードでは保存もシェアもされにくく、1枠の価値を下げています。この種の情報はストーリーズへ移し、フィードは保存される資産コンテンツに集中させるべきです。",
      },
      {
        mediaId: "10",
        insight:
          "運用連絡はフィードに不要です。制作リソースをかけずストーリーズかハイライトへ。フィード投稿数を絞る判断が、1本あたりの初速を守ります。",
      },
    ],
    nextActions: [
      {
        action:
          "プロフィールの自己紹介文の1行目を『誰の・何の悩みを解決するアカウントか』が一読でわかる一文に書き換える",
        why: "最優先ボトルネックであるフォロワー転換率への直接施策。訪問者が3秒で『フォローする理由』を判断できるかがここで決まる。",
        priority: "high",
      },
      {
        action:
          "ハイライトを「はじめての方へ / お客様の声 / サービス」の3本に再編成し、カバー画像を統一する",
        why: "プロフィール訪問者がフォロー前に見る『信頼の証拠』を整理する。転換率のボトルネックを構造から解消する。",
        priority: "high",
      },
      {
        action:
          "スタッフ起点リール(冒頭2秒フック型)を月4本に定例化し、構成をテンプレート化する",
        why: "保存率トップの勝ちパターン。自己開示への返報性が拡散を生む再現性の高い型なので、リソースを寄せる。",
        priority: "mid",
      },
      {
        action:
          "告知・定休日連絡などのフィード投稿をやめ、ストーリーズ/ハイライトへ移す",
        why: "反応の低い投稿がフィード枠の価値を下げていた。制作リソースを引き上げ、保存される資産コンテンツに集中させる。",
        priority: "mid",
      },
    ],
    additionalSections: [
      {
        moduleKey: "reels",
        title: "リール分析",
        body: "リールはフィード投稿に比べ非フォロワーへの到達が明確に大きく、新規認知の入口として機能しています。一方でフィードのカルーセルは保存率が高く、既存フォロワーの信頼蓄積を担っています。『リールで出会い、カルーセルで保存され、プロフィールでフォローされる』という役割分担を前提に、リールの冒頭フックとカルーセルの網羅性をそれぞれ磨くのが最短ルートです。",
      },
    ],
  },
};

export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const view = toReportView(sample);
  return (
    <main
      className="mx-auto max-w-3xl bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none"
      style={{ "--brand": "#0f766e" } as React.CSSProperties}
    >
      <div className="no-print mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        これはサンプルデータによるデザインプレビューです(本番では表示されません)
      </div>
      <ReportHeader
        clientName="株式会社サンプル"
        period={view.period}
        igUsername="sample_studio"
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
