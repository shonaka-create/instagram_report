---
name: instagram-monthly-report
description: Instagramクライアントの棚卸→月次データ取得→コンサル品質の分析→レポートURL公開までを一連で実行する。トリガー例:「インスタ月次レポート」「今月のインスタレポート作って」「クライアント追加」「レポート棚卸」「instagram report」。数値はすべてMCPサーバー側で計算済み・AIは文章のみ書くため、Sonnetでも数値事故が構造的に起きない。
---

# Instagram 月次レポート運用スキル

MCPサーバー `instagram-report` のツールで、クライアント管理から月次レポート公開までを一連で行う。

## アーキテクチャ前提(毎回思い出すこと)

- **数値と文章は分離されている**。`get_instagram_insights` が返す `metrics` はサーバー計算済みの正本。あなたは**文章だけ**を書き、`publish_report` がサーバー側で数値とマージする。**あなたが数値を計算・転記することは一切ない**
- Vercel cron が毎月1日に全アクティブクライアントの前月データを自動取得済み(status: fetched)。このスキルの月次実行では通常、保存済みデータが使われる(`dataSource` で確認できる)
- クライアント台帳の正本は Supabase(`list_clients` / `upsert_client` で操作)
- 公開先は専用URL `/reports/{token}`。サイト全体がパスワード保護されており、一覧は `/reports`

## フロー1: 棚卸(毎回最初に実行)

1. `list_clients` を呼ぶ
2. 次を確認して報告する:
   - active なのに `hasToken: false` のクライアント(cron取得が失敗する)
   - 直近 reports に `failed` があるクライアント(error_message の確認が必要)
   - 対象月が `fetched` のまま(=分析待ち)のクライアント
   - **トークンは60日で失効**。前回発行から45日を超えていそうなら更新を促す

## フロー2: クライアント追加(オンボーディング)

Metaアプリ akane_biz を使い回す3ステップ(ユーザー作業を案内):
1. Meta開発者画面 → akane_biz → Instagram > APIセットアップ → 対象IGアカウントをテスターとして招待
2. クライアント側のInstagram(設定 > アプリとサイト)で招待を承認
3. APIセットアップ画面でアクセストークンを発行(60日有効)してもらう

トークンを受け取ったら:
```
upsert_client(slug, name, igAccessToken, igUsername, brandColor?)
```
初月は `get_instagram_insights` を1回実行してデータが取れることを必ず確認する。

## フロー3: 月次レポート(クライアントごとに繰り返す)

1. `get_instagram_insights(clientId, period)` — period は原則「前月」
2. 出力の `analysisGuidelines` と `metrics` を読み、**文章のみの分析**を書く
   - 書き方の詳細は mcp-server/ANALYSIS_STYLE.md(数値なし・診断ファースト・ボトルネック特定)
   - `metrics.sections.addModules` があれば additionalSections に各モジュール1セクション
   - `metrics.sections.note` はクライアント固有の観点メモ。必ず考慮する
3. **公開前チェックリスト**(すべてYESになるまで publish しない):
   - [ ] headline は40字以内で断定しているか
   - [ ] executiveSummary は課題ファーストか(良い話から始めていないか)
   - [ ] bottleneck は fail ステージを1つに絞り、消去法の根拠があるか
   - [ ] unknown の指標を断定していないか
   - [ ] nextActions に『やめること』が最低1つあるか、high がボトルネック直撃か
   - [ ] postInsights が topPosts + worstPosts の全 mediaId をカバーしているか
   - [ ] 自分で計算した数値を文章に書いていないか
4. `publish_report(clientId, period, analysis)` → 発行URLを控える
5. 全クライアント分終わったら、URL一覧を表にまとめて報告する

## フロー4: 観点カスタマイズ(クライアント要望が出たとき)

```
upsert_client(slug, modulesAdd: ["reels","timing","cta","trend"のうち必要なもの],
              modulesRemove: ["worst_posts"|"content_insight"|"kpi_strip"],
              moduleNote: "自由記述の観点(例: 予約導線の言及を毎月入れる)")
```
- modulesAdd/Remove は**全置換**(現状維持したい場合は指定しない)
- 既存モジュールで足りない定型観点が増えたら、mcp-server/src/insights.ts の MODULE_DEFS に定義を追加する(コード変更)

## 頻度の整理

| タイミング | 何が起きるか | 誰が |
|---|---|---|
| 毎月1日 10:00 JST | cron が前月データを自動取得・指標計算(fetched) | 自動 |
| 月初(1〜5日目安) | このスキルで全クライアントの分析→公開 | ユーザー+Claude |
| 45日ごと目安 | IGトークンの更新確認(60日失効) | 棚卸フローで検知 |

## トラブルシューティング

- 「数値データが未保存です」→ `get_instagram_insights` を先に実行(cron失敗時も同様)
- 「postInsights が不足」→ エラーに出た mediaId の insight を追記して再 publish
- Graph API error code=190 → トークン失効。フロー2の手順3で再発行
- 測定不可(unknown)が多い → Instagram Login API で該当メトリクスが未対応の可能性。dataNotes をレポートに反映しつつ、投稿単位指標(保存率)中心で診断する