// 한별시스템 AI 발행 백엔드 (Supabase Edge Function 버전)
// ─────────────────────────────────────────────
// 원본: AI백엔드/server.js (Node) → Deno 런타임으로 이식.
// 키는 Supabase Secret(ANTHROPIC_API_KEY)에서만 읽고, 브라우저에는 노출되지 않음.
//
// 라우팅 (function 슬러그 기준):
//   GET  /functions/v1/hanbyul-autopost-ai/health
//   POST /functions/v1/hanbyul-autopost-ai/generate
//   POST /functions/v1/hanbyul-autopost-ai/analyze-image
//
// CORS: ALLOW_ORIGIN 환경변수(없으면 *). Pages URL 정해지면 좁히세요.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const ALLOW_ORIGIN  = Deno.env.get("ALLOW_ORIGIN") || "*";

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
- [📷 사진 1], [📷 사진 2] 자리 2개 이상 표시.
- 분량 1,200~1,800자. 핵심 키워드 3~5회 자연 반복.
- 끝에 오시는 길/연락처(도움 톤) + 해시태그 10~15개(#지역+키워드, #키워드, #모델명, #${COMPANY.name}).`,

  google: `[채널] 구글 블로그(Blogger) — 구글 SEO + 영문 병기.
- 제목: "[지역] [키워드] — [고객문제], 함께 해결한 이야기 | ${COMPANY.name}". 영문 모델/브랜드 병기(Synology, Kyocera 등).
- 소제목(##, ###)으로 구조화. 본문은 고객 어려움→공감→해결→돕는 톤 회사 소개.
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
      max_tokens: 2000,
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
        imagegen: false,
        videogen: false,
        channels: Object.keys(CHANNEL_AGENTS),
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

    return jsonResponse(404, { ok: false, error: "Not found. 사용: GET /health, POST /generate, /analyze-image" });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message || String(e) });
  }
});
