-- 영상도 대기열이 들고 다니도록 (Storage URL 배열) — 2026-06-22
alter table public.autopost_post_queue
  add column if not exists videos jsonb default '[]'::jsonb;  -- [{url, caption}]
