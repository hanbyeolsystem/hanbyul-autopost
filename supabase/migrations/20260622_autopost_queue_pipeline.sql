-- 한별광고 AI 멀티채널 자동화 대기열 (블루프린트 기반, 2026-06-22)
-- asms-pacai(jrzesjgyrvgvwazfajec) 적용. ASMS 운영 테이블과 분리를 위해 autopost_ 접두사.
-- RLS ON + 정책 없음 → anon/authenticated 직접 접근 차단. Edge Function(service_role)만 접근.

create table if not exists public.autopost_post_queue (
  id            bigserial primary key,
  created_at    timestamptz default now(),
  topic         varchar(255) not null,
  raw_context   text not null default '',
  region        text,
  post_type     text,                                  -- review|guide|case
  image_desc    text,
  image_count   int default 0,
  channels      jsonb default '{}'::jsonb,             -- {naver:{text,usage}, ...}
  status        varchar(20) default 'pending',         -- pending|approved|published|failed
  published     jsonb default '{}'::jsonb,             -- {naver:{url,at}, ...}
  error_message text,
  scheduled_at  timestamptz,
  published_at  timestamptz,
  total_usd     numeric(10,5) default 0
);
create index if not exists autopost_queue_status_idx
  on public.autopost_post_queue (status, created_at desc);

create table if not exists public.autopost_post_analytics (
  id          bigserial primary key,
  post_id     bigint references public.autopost_post_queue(id) on delete cascade,
  channel     varchar(50) not null,
  url         text,
  views       int default 0,
  clicks      int default 0,
  conversions int default 0,
  updated_at  timestamptz default now()
);
create index if not exists autopost_analytics_post_idx
  on public.autopost_post_analytics (post_id);

alter table public.autopost_post_queue     enable row level security;
alter table public.autopost_post_analytics enable row level security;
