-- MCP経由の公開フローでは、Instagramトークンはローカル(clients.json)にのみ保存し
-- DBには持たせない。Vercel自動パイプライン専用だった NOT NULL 制約を緩める。
alter table clients alter column ig_user_id drop not null;
alter table clients alter column ig_access_token drop not null;
