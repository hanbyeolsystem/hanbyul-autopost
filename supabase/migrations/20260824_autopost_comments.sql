-- 20260824_autopost_comments.sql
-- 인스타그램·페이스북·쓰레드 댓글 자동응답 + 슬랙 알림 파이프라인용 테이블.
-- Edge Function(hanbyul-autopost-ai) 의 POST /comments/poll 이 service_role 로 이 테이블에 기록한다.
-- comment_id UNIQUE 로 중복 처리(=중복 답글, 중복 슬랙알림)를 막는다.

create table if not exists public.autopost_comments (
  id bigserial primary key,
  platform text not null,              -- instagram | facebook | threads
  comment_id text not null unique,
  post_id text,
  parent_comment_id text,               -- 대댓글이면 원댓글 id (facebook만 해당)
  author text,
  comment_text text,
  sentiment text,                       -- thanks | question | complaint | spam | neutral
  reply_text text,
  replied boolean not null default false,
  skipped_reason text,                  -- 자동답변 스킵 사유(불만/스팸 등)
  slack_notified boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.autopost_comments enable row level security;
drop policy if exists autopost_comments_service on public.autopost_comments;
create policy autopost_comments_service on public.autopost_comments
  for all to service_role using (true) with check (true);

create index if not exists idx_autopost_comments_platform on public.autopost_comments(platform);
create index if not exists idx_autopost_comments_notified on public.autopost_comments(slack_notified) where slack_notified = false;
