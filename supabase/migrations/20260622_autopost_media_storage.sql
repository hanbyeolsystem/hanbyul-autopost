-- 대기열이 사진을 들고 다니도록: images 컬럼 + 공개 Storage 버킷 (2026-06-22)
alter table public.autopost_post_queue
  add column if not exists images jsonb default '[]'::jsonb;  -- [{url, caption}]

insert into storage.buckets (id, name, public)
values ('autopost-media', 'autopost-media', true)
on conflict (id) do nothing;
