-- 数値/文章分離 + クライアント台帳のSupabase一本化
--
-- 背景:
--  - Vercel cron が毎月自動でデータ取得するため、トークンをDBに持つ必要がある
--    (0002の「ローカルのみ」方針を撤回。RLS有効+service_roleのみアクセスは維持)
--  - レポートは metrics_json(サーバー計算の数値・正本) と analysis_json(モデルの文章)
--    に分離し、publish時にマージして report_json を作る。モデルは数値を出力しない

-- clients: MCP/cron共通のキー(slug)、表示用IGユーザー名、観点モジュール設定
alter table clients add column if not exists slug text;
alter table clients add column if not exists ig_username text;
alter table clients add column if not exists modules jsonb not null default '{}';
create unique index if not exists clients_slug_idx on clients (slug) where slug is not null;

-- reports: 数値ブロックと文章ブロックを個別保存(report_json はマージ済みの閲覧用正本)
alter table reports add column if not exists metrics_json jsonb;
alter table reports add column if not exists analysis_json jsonb;
