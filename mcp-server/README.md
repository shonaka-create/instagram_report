# Instagram レポート MCP サーバー

Claude Desktop / claude.ai から呼び出すローカル MCP サーバー。**Claude のサブスクリプション内で動くため、API 従量課金は発生しない**(Instagram Graph API も無料)。

アウトプットは Vercel 自動パイプラインと同じ **専用URLの HTML レポート(ブラウザ印刷で PDF 化)** に統一されている。

## Tools

| Tool | 役割 |
|---|---|
| `get_instagram_insights` | クライアントの投稿データ(リーチ・保存・いいね・キャプション)を月指定で取得し、分析用の軽量JSONを返す |
| `publish_report` | Claude が作った月次レポートJSONを Supabase に保存し、納品用の専用URL `/reports/{token}` を発行する(同月は上書き) |

## セットアップ

```sh
cd mcp-server
npm install
npm run build
```

1. `clients.json` に各クライアントの `igUserId` / `igAccessToken`(長期トークン)を記入
2. `.env.example` → `.env` にコピーし、`SUPABASE_SERVICE_ROLE_KEY` と `APP_URL` を記入
3. Supabase の SQL Editor で `supabase/migrations/0002_mcp_publish.sql` を実行(初回のみ)

## Claude Desktop への登録

`%APPDATA%\Claude\claude_desktop_config.json`(設定 → 開発者 → 構成を編集):

```json
{
  "mcpServers": {
    "instagram-report": {
      "command": "node",
      "args": [
        "C:\\Users\\shota\\Yournist Dropbox\\YOURNIST YOURNIST\\Instagram_report\\mcp-server\\dist\\index.js"
      ]
    }
  }
}
```

Claude Desktop を再起動すると Tools が使えるようになる。

## 使い方(月次レポート作成の流れ)

Claude Desktop でそのまま話しかける:

> akane の 2026-07 のインサイトを取得して、月次レポートを作って。
> 内容を確認したいので、まず分析結果を見せて。OKと言ったら publish_report で公開して。

公開されると `http://localhost:3000/reports/{token}`(Vercel デプロイ後はそのURL)が返る。
レポートページ右上の「PDFで保存 / 印刷」でそのままPDF納品物になる。

※ ローカルで閲覧する場合はプロジェクトルートで `npm run dev` を起動しておくこと。
