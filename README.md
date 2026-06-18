# 한별시스템 · AI 멀티채널 자동발행 시스템

대구·경북 기업 전산 전문 **한별시스템**의 AI 기반 콘텐츠 자동발행 도구.
사진·문구만 넣으면 6개 채널(네이버 블로그·구글 블로그·쓰레드·유튜브·인스타그램·페이스북)에 맞는 글을 AI가 작성하고, 검토·예약·발행·성과분석까지 한 곳에서 관리합니다.

## 구성

```
.
├── 콘솔/                                       # 발행 콘솔 (단일 HTML)
│   └── hanbyul-autopost-dashboard.html
├── supabase/functions/hanbyul-autopost-ai/     # 클라우드 AI 백엔드 (Deno Edge Function)
│   └── index.ts                                # Claude(글+사진분석) · DALL·E(그림)
├── 채널에이전트/                                # 6채널 글쓰기 규칙서 + 경쟁사 분석
├── index.html                                  # GitHub Pages 진입점 (콘솔로 redirect)
└── .nojekyll
```

GitHub Pages: https://hanbyeolsystem.github.io/hanbyul-autopost/

## 핵심 기능

- **AI 글 생성** — 채널별 맞춤 글 (Claude). "파는 글"이 아니라 "돕는 글" 톤.
- **사진 분석** — 업로드 사진을 Claude Vision으로 분석해 글-사진 일치 보장.
- **AI 그림** — DALL·E (선택, OPENAI_API_KEY 등록 시).
- **실제 발행 모습 미리보기** — 채널별 레이아웃 + 사진 자리에 실제 이미지.
- **예약/바로발행 + 채널별 게시판 + 성과 분석**.

## 백엔드 (Supabase Edge Function)

- 함수명: `hanbyul-autopost-ai` (Supabase 프로젝트 `asms-pacai` 안에 함께 거주)
- 라우팅:
  - `GET  /functions/v1/hanbyul-autopost-ai/health`
  - `POST /functions/v1/hanbyul-autopost-ai/generate`
  - `POST /functions/v1/hanbyul-autopost-ai/analyze-image`
  - `POST /functions/v1/hanbyul-autopost-ai/generate-image` (OPENAI_API_KEY 필요)
- 시크릿: `ANTHROPIC_API_KEY` (필수), `OPENAI_API_KEY` (선택)
  → Supabase Dashboard → Edge Functions → Secrets 에서 등록.

## 보안

- 모든 API 키는 Supabase Secret에만 존재. 브라우저(콘솔)에 노출되지 않음.
- 콘솔의 anon key는 공개 키 — 실제 게이트는 Edge Function 의 verify_jwt + RLS.
