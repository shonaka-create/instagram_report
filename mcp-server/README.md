# Instagram レポート MCP サーバー

Claude Desktop / claude.ai から呼び出すローカル MCP サーバー。**Claude のサブスクリプション内で動くため、API 従量課金は発生しない**(Instagram Graph API・Google Sheets API も無料)。

## Tools

| Tool | 役割 |
|---|---|
| `get_instagram_insights` | クライアントの投稿データ(リーチ・保存・いいね・キャプション)を月指定で取得し、分析用の軽量JSONを返す |
| `export_report` | Claude が作った分析結果(総括・次月の打ち手・KPI)を、クライアント紐づけのGoogleスプレッドシートに1行追記する |

## セットアップ

```sh
cd mcp-server
npm install
npm run build
```

1. `clients.json.example` → `clients.json` にコピーし、クライアント情報を記入
2. (export_report を使う場合)`.env.example` → `.env` にコピーし、GCPサービスアカウントの認証情報を記入。対象スプレッドシートをサービスアカウントのメールアドレスに**編集者として共有**しておく

## Claude Desktop への登録

`claude_desktop_config.json`(設定 → 開発者 → 構成を編集)に追記:

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

## 使い方の例

Claude Desktop でそのまま話しかける:

> sample クライアントの 2026-06 のインサイトを取得して、前月と比較しながら月次レポートを作って。できたら export_report でスプレッドシートに転記して。

Artifacts と組み合わせる場合は、レポートのダッシュボード Artifact を一度作れば、閲覧時に自分の MCP コネクタ経由で最新データを取得できる(※閲覧者自身がこの MCP サーバーへ接続できる必要がある — 社内利用向け)。
