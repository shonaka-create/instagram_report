-- クライアント(運用代行先)
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ig_user_id text not null,          -- Instagram Business Account ID
  ig_access_token text not null,     -- 長期アクセストークン(60日。要ローテーション)
  brand_color text not null default '#0f172a',
  wants_pdf boolean not null default false, -- true: サーバー側でPDFファイルも生成
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 月次レポート。status が状態機械:
-- queued → fetching → fetched → analyzing → analyzed → publishing → published / failed
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  period text not null,              -- 'YYYY-MM'
  status text not null default 'queued',
  raw_insights jsonb,                -- Instagram Graph APIの生データ
  report_json jsonb,                 -- Claudeの分析結果(レポートの正本)
  access_token uuid not null unique default gen_random_uuid(), -- 閲覧URL用トークン
  pdf_path text,                     -- Storage上のPDFパス(生成した場合のみ)
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, period)
);

create index if not exists reports_status_idx on reports (status);

-- RLS: サーバー(service_role)のみアクセスする前提。
-- 有効化してポリシーを作らないことで anon/authenticated からは一切読めなくする。
alter table clients enable row level security;
alter table reports enable row level security;

-- Storage バケット
-- reports: PDF納品用(private、署名付きURLでのみ配布)
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

-- bin: @sparticuz/chromium のbrotliパック置き場(public、実行時にダウンロード)
insert into storage.buckets (id, name, public)
values ('bin', 'bin', true)
on conflict (id) do nothing;
