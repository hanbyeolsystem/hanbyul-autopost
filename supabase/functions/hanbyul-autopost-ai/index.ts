// 한별시스템 AI 발행 백엔드 (Supabase Edge Function)
// ─────────────────────────────────────────────
// 키는 Supabase Secret에서만 읽고, 브라우저에는 노출되지 않음.
//
// 라우팅 (function 슬러그 기준):
//   GET  /functions/v1/hanbyul-autopost-ai/health
//   POST /functions/v1/hanbyul-autopost-ai/generate          — 글 생성 (Claude)
//   POST /functions/v1/hanbyul-autopost-ai/analyze-image     — 사진 분석 (Claude Vision)
//   POST /functions/v1/hanbyul-autopost-ai/generate-image    — 그림 생성 (DALL·E)
//   POST /functions/v1/hanbyul-autopost-ai/google/connect    — Google OAuth 코드 → refresh_token
//   POST /functions/v1/hanbyul-autopost-ai/publish/google    — Blogger 글 게시
//
// CORS: ALLOW_ORIGIN 환경변수(없으면 *). Pages URL 정해지면 좁히세요.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_KEY      = Deno.env.get("ANTHROPIC_API_KEY") || "";
const OPENAI_KEY         = Deno.env.get("OPENAI_API_KEY") || "";
const ALLOW_ORIGIN       = Deno.env.get("ALLOW_ORIGIN") || "*";

// Google / Blogger
const GOOGLE_CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN") || "";
const GOOGLE_BLOG_ID       = Deno.env.get("GOOGLE_BLOG_ID") || "";

// Supabase (대기열 DB 접근용 — Edge Function 에 자동 주입되는 시크릿)
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const COMPANY = {
  name: "한별시스템",
  addr: "대구 달서구 문화회관11안길 22-7 1층",
  tel:  "053-588-7119",
  bizline: "컴퓨터 · 복사기 · 프린터 · NAS · 서버 · 잉크젯 · 토너 · 공기제균기 등 사무기기 일체",
};

const PHILOSOPHY = `
[회사] ${COMPANY.name} — 대구·경북 기업 전산 전문, 시놀로지(Synology) NAS 공식 대리점.
[연락처] 전화 ${COMPANY.tel}  [취급] ${COMPANY.bizline}
[절대 원칙]
- 글 마무리에는 '상호(한별시스템)와 전화번호'만 넣는다. 주소·오시는 길·찾아오는 길은 넣지 않는다. (고객이 사무실로 방문하는 업종이 아님)
- 우리는 '파는 곳'이 아니라 '돕는 곳'이다. 모든 글은 고객의 어려움(Pain)에서 출발해 공감→해결→안심으로 이어진다.
- "사세요"가 아니라 "이게 맞을까요? 같이 찾아드릴게요" 톤. 꼭 우리에게 맡기지 않아도 된다는 여유.
- 과장(최고/1등)·경쟁사 비방 금지. 솔직하고 따뜻하게.
- 시놀로지 공식 대리점 + AI 자동화 결합이라는 강점을 자연스럽게 녹인다(자랑이 아니라 도움의 근거로).
- 글과 사진은 반드시 일치해야 한다. 사진에 없는 것을 글에서 단정하지 않는다(신뢰의 핵심).
`;

const CHANNEL_AGENTS: Record<string, string> = {
  naver: `[채널] 네이버 블로그 — 검색 유입 최대화 + B2B 신뢰.
- 제목: 지역+핵심키워드를 맨 앞에. 글유형에 맞는 공식(후기/가이드/사례). 모델명 정확히.
- 본문: '안녕하세요, ${COMPANY.name}입니다.'로 시작 → 고객 어려움 공감 → 함께 찾은 해결 → 결과의 안심.
- 분량 3,800~4,200자 (한글 기준, 공백 포함). 길이를 채우기 위해 같은 말을 반복하지 말고 구체적 사례·수치·체크리스트·Q&A·비교표 등으로 자연스럽게 확장.
- 핵심 키워드 5~8회 자연 반복.
- 끝에 오시는 길/연락처(도움 톤) + 해시태그 10~15개(#지역+키워드, #키워드, #모델명, #${COMPANY.name}).`,

  google: `[채널] 구글 블로그(Blogger) — 구글 SEO + 영문 병기.
- 제목: "[지역] [키워드] — [고객문제], 함께 해결한 이야기 | ${COMPANY.name}". 영문 모델/브랜드 병기(Synology, Kyocera 등).
- 소제목(##, ###)으로 구조화. 본문은 고객 어려움→공감→해결→돕는 톤 회사 소개.
- 분량 3,800~4,200자 (한글 기준, 공백 포함). 채우기 위한 반복 금지 — 소제목별로 구체적 사례·비교·체크리스트·Q&A·기술 배경 설명으로 자연스럽게 확장.
- 끝에 "Keywords:" 줄로 한글+영문 키워드 나열. 해시태그 포함.`,

  youtube: `[채널] 유튜브 — 제목/설명/태그.
- 제목 3개 제안(클릭률 순). "[고객문제] 이렇게 해결했습니다 | ${COMPANY.name}" 형태 포함.
- 썸네일 문구 2개 제안(짧고 강하게).
- 설명: 한줄요약(어려움→해결) → 상세 → 타임스탬프 4~6개 → 돕는 톤 회사소개 → ☎${COMPANY.tel}.
- 해시태그 10개 + 검색태그(쉼표) 별도.`,

  instagram: `[채널] 인스타그램 — 짧고 시각적.
- 첫 줄: 고객 어려움 한 줄(후킹, 이모지 1개).
- 2~3줄 공감+해결 요약. "사세요"보다 "이게 맞을까요? 같이 봐드려요" 톤.
- 위치+☎${COMPANY.tel}(상담 무료) 1줄.
- 끝에 . 줄바꿈 . 후 해시태그 15~20개(대형·소형 혼합).`,

  threads: `[채널] 쓰레드 — 500자 이내, 대화체.
- 첫 줄 공감(현장 에피소드/고객 어려움) → 짧은 해결/팁 → "편하게 물어보세요".
- 영업 냄새 최소화, 사람 냄새. 해시태그 2~4개만. 가끔 질문형으로 끝내 댓글 유도.`,

  facebook: `[채널] 페이스북 — 지역 사업주(중장년) 신뢰 스토리, 약간 긴 글 허용.
- 고객 어려움/현장 스토리로 따뜻하게 시작 → 함께 찾은 해결 → "파는 곳이 아니라 돌봐드리는 곳, 동네 IT 담당자" 철학 한 단락 → 부담 없는 문의 유도.
- ☎${COMPANY.tel} + 해시태그 3~7개. 진중·따뜻한 톤.`,
};

const TYPE_GUIDE: Record<string, string> = {
  review: "글 유형: 후기형 — 상황→추천 이유→설치 과정→솔직 평가→이런 분께 추천.",
  guide:  "글 유형: 가이드형 — 왜 필요한가→선택지 비교(표 가능)→상황별 추천→선택 기준 N가지→주의점.",
  case:   "글 유형: 사례형(B2B) — 고객사 소개→요청사항→제안 구성→구축 과정→도입 효과→비슷한 고민 상담 제안.",
};

interface GenInput {
  channel: string;
  seed?: string;
  kw?: string;
  tone?: string;
  region?: string;
  model?: string;
  service?: string;
  pain?: string;
  solution?: string;
  postType?: string;
  imageDesc?: string;
  imageCount?: number;
  history?: string[];
}

function buildPrompt(p: GenInput): string {
  const agent = CHANNEL_AGENTS[p.channel];
  if (!agent) throw new Error("알 수 없는 채널: " + p.channel);
  const typeGuide = TYPE_GUIDE[p.postType ?? ""] || TYPE_GUIDE.review;

  const imageBlock = p.imageDesc ? `
[첨부 사진 분석 결과]
${p.imageDesc}
★ 매우 중요: 글의 내용은 위 사진에 실제로 보이는 것과 반드시 일치해야 합니다. 사진에 없는 장비·모델·상황을 지어내지 마세요. 글과 사진이 어긋나면 신뢰가 깨집니다.` : "";

  // 사진 첨부 개수 기반 마커 배치 지침. 채널별 분량(블로그 4000자)이 길어서 골고루 분산이 중요.
  const photoMarkerBlock = (() => {
    const n = p.imageCount ?? 0;
    if (n <= 0) {
      return `
[사진 마커]
- 첨부된 사진이 없습니다. 본문에 [📷 사진 …] 마커를 절대 넣지 마세요.`;
    }
    const examples = Array.from({ length: n }, (_, i) =>
      `[📷 사진 ${i + 1} — (이 자리에 들어갈 사진의 내용을 한 줄로 적기, 예: '설치 완료된 모습', '기존 장비 점검 중' 등)]`
    ).join("\n");
    return `
[사진 마커 — 절대 규칙]
- 사용자가 사진을 정확히 ${n}장 첨부했습니다. 본문에 [📷 사진 1] 부터 [📷 사진 ${n}] 까지 마커를 반드시 ${n}개 모두 넣으세요. ${n}개보다 적게 넣으면 안 되고, ${n}개보다 많이 넣어도 안 됩니다.
- ${n}개의 마커는 본문 중간중간에 골고루 분산 배치하세요. 글 시작이나 끝에 몰리지 않게, 단락과 단락 사이에 자연스럽게 끼우세요.
- 각 마커는 한 줄 통째로 쓰고(앞뒤 빈 줄로 분리), 캡션은 [📷 사진 N — ...] 형태로 짧게 적으세요.
- 마커 형식 예시:
${examples}`;
  })();

  const histBlock = (p.history && p.history.length) ? `
[참고: 이 채널의 과거 발행 사례 (톤·구성을 참고하되 내용은 새로 작성)]
${p.history.slice(0, 3).map((h, i) => `(${i + 1}) ${String(h).slice(0, 300)}`).join("\n---\n")}` : "";

  const kwBlock = (p.kw && p.kw.trim())
    ? `- 핵심 키워드: ${p.kw}`
    : `- 핵심 키워드: (자동) 지역·서비스·모델·증상을 바탕으로 검색에 유리한 핵심 키워드 4~6개를 스스로 정해 글과 해시태그에 자연스럽게 녹이세요.`;

  return `${PHILOSOPHY}

${agent}

${typeGuide}
${imageBlock}
${photoMarkerBlock}
${histBlock}

[이번 글의 입력값]
- 지역: ${p.region || "대구"}
- 서비스 분류: ${p.service || "(미지정)"}
- 모델/장비: ${p.model || "(미지정)"}
- 고객이 겪던 어려움/증상: ${p.pain || "(미지정 — 사무환경 정비의 막막함으로 가정)"}
- 해결 방법: ${p.solution || "(미지정 — 한 일에서 유추)"}
- 한 일/핵심 메시지: ${p.seed || "(미지정)"}
${kwBlock}

위 입력값과 채널 지침에 따라, 바로 발행 가능한 완성된 글 1편을 한국어로 작성하세요. 설명이나 머리말 없이 본문만 출력하세요.`;
}

async function callClaude(prompt: string) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) throw new Error("Anthropic " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const u = d.usage || {};
  const inTok = u.input_tokens || 0, outTok = u.output_tokens || 0;
  const usd = (inTok / 1e6) * 3 + (outTok / 1e6) * 15;
  return {
    text: d.content.map((c: { text: string }) => c.text).join(""),
    usage: { model: "claude-sonnet-4-5", input_tokens: inTok, output_tokens: outTok, usd: +usd.toFixed(5) },
  };
}

async function analyzeImages(images: { media_type?: string; data: string }[]) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY 시크릿이 필요합니다.");
  if (!images || !images.length) throw new Error("분석할 이미지가 없습니다.");
  const content: unknown[] = [];
  images.slice(0, 4).forEach((img) => {
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type || "image/jpeg", data: img.data } });
  });
  content.push({
    type: "text",
    text:
      `당신은 컴퓨터·프린터·복사기·복합기·시놀로지 NAS 등 사무기기/전산 장비 전문가입니다. 위 사진들을 분석해서 블로그 글 작성에 쓸 수 있도록 정리하세요:\n` +
      `1) 사진에 보이는 장비/물건이 무엇인지 (가능하면 종류·브랜드 추정)\n` +
      `2) 현장/상황 (사무실, 설치 중, 케이블 정리 등)\n` +
      `3) 글에 활용할 만한 시각적 포인트\n` +
      `4) 주의: 확실하지 않은 모델명은 단정하지 말고 '추정'으로 표기.\n` +
      `간결한 한국어로, 사실 위주로만 작성하세요.`,
  });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 800, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error("Vision " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const u = d.usage || {};
  const usd = ((u.input_tokens || 0) / 1e6) * 3 + ((u.output_tokens || 0) / 1e6) * 15;
  return {
    desc: d.content.map((c: { text: string }) => c.text).join(""),
    usage: { usd: +usd.toFixed(5), input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 },
  };
}

async function generateImage(promptText: string) {
  if (!OPENAI_KEY) throw new Error("AI 그림 생성은 OPENAI_API_KEY 시크릿이 필요합니다.");
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": "Bearer " + OPENAI_KEY },
    body: JSON.stringify({ model: "dall-e-3", prompt: promptText, n: 1, size: "1024x1024" }),
  });
  if (!r.ok) throw new Error("Image " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  return { url: d.data[0].url, usage: { usd: 0.04 } };
}

// ──────────────────────────────────────────────
// Google OAuth + Blogger
// ──────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 평문 본문 → Blogger용 간단 HTML.
// images 가 있으면 [📷 사진 N — ...] 마커 자리에 순서대로 <img> data: URL 인라인 삽입.
// 마커보다 사진이 많으면 본문 끝에 추가. 마커가 많으면 남은 자리는 placeholder 박스 유지.
function textToBloggerHtml(
  text: string,
  images: { media_type?: string; data?: string; url?: string }[] = [],
): string {
  // 사진은 Storage URL(im.url) 우선, 없으면 base64(im.data)
  const srcOf = (im: { media_type?: string; data?: string; url?: string }) =>
    im.url ? im.url : `data:${im.media_type || "image/jpeg"};base64,${im.data}`;
  const photoMarker = /\[📷[^\]]*\]/g;
  let imgIdx = 0;
  const replaced = text.replace(photoMarker, (m) => {
    const caption = m.replace(/[\[\]]/g, "").trim();
    if (imgIdx < images.length) {
      const im = images[imgIdx++];
      // 캡션에 || 가 섞일 일은 없지만 안전하게 인코딩
      const safeCaption = caption.replace(/\|/g, "│");
      return `\n<!--IMG-->${srcOf(im)}||${safeCaption}<!--/IMG-->\n`;
    }
    return `\n<!--PHOTO-->${caption}<!--/PHOTO-->\n`;
  });
  // 마커보다 사진이 많으면 끝에 "현장 사진" 으로 덧붙임
  let withExtras = replaced;
  if (imgIdx < images.length) {
    const extras = images.slice(imgIdx).map((im) =>
      `\n\n<!--IMG-->${srcOf(im)}||현장 사진<!--/IMG-->\n`
    ).join("");
    withExtras = replaced + extras;
  }
  const paragraphs = withExtras.split(/\n{2,}/);
  return paragraphs.map((para) => {
    const trimmed = para.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<!--IMG-->")) {
      const inner = trimmed.replace(/<!--\/?IMG-->/g, "").trim();
      const sep = inner.indexOf("||");
      const src = sep >= 0 ? inner.slice(0, sep) : inner;
      const caption = sep >= 0 ? inner.slice(sep + 2) : "";
      return `<div style="margin:14px 0;text-align:center"><img src="${src}" style="max-width:100%;height:auto;border-radius:8px"/>${caption ? `<div style="font-size:12px;color:#888;margin-top:6px">${escHtml(caption)}</div>` : ""}</div>`;
    }
    if (trimmed.startsWith("<!--PHOTO-->")) {
      const caption = trimmed.replace(/<!--\/?PHOTO-->/g, "").trim();
      return `<div style="border:2px dashed #ccc;border-radius:10px;padding:24px 12px;text-align:center;color:#aaa;margin:14px 0;font-size:13px">📷 ${escHtml(caption)}</div>`;
    }
    return `<p>${escHtml(trimmed).replace(/\n/g, "<br/>")}</p>`;
  }).filter(Boolean).join("\n");
}

async function googleAccessToken(): Promise<string> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 시크릿이 필요합니다.");
  if (!GOOGLE_REFRESH_TOKEN)
    throw new Error("GOOGLE_REFRESH_TOKEN 시크릿이 없습니다. 먼저 콘솔에서 '구글 블로그 연결'을 한 번 진행하세요.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error("Google token refresh " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  return d.access_token as string;
}

async function googleConnect(code: string, redirect_uri: string) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 시크릿이 먼저 등록되어야 합니다.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!r.ok) throw new Error("Google exchange " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  if (!d.refresh_token) {
    throw new Error("refresh_token이 발급되지 않았습니다. 동의 화면에 'prompt=consent'가 적용되도록 콘솔에서 다시 연결을 시도하세요.");
  }

  // 한별 계정에 연결된 블로그 목록 조회
  const blogsR = await fetch("https://www.googleapis.com/blogger/v3/users/self/blogs", {
    headers: { Authorization: "Bearer " + d.access_token },
  });
  const blogs: { id: string; name: string; url: string }[] = [];
  if (blogsR.ok) {
    const bd = await blogsR.json();
    for (const b of (bd.items || [])) {
      blogs.push({ id: b.id, name: b.name, url: b.url });
    }
  }

  return { refresh_token: d.refresh_token as string, blogs };
}

// YouTube: resumable upload session 만 만들고 upload URL 을 콘솔에 돌려준다.
// 영상 바이너리는 콘솔 → YouTube 로 직접 PUT 해서 Edge Function body 한계를 피한다.
async function youtubeStartUpload(p: {
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  privacy?: "public" | "unlisted" | "private";
  sizeBytes: number;
  mimeType: string;
}) {
  const accessToken = await googleAccessToken();
  const meta = {
    snippet: {
      title: (p.title || "").slice(0, 100),                 // YouTube 제한 100자
      description: (p.description || "").slice(0, 5000),    // 5000자
      tags: (p.tags || []).slice(0, 30),
      categoryId: p.categoryId || "22",                     // People & Blogs
      defaultLanguage: "ko",
    },
    status: {
      privacyStatus: p.privacy || "public",
      selfDeclaredMadeForKids: false,
      embeddable: true,
      license: "youtube",
    },
  };

  const r = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(p.sizeBytes),
        "X-Upload-Content-Type": p.mimeType,
      },
      body: JSON.stringify(meta),
    },
  );
  if (!r.ok) throw new Error("YouTube start upload " + r.status + ": " + (await r.text()).slice(0, 300));
  const uploadUrl = r.headers.get("Location");
  if (!uploadUrl) throw new Error("YouTube upload Location 헤더가 응답에 없습니다.");
  return { uploadUrl };
}

async function publishGoogle(p: {
  title: string;
  content: string;
  labels?: string[];
  blogId?: string;
  isDraft?: boolean;
  images?: { media_type?: string; data?: string; url?: string }[];
}) {
  const blogId = p.blogId || GOOGLE_BLOG_ID;
  if (!blogId) throw new Error("blogId 또는 GOOGLE_BLOG_ID 시크릿이 필요합니다.");
  const accessToken = await googleAccessToken();

  const isHtml = /<\w+[^>]*>/.test(p.content);
  const html = isHtml ? p.content : textToBloggerHtml(p.content, p.images || []);

  const body = {
    kind: "blogger#post",
    title: p.title,
    content: html,
    labels: p.labels || [],
  };

  const qs = p.isDraft ? "?isDraft=true" : "";
  const r = await fetch(
    `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts${qs}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + accessToken,
      },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error("Blogger publish " + r.status + ": " + (await r.text()).slice(0, 300));
  const d = await r.json();
  return { id: d.id as string, url: d.url as string, published: d.published as string };
}

// ──────────────────────────────────────────────
// 대기열 파이프라인 (Supabase DB, service_role)
//   소재 → AI 채널별 생성 → post_queue 적재(pending) → 검토/승인 → 발행(published)
// ──────────────────────────────────────────────

interface QueueGenInput {
  topic: string;
  raw_context?: string;
  region?: string;
  post_type?: string;        // review|guide|case
  image_desc?: string;
  image_count?: number;
  kw?: string;
  model?: string;
  service?: string;
  pain?: string;
  solution?: string;
  channels?: string[];       // 비우면 6채널 전부
}

// PostgREST 호출 (service_role → RLS 우회). path 예: "autopost_post_queue?id=eq.3"
async function sbRest(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      authorization: "Bearer " + SERVICE_KEY,
      "content-type": "application/json",
      ...extra,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error("DB " + r.status + ": " + (await r.text()).slice(0, 300));
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// 소재 1건 → 요청 채널들 AI 생성 → 대기열에 pending 으로 적재
async function queueGenerate(p: QueueGenInput) {
  const channels = (p.channels && p.channels.length ? p.channels : Object.keys(CHANNEL_AGENTS))
    .filter((c) => CHANNEL_AGENTS[c]);
  if (!channels.length) throw new Error("유효한 채널이 없습니다.");

  const out: Record<string, unknown> = {};
  let totalUsd = 0;
  for (const ch of channels) {
    const res = await callClaude(buildPrompt({
      channel: ch,
      seed: p.raw_context,
      kw: p.kw,
      region: p.region,
      model: p.model,
      service: p.service,
      pain: p.pain,
      solution: p.solution,
      postType: p.post_type,
      imageDesc: p.image_desc,
      imageCount: p.image_count,
    }));
    out[ch] = { text: res.text, usage: res.usage };
    totalUsd += res.usage.usd;
  }

  const row = {
    topic: p.topic,
    raw_context: p.raw_context || "",
    region: p.region || null,
    post_type: p.post_type || null,
    image_desc: p.image_desc || null,
    image_count: p.image_count || 0,
    channels: out,
    status: "pending",
    total_usd: +totalUsd.toFixed(5),
  };
  const inserted = await sbRest("POST", "autopost_post_queue", row, { Prefer: "return=representation" });
  return Array.isArray(inserted) ? inserted[0] : inserted;
}

async function queueList(status?: string) {
  const q = status
    ? `autopost_post_queue?status=eq.${encodeURIComponent(status)}&order=created_at.desc`
    : `autopost_post_queue?order=created_at.desc`;
  return await sbRest("GET", q);
}

async function queueUpdate(id: number, patch: Record<string, unknown>) {
  const updated = await sbRest("PATCH", `autopost_post_queue?id=eq.${id}`, patch, { Prefer: "return=representation" });
  return Array.isArray(updated) ? updated[0] : updated;
}

async function queueDelete(id: number) {
  await sbRest("DELETE", `autopost_post_queue?id=eq.${id}`);
  return { deleted: id };
}

// 첨부 사진(base64) → Storage 업로드 → 공개 URL. 대기열이 사진을 들고 다니게 함.
async function uploadMedia(images: { data: string; media_type?: string }[]) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Storage 환경변수(SUPABASE_URL/SERVICE_ROLE)가 없습니다.");
  const out: { url: string }[] = [];
  for (const img of images.slice(0, 10)) {
    const mt = img.media_type || "image/jpeg";
    const ext = mt.includes("png") ? "png" : mt.includes("webp") ? "webp" : "jpg";
    const path = `posts/${crypto.randomUUID()}.${ext}`;
    const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/autopost-media/${path}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: "Bearer " + SERVICE_KEY,
        "content-type": mt,
        "x-upsert": "true",
      },
      body: bytes,
    });
    if (!r.ok) throw new Error("Storage " + r.status + ": " + (await r.text()).slice(0, 200));
    out.push({ url: `${SUPABASE_URL}/storage/v1/object/public/autopost-media/${path}` });
  }
  return out;
}

// 콘솔이 이미 생성해 둔 초안(channels 맵)을 재생성 없이 대기열에 pending 으로 적재
async function queueSave(p: {
  topic: string;
  raw_context?: string;
  region?: string;
  post_type?: string;
  image_desc?: string;
  image_count?: number;
  channels: Record<string, { text: string; usage?: unknown }>;
  images?: { url: string; caption?: string }[];
  total_usd?: number;
  scheduled_at?: string | null;
}) {
  if (!p.channels || !Object.keys(p.channels).length) throw new Error("channels 가 비었습니다.");
  const row = {
    topic: p.topic,
    raw_context: p.raw_context || "",
    region: p.region || null,
    post_type: p.post_type || null,
    image_desc: p.image_desc || null,
    image_count: p.image_count || 0,
    channels: p.channels,
    images: p.images || [],
    status: "pending",
    total_usd: p.total_usd || 0,
    scheduled_at: p.scheduled_at || null,
  };
  const inserted = await sbRest("POST", "autopost_post_queue", row, { Prefer: "return=representation" });
  return Array.isArray(inserted) ? inserted[0] : inserted;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

  const url = new URL(req.url);
  // 함수 슬러그 다음의 서브 경로만 떼서 라우팅 (e.g. /functions/v1/hanbyul-autopost-ai/health)
  const sub = url.pathname.replace(/^\/+(?:functions\/v1\/)?[^/]+/, "") || "/";

  try {
    if (req.method === "GET" && (sub === "/health" || sub === "/")) {
      return jsonResponse(200, {
        ok: true,
        ai: ANTHROPIC_KEY ? "anthropic" : "none",
        vision: !!ANTHROPIC_KEY,
        imagegen: !!OPENAI_KEY,
        videogen: false,
        queue: !!(SUPABASE_URL && SERVICE_KEY),
        channels: Object.keys(CHANNEL_AGENTS),
        publishers: {
          google: {
            configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
            connected: !!GOOGLE_REFRESH_TOKEN,
            blog_id_set: !!GOOGLE_BLOG_ID,
            client_id_hint: GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID.slice(0, 12) + "…" : "",
          },
          youtube: {
            // 같은 GOOGLE_REFRESH_TOKEN 을 사용. scope 에 youtube.upload 가 포함돼야 함.
            // configured 는 클라이언트가 있고 refresh_token 도 있는지 정도만.
            configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
          },
        },
      });
    }

    if (req.method === "POST" && sub === "/generate") {
      const p = await req.json() as GenInput;
      const result = await callClaude(buildPrompt(p));
      return jsonResponse(200, { ok: true, channel: p.channel, text: result.text, usage: result.usage });
    }

    if (req.method === "POST" && sub === "/analyze-image") {
      const p = await req.json() as { images: { media_type?: string; data: string }[] };
      const out = await analyzeImages(p.images);
      return jsonResponse(200, { ok: true, desc: out.desc, usage: out.usage });
    }

    if (req.method === "POST" && sub === "/generate-image") {
      const p = await req.json() as { prompt?: string };
      const out = await generateImage(p.prompt || "한별시스템 사무기기 관련 깔끔한 일러스트");
      return jsonResponse(200, { ok: true, url: out.url, usage: out.usage });
    }

    if (req.method === "POST" && sub === "/google/connect") {
      const p = await req.json() as { code: string; redirect_uri: string };
      if (!p.code || !p.redirect_uri) {
        return jsonResponse(400, { ok: false, error: "code, redirect_uri 필요" });
      }
      const out = await googleConnect(p.code, p.redirect_uri);
      return jsonResponse(200, { ok: true, ...out });
    }

    if (req.method === "POST" && sub === "/youtube/start-upload") {
      const p = await req.json() as {
        title?: string;
        description?: string;
        tags?: string[];
        categoryId?: string;
        privacy?: "public" | "unlisted" | "private";
        sizeBytes?: number;
        mimeType?: string;
      };
      if (!p.title || !p.sizeBytes || !p.mimeType) {
        return jsonResponse(400, { ok: false, error: "title, sizeBytes, mimeType 필요" });
      }
      const out = await youtubeStartUpload({
        title: p.title,
        description: p.description || "",
        tags: p.tags,
        categoryId: p.categoryId,
        privacy: p.privacy,
        sizeBytes: p.sizeBytes,
        mimeType: p.mimeType,
      });
      return jsonResponse(200, { ok: true, ...out });
    }

    if (req.method === "POST" && sub === "/publish/google") {
      const p = await req.json() as {
        title?: string;
        content?: string;
        labels?: string[];
        blogId?: string;
        isDraft?: boolean;
        images?: { media_type?: string; data?: string; url?: string }[];
      };
      if (!p.title || !p.content) {
        return jsonResponse(400, { ok: false, error: "title, content 필요" });
      }
      const out = await publishGoogle({
        title: p.title,
        content: p.content,
        labels: p.labels,
        blogId: p.blogId,
        isDraft: p.isDraft,
        images: p.images,
      });
      return jsonResponse(200, { ok: true, ...out });
    }

    // ── 대기열 파이프라인 ──
    if (req.method === "POST" && sub === "/queue/generate") {
      const p = await req.json() as QueueGenInput;
      if (!p.topic) return jsonResponse(400, { ok: false, error: "topic 필요" });
      const post = await queueGenerate(p);
      return jsonResponse(200, { ok: true, post });
    }

    if (req.method === "GET" && sub === "/queue") {
      const status = url.searchParams.get("status") || undefined;
      const posts = await queueList(status);
      return jsonResponse(200, { ok: true, posts });
    }

    if (req.method === "POST" && sub === "/queue/update") {
      const p = await req.json() as { id?: number; status?: string; patch?: Record<string, unknown> };
      if (!p.id) return jsonResponse(400, { ok: false, error: "id 필요" });
      const patch = p.patch || (p.status ? { status: p.status } : {});
      if (!Object.keys(patch).length) return jsonResponse(400, { ok: false, error: "status 또는 patch 필요" });
      const post = await queueUpdate(p.id, patch);
      return jsonResponse(200, { ok: true, post });
    }

    if (req.method === "POST" && sub === "/queue/delete") {
      const p = await req.json() as { id?: number };
      if (!p.id) return jsonResponse(400, { ok: false, error: "id 필요" });
      return jsonResponse(200, { ok: true, ...(await queueDelete(p.id)) });
    }

    if (req.method === "POST" && sub === "/queue/save") {
      const p = await req.json() as Parameters<typeof queueSave>[0];
      if (!p.topic || !p.channels) return jsonResponse(400, { ok: false, error: "topic, channels 필요" });
      const post = await queueSave(p);
      return jsonResponse(200, { ok: true, post });
    }

    if (req.method === "POST" && sub === "/media/upload") {
      const p = await req.json() as { images?: { data: string; media_type?: string }[] };
      if (!p.images || !p.images.length) return jsonResponse(400, { ok: false, error: "images 필요" });
      const images = await uploadMedia(p.images);
      return jsonResponse(200, { ok: true, images });
    }

    return jsonResponse(404, { ok: false, error: "Not found. 사용: GET /health, /queue · POST /generate, /analyze-image, /generate-image, /google/connect, /publish/google, /queue/generate, /queue/update, /queue/delete" });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message || String(e) });
  }
});
