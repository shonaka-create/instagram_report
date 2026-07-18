# Instagram 月次レポートシステム

Instagram API からデータを取得し、コンサルタント品質の月次レポート(HTML / PDF)を発行するシステム。

**レポートの価値設計**: アプリを見ればわかる数値の羅列ではなく、ファネル4指標(保存率 2.0% / ホーム率 30% / プロフィール遷移率 2.0% / フォロワー転換率 10%)の**合格ラインに対する診断**と、**ボトルネック特定→来月の具体アクション**が主役。

## アーキテクチャ

```
[Vercel Cron 毎月1日 10:00 JST]
   /api/cron/monthly … 全アクティブクライアントの前月データを取得し
                       指標を計算して保存 (status: fetched)。分析はしない
   ▼
[月初: Claude Code で /instagram-monthly-report スキルを実行]
   MCP get_instagram_insights … 保存済みデータ+計算済み指標+分析指針を返す
   → Claude が「文章のみ」の分析を書く(数値は一切書かない)
   → MCP publish_report … サーバー保存済みの数値と文章をマージして公開
   ▼
[閲覧] /reports (一覧・フィルタ) → /reports/{access_token} (レポート本体)
       サイト全体を SITE_PASSWORD で保護。PDFはブラウザ印刷(print CSS完備)
```

### 数値安全設計(どのモデルで分析しても数値が壊れない)

1. **取得・計算の単一実装**: `mcp-server/src/insights.ts` を Vercel cron と MCP の両方が import する。経路によって数値が食い違うことがない
2. **数値と文章の分離**: レポート正本 `report_json` は `{ metrics(サーバー計算), analysis(モデルの文章) }`。モデルは数値を出力せず、publish 時にサーバーがマージする
3. **比率は分子分母の母集団を統一**(保存率=投稿合算÷投稿合算、プロフ遷移率=アカウント重複排除リーチ基準)。取得不可の指標は `unknown` として「測定不可」表示
4. **top/worst投稿の選定・前月比・ベンチマーク判定もすべてサーバー側**で決定的に計算

## セットアップ

### 1. Supabase

SQL Editor で `supabase/migrations/` の 0001〜0003 を順に実行。

### 2. 環境変数

`.env.example` をコピーして `.env.local` を作成。Vercel にも同じ4つ+`SITE_PASSWORD` を設定:
`APP_URL` / `SITE_PASSWORD` / `CRON_SECRET` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`

### 3. MCPサーバー

```sh
cd mcp-server && npm install && npm run build
```

`mcp-server/.env` に `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `APP_URL` を設定。
プロジェクトの `.mcp.json` で Claude Code に登録済み。

### 4. クライアント登録

Claude Code で `/instagram-monthly-report` を起動し「クライアント追加」と言う
(テスター招待→承認→トークン発行→ `upsert_client` まで案内される)。

### 5. Vercel デプロイ

```sh
npx vercel link   # shonaka-creates-projects のプロジェクトに紐付け
npx vercel env add SITE_PASSWORD  # ほか上記の環境変数を追加
npx vercel --prod
```

`vercel.json` の Cron(毎月1日 01:00 UTC = 10:00 JST)が自動実行される。手動確認:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://<APP_URL>/api/cron/monthly
```

## 運用(月次)

1. 毎月1日: cron が自動で前月データを取得(放置でOK)
2. 月初: Claude Code で `/instagram-monthly-report` → 棚卸→分析→公開まで一連実行
3. 発行された `/reports/{token}` のURLをクライアントに送付(パスワードも共有)
4. IGトークンは**60日で失効**。スキルの棚卸フローが45日超で警告する

- 進捗・失敗は `/reports` 一覧、または `reports` テーブルの `status` / `error_message`
- クライアント別の観点調整は `upsert_client` の `modulesAdd`(reels/timing/cta/trend) / `modulesRemove`(worst_posts/content_insight/kpi_strip) / `moduleNote`(自由記述)

## コスト

| サービス | 費用 |
|---|---|
| Instagram API | 無料(レート制限のみ) |
| 分析 | Claude Code サブスク内(MCP経由、API課金なし) |
| Supabase | Freeプラン内 |
| Vercel | Hobbyは無料だが**商用利用は規約上Pro($20/月)が必要** |

## 主な技術判断

- **PDFはブラウザ印刷で賄う**(print CSS完備・Chromium品質・無料)。一覧の「PDF」リンクは `?print=1` で印刷ダイアログを自動起動
- **日本語フォント**: `next/font/google` の Noto Sans JP。PDFも同ページ印刷なので文字化けが構造的に起きない
- **HTML都度レンダリング**: 正本はDBのJSONなので、テンプレート改善が過去レポートにも即反映
- **旧QStash/Claude APIパイプラインは廃止**(2026-07)。分析はMCP経由でサブスク内実行
