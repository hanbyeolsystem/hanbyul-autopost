# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**한별시스템 · AI 멀티채널 자동발행** — a tool for 한별시스템 (a Daegu/Gyeongbuk office-equipment & Synology NAS dealer) that turns a few photos + notes into ready-to-publish posts for 6 channels (Naver Blog, Google Blog, YouTube, Instagram, Threads, Facebook), with AI generation, photo analysis, review, scheduling, publishing, and cost tracking.

There is **no build system, no package manager, no lint**. 테스트 2개: `node supabase/functions/hanbyul-autopost-ai/prompt.test.mjs`(프롬프트 규칙) · `postprocess.test.mjs`(후처리·스타일 HTML, esbuild 경유). The whole product is two hand-written source files (one HTML, one Deno TS) plus Markdown rule docs. Deployment is GitHub Pages (frontend) + Supabase Edge Function (backend).

## Repository layout note

The git repository root and all real code live in `한별광고/` (the parent of the `Youtube/` subfolder where a session may start). `Youtube/` is currently empty scaffolding. Always operate from the repo root. Paths and filenames are predominantly Korean; git shows them octal-escaped.

```
콘솔/hanbyul-autopost-dashboard.html          # the entire frontend (single-file, ~1500 lines vanilla JS)
supabase/functions/hanbyul-autopost-ai/index.ts  # the entire backend (single Deno Edge Function)
index.html                                    # GitHub Pages entry → redirects to the console
채널에이전트/                                  # human-readable channel writing rules + competitor analysis (docs)
```

## Architecture

**Frontend** (`콘솔/hanbyul-autopost-dashboard.html`) — one self-contained HTML file. No framework, no bundler; edit the file directly. **All state is in `localStorage`** (keys prefixed `hanbyul_`): API base URL, per-channel post history (last 10) and board (last 100), saved symptom/solution/service/model lists, accumulated cost, Google client id / blog id. There is no server-side database — losing localStorage loses everything.

**Backend** (`supabase/functions/hanbyul-autopost-ai/index.ts`) — one Deno Edge Function, `Deno.serve` with manual path routing. The router strips `/functions/v1/<slug>` and switches on the remaining sub-path:
- `GET  /health` — capability flags (which keys/integrations are configured)
- `POST /generate` — Claude text generation (채널별 모델: 블로그=`claude-sonnet-5`, 짧은 채널=`claude-haiku-4-5`; `CHANNEL_MODEL` 맵). 응답 `{text, plan, usage, length, over_limit}`. 생성 뒤 `finishText()`: 기획 메모(`===기획메모===`) 분리 → `postClean`(대시→하이픈, 챗봇 머리·꼬리) → `humanizePass`(haiku, im-not-ai 룰북, `humanize:false` 로 끔) → 인스타·쓰레드 한도 초과면 `condensePass`. 배치 수집(`/queue/collect`)도 같은 후처리.
- **Q&A 3개 무조건(2026-09-08 사장님 지시)**: 네이버·구글·페북은 본문 아래쪽에 정확히 3개(프롬프트) + 서버 `ensureFaq()` 가 3개 미만이면 haiku 로 보충해 연락처 줄 앞에 삽입(구글만 `##` 소제목). 인스타·쓰레드는 기획 메모의 "고객 Q&A 3개"(첫 댓글용). 응답 `faq` = 개수.
- **사진 설명은 눈에 안 보이는 메타데이터로(2026-09-08 사장님: "눈에 안 보여도 된다, AI 만 읽으면")**: 사람이 못 보는 흐린 글씨는 AI 도 못 읽는다(같은 픽셀). 그래서 콘솔 `mediaMeta()` 가 제목·설명·키워드·제작자·도시를 보내고 서버 `withXmp()` 가 **JPEG 안에 XMP APP1**(dc:title/description/subject/creator/rights, photoshop:City/Credit)을 심는다. 모든 사진에 적용, Storage 는 바이트 보존, PIL 로 왕복 파싱 확인. 인스타는 업로드 때 메타데이터를 지우므로 캡션·해시태그가 통로. 화면 글씨 `drawStamp` 는 체크박스 `stampMain` **기본 꺼짐**(켜면 첫 사진에 흰 15%+검은 9%). 서버는 `<img alt title>`+`<figure><figcaption>`, 파일명 슬러그(모델명-hanbyeol-daegu).
- `GET  /styles` — 구글 블로그 글 스타일 프리셋(폰트·색상) 목록. `/publish/google` 의 `style:{preset}`('random' 이면 글마다 다르게)으로 `textToBloggerHtml` 이 ##/###/>/-/**/==/Q.A. 마커를 색·폰트 입힌 HTML 로 바꾼다. 블로거는 `<style>@import` 를 살려 둔다(2026-09-06 실측).
- `POST /queue/generate-batch` — 요청 채널을 Batch API로 한 번에 제출(요금 −50%), 대기열에 `generating` 적재(배치 ID는 `channels._pending_batch`에 임시 보관)
- `POST /queue/collect` — 끝난 배치 결과 조립 → `pending` 승격. 콘솔이 대기열 열 때마다 호출(폴링). 단가는 `modelForChannel(ch)` 별칭 기준(응답 model은 날짜 붙은 풀 ID)
- `POST /analyze-image` — Claude Vision photo analysis (max 4 images)
- `POST /generate-image` — DALL·E 3 (requires `OPENAI_API_KEY`)
- `POST /google/connect` — exchange Google OAuth code → refresh_token + list Blogger blogs
- `POST /publish/google` — publish a post to Blogger (inlines attached photos as base64 `<img>`)
- `POST /youtube/start-upload` — open a YouTube resumable-upload session, return the upload URL

The two files talk over HTTP only. The frontend's `aiFetch()` auto-attaches the Supabase anon key as `Authorization`/`apikey` when the base URL is `*.supabase.co`. **All real secrets live only in Supabase Edge Function Secrets**; the browser never sees them. The anon key is public — the actual gate is `verify_jwt` + RLS.

### Key design decisions to preserve

- **Prompt logic is server-side, not in the docs.** `PHILOSOPHY`, `COMPANY`, `HUMAN_VOICE`(im-not-ai 룰북 이식), `SEO_GUIDE`(블로그, GEO 인용 규칙)/`SEO_GUIDE_SHORT`(짧은 채널), `HOOK_GUIDE`+`READABILITY`(블로그 훅·흐름·CTA·모바일 가독성), `PLAN_GUIDE`/`PLAN_GUIDE_BLOG`(기획 메모), `CHANNEL_AGENTS`, `TYPE_GUIDE`/`TYPE_GUIDE_SHORT`, `CHANNEL_LIMITS`(인스타 250자·6줄, 쓰레드 450자) constants in `index.ts` are what actually drive generation. **블로그 규칙을 짧은 채널에 섞으면 haiku 가 블로그를 써 버린다** — 분기(`isBlog`/`isShort`)를 유지할 것. 사장님이 준 블로그 프롬프트 15종 원문은 `채널에이전트/블로그_프롬프트_모음.md`. The Markdown files under `채널에이전트/` are reference/human docs and can drift (e.g. they say blog length 1,200–1,800자, but the live code targets ~4,000자). **To change tone, length, company info, or channel rules, edit `index.ts` — not the docs.**
- **Photo markers.** Generated posts embed `[📷 사진 N — caption]` markers; the prompt forces exactly `imageCount` markers spread evenly. The Blogger publisher (`textToBloggerHtml`) replaces each marker with the corresponding base64 image in order; surplus images append at the end, surplus markers render as dashed placeholders.
- **YouTube upload bypasses the Edge Function body limit.** The function only creates the resumable session and returns the `Location` URL; the **browser PUTs the video binary directly to YouTube**. Don't route video bytes through the function.
- **Per-channel publish is split** in the frontend: `google` and `youtube` (with a video) publish via the backend API; `naver` and the rest are **semi-automatic** — copy text to clipboard, download photos as a ZIP, and open the channel's compose window in a new tab.
- **Google OAuth `redirect_uri` must be normalized** to the Pages root (see commit `ce0ea2c`); YouTube reuses the same Google refresh token, so its OAuth scope must include `youtube.upload`.

## Working with the backend

Secrets are set in the **Supabase Dashboard → Edge Functions → Secrets** (not committed):
`ANTHROPIC_API_KEY` (required), `OPENAI_API_KEY` (optional, for DALL·E), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_BLOG_ID`, `ALLOW_ORIGIN`.

Deploy the function with the Supabase CLI:
```bash
supabase functions deploy hanbyul-autopost-ai
```
There is no local emulator config checked in; verify against the deployed function (`GET .../health`). The frontend's default API base is set in the `#apiBase` input in the dashboard HTML.

## Conventions

- All user-facing strings and comments are Korean; keep that voice. The brand tone is strict: posts must read as *helping* ("같이 찾아드릴게요"), never *selling* ("사세요"); no superlatives or competitor bashing; text must match the attached photos (never invent equipment/models not visible).
- `구글블로그.txt` and `secrets/`, `*.key`, `.env` are git-ignored — never commit credentials.
- Commit messages are Korean Conventional Commits (`feat(blog):`, `fix(google-oauth):`).

## 사람글 규칙 (2026-09-12)
- 6채널 전부 `클로드코드공부/글쓰기규칙/사람글_규칙.md` 를 따른다. 코드 반영 위치: `HUMAN_VOICE` 12)~15), `HUMANIZE_RULES` 끝 두 줄, `CHANNEL_AGENTS.google` 제목 규칙(대시·"함께 해결한 이야기" 꼬리 금지).
- 생성 결과를 점검하려면 글을 .md 로 저장하고 `python ../글쓰기규칙/ai_tell_check.py <파일>` 로 밀도를 본다(8 이하 합격).
