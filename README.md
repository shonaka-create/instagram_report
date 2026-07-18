# Instagram 月次レポート自動生成システム

Instagram Graph API からデータを取得し、Claude が分析した JSON をもとに、クライアント納品用の月次レポート(HTML / PDF)を自動生成・配信するシステム。

## アーキテクチャ

```
[Vercel Cron (毎月1日 10:00 JST)]
   │ /api/cron/monthly … クライアント毎に reports 行を作成し QStash へ投入
   ▼
[QStash] → /api/jobs/fetch-insights   Instagram Graph API → raw_insights 保存
        → /api/jobs/analyze           Claude (Structured Outputs) → report_json 保存
        → /api/jobs/publish-report    公開 (access_token 付きURL確定)
        → /api/jobs/render-pdf        (wants_pdf のクライアントのみ) PDF生成 → Storage
```

- **レポートの正本は DB の `report_json`(Claudeの出力)。** HTML は `/reports/{access_token}` で都度レンダリングするため、テンプレート改善が過去レポートにも反映される
- **PDF は基本「ブラウザの印刷機能」で賄う**(print CSS 完備、無料)。ファイル納品が必要なクライアントだけ `wants_pdf=true` にするとサーバー側で Puppeteer + `@sparticuz/chromium-min` により生成し、署名付きURLで配布
- **冪等性**: `reports.status` を状態機械として使い、各ジョブ冒頭の条件付き UPDATE で QStash の重複配送を無害化。恒久エラーは 200 + `failed` 記録、一時エラーは 500 でリトライ

## セットアップ

### 1. Supabase

1. SQL Editor で `supabase/migrations/0001_init.sql` を実行(テーブル + `reports`/`bin` バケット作成)
2. Project Settings → API から URL と `service_role` キーを控える

### 2. Upstash QStash

[Upstash Console](https://console.upstash.com/qstash) で Token / Signing Keys を取得。無料枠(500メッセージ/日)で十分。

### 3. 環境変数

`.env.example` をコピーして `.env.local` を作成し、各値を設定。Vercel にも同じものを設定する。

### 4. クライアント登録

```sql
insert into clients (name, ig_user_id, ig_access_token, brand_color, wants_pdf)
values ('株式会社サンプル', '17841400000000000', 'EAAG...', '#0f766e', false);
```

`ig_access_token` は Instagram Graph API の**長期トークン(60日有効)**。失効するとジョブが `failed` になるため、定期的なローテーションが必要。

### 5. (任意) サーバーPDF生成

`wants_pdf=true` のクライアントを使う場合のみ:

1. [Sparticuz/chromium releases](https://github.com/Sparticuz/chromium/releases) から `chromium-vXXX-pack.x64.tar` をダウンロード
   (`@sparticuz/chromium-min` のバージョンと**メジャーバージョンを一致**させること)
2. Supabase Storage の `bin` バケット(public)にアップロード
3. その公開URLを `CHROMIUM_PACK_URL` に設定

### 6. デプロイ

Vercel にデプロイ。`vercel.json` の Cron(毎月1日 01:00 UTC = 10:00 JST)が自動実行される。

手動実行(動作確認):

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/monthly
```

## 運用

- 進捗・失敗は `reports` テーブルの `status` / `error_message` で確認
- `failed` の行は原因(トークン失効など)を解消後、`status='queued'` に戻して Cron を手動実行すれば再走する
- クライアントへは `https://<APP_URL>/reports/{access_token}` を送付(access_token は reports 行に自動発行)

## コスト

| サービス | 費用 |
|---|---|
| Instagram Graph API | 無料(レート制限のみ) |
| Claude API (claude-sonnet-5) | 従量課金: $3/1M入力・$15/1M出力(2026-08-31まで $2/$10)。1レポートあたり概算 $0.03〜0.1 |
| Supabase | Freeプラン内(DB 500MB / Storage 1GB) |
| Upstash QStash | Freeプラン内(500msg/日) |
| Vercel | Hobbyは無料だが**商用利用は規約上Pro($20/月)が必要** |

## 主な技術判断

- **`@react-pdf/renderer` 不採用**: 日本語フォント埋め込み・組版が弱く、HTML版とデザイン二重管理になるため
- **Puppeteer の 50MB 制限回避**: `@sparticuz/chromium-min` を使い、Chromium 本体はバンドルせず Supabase Storage から実行時取得
- **日本語フォント**: `next/font/google` の Noto Sans JP に一本化。PDF もレポートページを印刷する方式なので文字化けが構造的に起きない
- **Claude の JSON 品質**: Structured Outputs(`output_config.format` + zod スキーマ)で API レベルにスキーマ準拠を保証。パース失敗リトライは不要
