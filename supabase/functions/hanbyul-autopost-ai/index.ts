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
- 입력값에 없는 업종·장소·수치·고객 반응을 지어내지 않는다. "달서구 사무실" 이라고 줬으면 병원·학원으로 바꾸지 마라. 미지정이면 두루뭉술하게 쓰거나 비운다.
`;

/* ══════════════ 사람이 쓴 글처럼 ══════════════
   AI 글은 한국어에서 측정 가능한 흔적을 남긴다(KatFishNet, ArXiv 2503.00032).
   아래 규칙은 im-not-ai(humanize-korean v2.3) 룰북의 S1·S2 핵심 패턴을 생성 단계에 옮긴 것이다.
   문체만 바꾸는 것이지 사실을 바꾸지 않는다. 생성 뒤 humanizePass() 가 같은 룰북으로 한 번 더 다듬는다. */
const HUMAN_VOICE = `
[사람이 쓴 글처럼 — 반드시 지킬 것]
AI가 쓴 티가 나면 독자도 검색엔진도 신뢰하지 않는다. 아래를 지켜라.

1) 쉼표를 아껴라. AI 글의 최대 흔적이다.
   - 한 문장에 쉼표는 최대 1개. 대부분은 0개가 자연스럽다.
   - 연결어미(-고/-며/-지만/-면서/-아서/-어서) 바로 뒤에 쉼표를 찍지 마라. "그래서, 결국," 도 금지.
2) 문장 길이를 들쭉날쭉하게. 짧은 문장(10자 안팎)과 긴 문장(40자 이상)을 섞어라.
   비슷한 길이가 세 문장 이어지면 하나를 잘라라. 같은 종결어미가 네 문장 연속이면 바꿔라.
3) 아래 단어·표현은 쓰지 마라. AI 글에서 과하게 나온다.
   중요하다 · 핵심적 · 효과적 · 지속가능한 · 혁신적 · 획기적 · 압도적 · 다양한 · 필수적 · 주목할 만한 · 시사하는 바
   → 대신 구체적으로. "효과적입니다" 가 아니라 "출력 대기 시간이 절반으로 줄었습니다".
4) 번역투를 버려라.
   - "~에 대해" → "~을/를",  "~를 통해" → "~로",  "~에 있어서" → "~에서"
   - "가지고 있다" → "있다",  "되어진다" → "된다",  "~에 의해" → 행위자를 주어로
   - "할 수 있습니다" 를 연달아 쓰지 마라. 한 문단에 한 번이면 충분하다.
   - "~것입니다" · "~일 것이다" 로 문장을 자꾸 끝내지 마라.
   - "단순한 X를 넘어 Y" · "X에서 Y로" 같은 상승 공식 금지.
5) 이런 말로 시작하거나 끝내지 마라. AI 글의 전형이다.
   시작: "물론입니다" · "다음은 ~입니다" · "크게 세 가지로 나눌 수 있다" · "오늘은 ~에 대해 알아보겠습니다"
   끝: "결론적으로" · "정리하면" · "요약하자면" · "~하시길 바랍니다" · "~할 때입니다" · "도움이 되셨길"
   → 마지막은 실제로 할 말로 끝내라. 궁금한 걸 물어보라거나, 우리가 뭘 해줄 수 있다거나.
6) 분열문 금지. "중요한 것은 ~이다" · "핵심은 ~다" · "문제는 ~라는 점이다" → 주어-서술로 바로. "방향이 필요하다".
7) 명사만 늘어놓지 말고 동사로 말해라. "장비 교체 작업 진행" → "장비를 바꿔 드렸습니다".
   "-성/-적/-화" 한자어 명사화를 쌓지 마라. "전략적 함의" 같은 "~적 N" 체인 금지.
8) 목록을 3개씩 맞추지 마라. 2개면 2개, 4개면 4개. "1) 2) 3)" 번호 나열보다 문장으로 풀어라.
   블로그에서 불릿을 3블록 이상 연달아 쓰지 마라. 나열이 진짜 필요한 곳(체크리스트·비교)만.
9) 장식을 줄여라.
   - 대시(—) 로 부연하지 마라. 쉼표·괄호·새 문장으로. 하이픈(-)도 부연용으로 쓰지 마라.
   - 따옴표 강조 금지. 진짜 인용(고객이 한 말)에만 따옴표.
   - 블로그(네이버·구글)에는 이모지를 넣지 마라. 인스타·쓰레드·페이스북만 1~2개 허용.
   - "이는 ~" · "즉" · "또한/따라서/나아가" 문두 접속사는 문단에 한 번까지.
10) 비유·은유를 새로 만들지 마라. "적신호" · "청사진" · "신호탄" · "뿌리내리다" 같은 사전 은유 금지. 그냥 사실을 써라.
11) 사람 손 자국을 남겨라. 실제 겪은 것 한 줄(현장에서 본 것, 사장님이 한 말, 그날 날씨나 상황).
    완벽하게 매끄러운 글보다 살짝 투박한 게 사람 글이다.
12) 숫자를 넣어라. 글마다 금액·기간·대수·연도 중 2개 이상. 한별 실적은 이 숫자만 쓴다:
    2008년 창업 19년차 · 관리 고객사 200곳 이상 · NAS 구축 100건 이상 · 복사기 300대 이상 · 대구·경북 당일 방문. 다른 실적 숫자를 지어내지 마라.
13) 첫 3문장 안에 고객이 겪는 문제가 나와야 한다. 회사 소개·배경 설명·"요즘 ~가 화제" 로 시작하지 마라.
14) 한 문장은 30자 안팎, 60자를 넘기지 마라. "입니다/습니다" 로 끝나는 문장을 3개 연달아 쓰지 마라(~요, 명사형, 질문을 섞어라).
15) 느낌표는 글 전체 1개까지. 아래 말은 쓰지 마라(나오면 숫자나 실제 행동으로 바꿔라):
    최첨단 · 차별화 · 극대화 · 선도 · 최적 · 완벽 · 놀라운 · 최고 · 맞춤형 · 솔루션 · 신뢰할 수 있는 · 지속적인 · 경쟁력 · 스마트한 · 전문성 · 원스톱 · 강력한 · 간편하게 · 안심 · 걱정 없이 · ~시대 · 시너지 · 노하우 · 파트너 · 든든 · 책임집니다 · 자랑
`;

/* ══════════════ 노출(SEO · AEO · GEO) ══════════════
   SEO = 검색엔진 순위. AEO = 답변으로 뽑히기. GEO = AI 검색에 인용되기.
   셋은 요구가 다르다. AI 검색은 "질문에 바로 답한 짧은 문단"을 통째로 인용해 간다. */
const SEO_GUIDE = `
[검색·AI 노출(SEO·AEO·GEO) — 반드시 지킬 것]
1) 제목: 지역 + 무엇 + 누구를 위한 것인지가 드러나야 한다.
   - 사람이 실제로 검색창에 치는 말로 써라. "대구 사무실 NAS 설치" 처럼.
   - 낚시 제목 금지. 제목과 본문이 다르면 순위가 떨어진다.
   - 가끔은 뒤집어라. "NAS 추천" 보다 "추천 제품만 보다 실패하는 이유" 쪽이 더 눌린다.
     같은 검색어를 담되 각도를 바꾸는 것이지, 없는 말을 지어내는 게 아니다.
2) 첫 문단 안에 핵심 키워드가 나와야 한다. 인사말로 세 줄을 낭비하지 마라.
3) 소제목은 라벨이 아니라 다음 문단을 읽게 만드는 문장이다. 절반 이상은 질문을 소제목으로: 사람들이 검색창에 치는 문장 그대로.
   예) "NAS 용량은 얼마나 필요할까요?" "설치까지 며칠 걸리나요?"
   나머지는 경고형("이 설정 하나 빼먹으면 백업이 안 됩니다")·숫자형·경험형·결과형·반전형을 섞어라. 밋밋한 명사 소제목("NAS 소개") 금지.
4) ★ 질문 바로 아래 첫 문단은 40~60자로 답부터 하라. 배경 설명은 그 다음이다.
   AI 검색(ChatGPT·퍼플렉시티·구글 AI 개요)은 이 문단을 통째로 인용한다.
   답을 문단 끝에 숨기면 인용되지 않는다.
5) ★ 인용되는 문단은 혼자 읽혀도 뜻이 통해야 한다(GEO 핵심).
   - 문단 첫 문장에 주어를 분명히. "이것은" · "그 장비는" 같은 지시어로 시작하지 마라. "시놀로지 DS925+는" 처럼.
   - 글에 한 번은 정의문을 넣어라. "NAS는 사무실 자료를 한곳에 모아 두는 저장 장치다" 처럼 한 줄로.
   - 숫자를 넣어라. "빠릅니다" 가 아니라 "5분이면 됩니다". 숫자에는 조건을 붙여라(용량·대수·기간).
   - 근거가 있으면 출처를 이름으로 써라(제조사 안내, 현장 계측 등). 근거 없는 단정 금지. 틀린 문장이 인용되면 더 손해다.
   - 기준 시점을 한 번 밝혀라. "2026년 9월 기준" 처럼. AI 검색은 최신 글을 고른다.
6) "한별시스템" 과 "대구" 가 사실 문장 안에 같이 한 번은 나와야 한다. 회사소개가 아니라 사실 문장으로.
   예) "한별시스템이 대구 달서구 사무실에 설치한 DS925+는 ~".
7) ★ 글 아래쪽에 "자주 묻는 질문" 을 정확히 3개, "Q. 질문" 줄 다음 "A. 답" 줄 형태로 붙여라(CTA 문단 앞). 답은 두 문장 이내.
   고객이 실제로 궁금해하는 것으로 골라라: 비용(부가세 포함 여부)·걸리는 기간·기존 장비와 호환·고장 나면 어떻게·꼭 우리 업체에 맡겨야 하는지 같은 것. 뻔한 홍보성 질문 금지.
8) 짧은 채널(인스타·쓰레드·페이스북)은 위 4)~6) 대신, 혼자 읽혀도 뜻이 통하는 사실 문장을 하나 넣어라.
9) 읽는 사람이 자기를 대입할 자리를 만들어라.
   같은 검색어로 우리보다 위에 있는 글들의 공통점이다(2026-09 실측).
   - 규모·상황을 구간으로 갈라라. "직원 1~5명이면 이걸로 충분하고, 10명 넘어가면 ~" 처럼.
   - A와 B를 대놓고 비교해라. "가정용과 기업용은 여기가 다릅니다" 처럼.
   - 이렇게 쓰면 숫자가 저절로 늘어난다. 숫자를 억지로 끼워 넣는 것보다 이 편이 자연스럽다.
10) 해시태그·키워드는 지역·모델·증상 위주로. 뜬구름 잡는 말은 빼라.
`;

/* ══════════════ 블로그 도입부 · 흐름 · 마무리 ══════════════
   정보는 좋은데 첫 부분에서 이탈하는 문제를 잡는다. 사장님 지시(2026-09-06). */
const HOOK_GUIDE = `
[블로그 도입부 · 흐름 · 마무리 — 반드시 지킬 것]
1) 첫 문단은 훅이다. 독자가 "이거 내 이야기인데?" 하고 멈추게 만들어라. 첫 3문장 안에서 승부가 난다.
   아래 중 하나 이상으로 연다. 회사 인사로 열지 마라.
   - 독자가 공감할 만한 고민 ("월요일 아침에 공유폴더가 안 열리면 하루가 꼬입니다")
   - 의외의 사실이나 반전 ("NAS 고장의 절반은 하드가 아니라 전원 문제였습니다")
   - "나도 그런데" 싶은 상황 (현장에서 실제로 본 장면 한 줄)
   - 이 글을 읽으면 얻는 결과 ("10분이면 우리 사무실에 맞는 용량이 나옵니다")
   과장·낚시 금지. 실제 블로그에서 쓰는 말투로. 서론은 4~6문장. 첫 문장은 강하고 구체적으로.
   서론 흐름: 독자의 문제 짚기 → 감정적 공감 → 흔한 생각에 의문 제기 → 이 글에서 해결할 내용 예고 → 계속 읽어야 하는 이유.
2) 훅 다음에 "한별시스템입니다" 인사는 한 줄이면 된다. 그 뒤로 바로 정보.
3) 흐름: 문단마다 다음 문단이 궁금해지게 끝내라. 질문을 던지고 다음 소제목에서 답하는 식으로.
   같은 말을 되풀이해 분량을 채우지 마라. 사례·숫자·비교·체크리스트로 채워라.
4) 마지막 문단은 자연스러운 행동 유도(CTA)로 끝낸다. 광고 문구가 아니라 대화처럼.
   - 독자의 경험을 댓글로 물어라 ("여러분 사무실은 백업 어떻게 하고 계세요? 댓글로 남겨 주시면 같이 봐드릴게요")
   - 또는 이어서 읽을 글을 권해라 ("NAS 용량 고르는 법은 다음 글에서 이어집니다")
   그 다음 줄에 상호·전화번호 한 줄, 그 다음 해시태그.
`;

/* ══════════════ 모바일 가독성 · 저장되는 구조 ══════════════
   네이버·구글 블로그는 모바일에서 읽힌다. 사장님 프롬프트 #03·#13 반영. */
const READABILITY = `
[모바일 가독성 · 저장되는 구조 — 블로그]
- 문단은 2~3문장까지. 긴 문장은 둘로 나눠라. 모바일 화면에서 한 문단이 5줄을 넘기면 안 읽는다.
- 소제목은 자연스러운 전환 지점마다. 긴 나열은 불릿이나 번호로(단 나열이 진짜 필요한 곳만).
- 글 중간에 한 번은 "사람들이 자주 하는 실수와 해결" 을 넣어라. 저장하게 만드는 건 이 부분이다.
- CTA 앞에 한눈에 다시 볼 수 있는 핵심 요약(체크리스트 3~5줄)을 넣어라.
- 반복되는 표현은 지워라. 같은 뜻을 두 번 말하지 마라.
`;

const PLAN_DELIM = "===기획메모===";   // 기획 메모 구분선. splitPlan() 이 여기서 자른다.

/* ══════════════ 블로그 기획 메모 ══════════════
   본문 뒤에 PLAN_DELIM 로 분리해 붙인다. 발행 본문에는 안 들어간다. 사장님 프롬프트 #01·#05·#10·#13 반영. */
const PLAN_GUIDE_BLOG = `
[기획 메모 — 본문 다음에 붙일 것]
본문을 다 쓴 뒤 한 줄 띄우고 정확히 "${PLAN_DELIM}" 라고 쓴 줄을 넣고, 그 아래 기획 메모를 적어라(발행되지 않는다. 사장님이 보는 것).
- 썸네일 문구 Top 3: 각 15~20자. 호기심형·숫자형·손해회피형·결과형 중 서로 다른 유형으로. 허위·낚시 금지.
- 제목 후보 5개: 메인 키워드를 앞쪽에. 호기심·숫자·손해회피·경험·비교·결과 중 다른 유형으로 한 줄씩. 본문에 쓴 제목 포함.
- 가장 약한 소제목 1개와 대안 2개.
- 댓글·공유 유도 문장 3개: '공유해주세요' 말고 실제 행동으로 이어지는 말.
- 메인 키워드 1개 · 세부 키워드 5~8개.
`;

/* ══════════════ 짧은 채널 기획 메모 ══════════════
   인스타·쓰레드는 본문 뒤에 기획 메모를 붙인다. 서버가 PLAN_DELIM 에서 잘라 plan 필드로 분리하므로
   발행 본문에는 섞이지 않는다. 사장님 지시(2026-09-06). */
const PLAN_GUIDE = `
[기획 메모 — 본문 다음에 붙일 것]
본문을 다 쓴 뒤 한 줄 띄우고 정확히 "${PLAN_DELIM}" 라고 쓴 줄을 넣고, 그 아래 기획 메모를 적어라(발행되지 않는다. 사장님이 보는 것).
- 메인 키워드: 1개
- 세부 키워드: 함께 쓸 것 5~10개 (쉼표 구분)
- 제목(첫 줄) 후보 5개: 검색 의도를 반영해 각각 다른 각도로. 번호 붙여 한 줄씩
- 본문 구조: 어떤 순서로 무엇을 말했는지 3~5줄
- 고객 Q&A 3개: 독자가 실제로 궁금해할 질문(비용·기간·호환·사후 지원)과 한 줄 답. 발행 뒤 첫 댓글로 달 용도
- 소개 문구: 검색 결과·피드에서 클릭하고 싶게 만드는 한 줄 (40자 이내)
- 추천 태그: 해시태그 후보 (본문에 쓴 것 + 대안)
키워드를 억지로 반복하지 마라. 독자가 실제로 궁금해하는 질문에 답하는 글이 되게 하라.
`;

/* ══════════════ 짧은 채널(인스타·쓰레드·페북·유튜브) 전용 ══════════════
   블로그용 규칙(소제목·Q&A·4000자)이 짧은 채널에 섞이면 haiku 가 블로그를 써 버린다(2026-09-06 실측 1,582자).
   그래서 짧은 채널은 노출 규칙·유형 가이드를 따로 짧게 준다. */
const SEO_GUIDE_SHORT = `
[검색·AI 노출 — 짧은 채널]
1) 첫 두 줄에 지역·장비·증상 같은 실제 검색어를 문장 안에 넣어라(해시태그 말고 본문에).
2) 혼자 읽혀도 뜻이 통하는 사실 문장을 하나 넣어라. 주어 분명, 숫자 하나. "한별시스템이 대구 달서구 사무실에 설치한 DS925+는 ~" 처럼.
3) 제목 줄·소제목·Q&A·표·마크다운(#, ##, **, ==) 금지. 캡션은 줄글이다.
4) 해시태그는 지역·모델·증상 위주. 뜬구름 잡는 말은 빼라.
`;
// 짧은 채널 본문 한도(해시태그 제외). buildPrompt 의 절대 규칙 + finishText 의 압축 판정이 같이 쓴다.
const CHANNEL_LIMITS: Record<string, { body: number; lines?: number; tags?: string }> = {
  instagram: { body: 250, lines: 6, tags: "8~12개" },
  threads:   { body: 450 },
};
const TYPE_GUIDE_SHORT: Record<string, string> = {
  review: "글 유형: 후기형 — 현장 한 장면 → 뭘 했나 → 달라진 것 한 줄.",
  guide:  "글 유형: 가이드형 — 고르는 기준 하나 또는 점검 항목 2~3개(저장하고 싶게).",
  case:   "글 유형: 사례형 — 어떤 사업장이 뭘 겪었고 어떻게 풀었나, 세 줄.",
  ad:     "글 유형: 광고형(SNS광고) — 훅→무엇을 누구에게→구체적 이득→조건 명시→행동 유도.",
};

const CHANNEL_AGENTS: Record<string, string> = {
  naver: `[채널] 네이버 블로그 — 검색 유입 최대화 + B2B 신뢰.
- 제목: 지역+핵심키워드를 맨 앞에. 글유형에 맞는 공식(후기/가이드/사례). 모델명 정확히.
- 본문: 첫 문단은 훅([블로그 도입부] 규칙). '${COMPANY.name}입니다' 인사는 훅 다음 한 줄. → 고객 어려움 공감 → 함께 찾은 해결 → 결과의 안심.
- 분량 3,800~4,200자 (한글 기준, 공백 포함). 길이를 채우기 위해 같은 말을 반복하지 말고 구체적 사례·수치·체크리스트·Q&A·비교표 등으로 자연스럽게 확장.
- 핵심 키워드 5~8회 자연 반복.
- 끝: 댓글·다음 글 CTA 문단 → 상호·전화(도움 톤) 한 줄 → 해시태그 10~15개(#지역+키워드, #키워드, #모델명, #${COMPANY.name}).`,

  google: `[채널] 구글 블로그(Blogger) — 구글 SEO + 영문 병기.
- 제목: 지역·키워드·달라진 것 한 줄이 들어가게. 예) "대구 사무실 NAS 설치, 직원 PC 6대 자료를 한곳으로 | ${COMPANY.name}". 대시(—) 금지, "함께 해결한 이야기" 같은 꼬리를 매번 반복하지 마라. 영문 모델/브랜드 병기(Synology, Kyocera 등).
- 소제목(##, ###)으로 구조화. 본문은 고객 어려움→공감→해결→돕는 톤 회사 소개.
- 서식 마커(발행 때 HTML 로 바뀐다): 강조할 낱말은 **굵게**, 한 줄로 기억할 핵심 답 문장은 ==형광펜== 으로 글당 2~3개만. 고객이 한 말은 > 인용 줄로. 체크리스트만 - 불릿.
- 분량 3,800~4,200자 (한글 기준, 공백 포함). 채우기 위한 반복 금지 — 소제목별로 구체적 사례·비교·체크리스트·Q&A·기술 배경 설명으로 자연스럽게 확장.
- 끝에 "Keywords:" 줄로 한글+영문 키워드 나열. 해시태그 포함.`,

  youtube: `[채널] 유튜브 — 제목/설명/태그.
- 제목 3개 제안(클릭률 순). "[고객문제] 이렇게 해결했습니다 | ${COMPANY.name}" 형태 포함.
- 썸네일 문구 2개 제안(짧고 강하게).
- 설명: 한줄요약(어려움→해결) → 상세 → 타임스탬프 4~6개 → 돕는 톤 회사소개 → ☎${COMPANY.tel}.
- 해시태그 10개 + 검색태그(쉼표) 별도.`,

  instagram: `[채널] 인스타그램 — 짧게. 길면 아무도 안 읽는다.
- ★ 본문(해시태그 제외) 250자 이내, 줄 수 6줄 이내. 넘기면 실패다. 긴 설명은 블로그 몫이다.
- 첫 줄: 고객 어려움 한 줄(후킹, 이모지 1개). 검색에도 걸리게 지역·장비 이름을 첫 줄에 넣어라.
- 2~3줄 공감+해결 요약. "사세요"보다 "이게 맞을까요? 같이 봐드려요" 톤.
- ☎${COMPANY.tel}(상담 무료) 1줄.
- 끝에 . 줄바꿈 . 후 해시태그 8~12개(대형·소형 혼합). 15개 넘기지 마라.
- [노출] 인스타 검색은 해시태그만 보지 않는다. 캡션의 첫 두 줄도 읽는다.
  '대구', 'NAS', 모델명 같은 실제 검색어를 캡션 안 문장에 자연스럽게 넣어라.
- [노출] 저장·공유가 노출을 키운다. 나중에 다시 볼 만한 것을 한 줄 넣어라
  (점검 항목, 고르는 기준, 숫자 하나). 광고 문구만 있으면 아무도 저장하지 않는다.`,

  threads: `[채널] 쓰레드 — 500자 이내, 대화체.
- 첫 줄 공감(현장 에피소드/고객 어려움) → 짧은 해결/팁 → "편하게 물어보세요".
- 영업 냄새 최소화, 사람 냄새. 해시태그 2~4개만. 가끔 질문형으로 끝내 댓글 유도.
- [노출] 쓰레드는 댓글이 붙어야 퍼진다. 마지막을 답하기 쉬운 질문으로 끝내라.
  "다들 백업 어떻게 하세요?" 처럼 한 줄로 답할 수 있는 것.
- [노출] 자랑이 아니라 겪은 일로 시작해라. 현장에서 실제로 본 장면 한 줄이 제일 잘 퍼진다.`,

  facebook: `[채널] 페이스북 — 지역 사업주(중장년) 신뢰 스토리, 약간 긴 글 허용.
- 고객 어려움/현장 스토리로 따뜻하게 시작 → 함께 찾은 해결 → "파는 곳이 아니라 돌봐드리는 곳, 동네 IT 담당자" 철학 한 단락 → 부담 없는 문의 유도.
- 글 아래쪽에 고객이 궁금해할 Q&A 3개("Q. 질문" 줄 다음 "A. 한 문장 답" 줄). 비용·기간·호환·사후 지원 같은 실제 궁금증.
- ☎${COMPANY.tel} + 해시태그 3~7개. 진중·따뜻한 톤.`,
};

const TYPE_GUIDE: Record<string, string> = {
  review: "글 유형: 후기형 — 상황→추천 이유→설치 과정→솔직 평가→이런 분께 추천.",
  guide:  "글 유형: 가이드형 — 왜 필요한가→선택지 비교(표 가능)→상황별 추천→선택 기준 N가지→주의점.",
  case:   "글 유형: 사례형(B2B) — 고객사 소개→요청사항→제안 구성→구축 과정→도입 효과→비슷한 고민 상담 제안.",
  ad:     "글 유형: 광고형(SNS광고) — 훅→무엇을 누구에게→구체적 이득→조건 명시→행동 유도.",
};

/* ══════════════ 광고형 전용 지침 ══════════════
   평소 글은 '돕는 글'이라 판매 권유를 막아 두었다. 광고형은 알릴 것이 분명히 있는 글이라
   그 빗장을 의도적으로 푼다. 다만 푸는 것은 "제안과 행동 유도"까지이고,
   과장·비방 금지는 그대로다. 표시광고법이 실제로 과태료를 매기는 지점이기도 하다. */
const AD_GUIDE = `
[광고형 — 이 글은 광고다]
평소의 '돕는 글'과 목적이 다르다. 알릴 것이 분명히 있고, 읽는 사람이 움직이게 만들어야 한다.
그래도 한별의 태도는 그대로다. 부풀리지 않고, 불리한 조건을 숨기지 않는다.

1) 첫 줄에서 승부가 난다. SNS 는 첫 문장에서 넘길지 멈출지 정해진다.
   - 짧은 채널(인스타·쓰레드·페이스북)은 '안녕하세요, 한별시스템입니다'로 시작하지 말 것. 바로 본론.
   - 훅은 고객이 실제로 겪는 상황, 구체적 숫자, 의외의 사실 중 하나로 연다.
   - 블로그(네이버·구글)는 검색 유입이 목적이므로 기존 제목 공식을 유지한다.
2) 무엇을 / 누구에게 / 왜 지금 — 셋이 반드시 드러나야 한다. 하나라도 빠지면 광고가 아니라 혼잣말이다.
3) 행동 유도(CTA)는 하나만, 구체적으로. 전화번호를 함께 적는다. 여러 개를 늘어놓으면 아무것도 안 한다.
4) 표시광고법을 지킨다 (어기면 과태료 대상이다):
   - 거짓·과장 금지. 근거를 댈 수 없는 '최고·1등·업계 유일·무조건' 같은 말은 쓰지 않는다.
   - 조건이 있으면 반드시 함께 적는다. 기간·대상·수량·선착순·재고 한정은 빠뜨리면 안 된다.
   - 할인·특가 표시는 비교 대상 가격이 실제로 존재할 때만 쓴다.
   - 다른 업체를 깎아내려 우리를 올리지 않는다.
5) 가격을 적을 때는 부가세 포함 여부를 반드시 밝힌다.
6) 짧은 채널이면 본문 뒤에 한 줄 띄우고 '--- 훅 후보 ---' 를 적은 뒤,
   첫 줄로 쓸 수 있는 다른 문장 2개를 제안한다. 어느 쪽이 반응이 좋은지 바꿔 가며 시험하기 위한 것이다.
`;

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
  // 광고형에서만 쓰는 값들
  adOffer?: string;     // 무엇을 알리나 (신모델·행사·서비스)
  adBenefit?: string;   // 고객이 얻는 것 / 혜택
  adCondition?: string; // 조건 (기간·대상·수량·부가세)
  adTarget?: string;    // 누구에게
  adCta?: string;       // 무엇을 하게 할 것인가
  imageDesc?: string;
  imageCount?: number;
  videoCount?: number;
  history?: string[];
}

function buildPrompt(p: GenInput): string {
  const agent = CHANNEL_AGENTS[p.channel];
  if (!agent) throw new Error("알 수 없는 채널: " + p.channel);
  const isBlog = p.channel === "naver" || p.channel === "google";
  const isShort = p.channel === "instagram" || p.channel === "threads";
  const typeGuide = isBlog
    ? (TYPE_GUIDE[p.postType ?? ""] || TYPE_GUIDE.review)
    : (TYPE_GUIDE_SHORT[p.postType ?? ""] || TYPE_GUIDE_SHORT.review);

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

  // 영상 마커: 블로그(네이버·구글)에서만. 첨부 영상이 본문 적정 위치에 모두 배치되도록.
  const videoMarkerBlock = (() => {
    const n = p.videoCount ?? 0;
    if (n <= 0 || (p.channel !== "naver" && p.channel !== "google")) return "";
    const examples = Array.from({ length: n }, (_, i) =>
      `[🎬 영상 ${i + 1} — (이 자리에 들어갈 영상 내용을 한 줄로, 예: '설치 과정 타임랩스')]`
    ).join("\n");
    return `
[영상 마커 — 절대 규칙]
- 사용자가 영상을 정확히 ${n}개 첨부했습니다. 본문에 [🎬 영상 1] 부터 [🎬 영상 ${n}] 까지 마커를 반드시 ${n}개 모두, 사진 마커와 겹치지 않는 단락에 자연스럽게 배치하세요.
- 각 마커는 한 줄 통째로(앞뒤 빈 줄). 형식 예시:
${examples}`;
  })();

  const histBlock = (p.history && p.history.length) ? `
[참고: 이 채널의 과거 발행 사례 (톤·구성을 참고하되 내용은 새로 작성)]
${p.history.slice(0, 3).map((h, i) => `(${i + 1}) ${String(h).slice(0, 300)}`).join("\n---\n")}` : "";

  const kwBlock = (p.kw && p.kw.trim())
    ? `- 핵심 키워드: ${p.kw}`
    : `- 핵심 키워드: (자동) 지역·서비스·모델·증상을 바탕으로 검색에 유리한 핵심 키워드 4~6개를 스스로 정해 글과 해시태그에 자연스럽게 녹이세요.`;

  // 광고형이면 광고 지침과 광고 입력값을 덧붙인다
  const isAd = p.postType === "ad";
  const adBlock = isAd ? `
${AD_GUIDE}

[이번 광고의 내용]
- 알릴 것: ${p.adOffer || "(미지정 — 아래 '한 일/핵심 메시지'에서 유추)"}
- 고객이 얻는 것: ${p.adBenefit || "(미지정)"}
- 조건: ${p.adCondition || "(없음 — 조건이 없으면 없다고만 하고 지어내지 말 것)"}
- 대상: ${p.adTarget || "(미지정 — 대구·경북 사업장으로 가정)"}
- 원하는 행동: ${p.adCta || "전화 문의"}` : "";

  const lim = CHANNEL_LIMITS[p.channel];
  const limitLine = lim
    ? `\n[길이 — 절대 규칙] 본문(해시태그 제외) ${lim.body}자 이내${lim.lines ? `, ${lim.lines}줄 이내` : ""}. 제목 줄·소제목·Q&A 없이 캡션 하나만. 넘기면 실패다.`
    : "";
  return `${PHILOSOPHY}

${HUMAN_VOICE}

${isBlog ? SEO_GUIDE : SEO_GUIDE_SHORT}
${isBlog ? HOOK_GUIDE + READABILITY : ""}
${agent}
${isShort ? PLAN_GUIDE : isBlog ? PLAN_GUIDE_BLOG : ""}

${typeGuide}
${adBlock}
${imageBlock}
${photoMarkerBlock}
${videoMarkerBlock}
${histBlock}

[이번 글의 입력값]
- 지역: ${p.region || "대구"}
- 서비스 분류: ${p.service || "(미지정)"}
- 모델/장비: ${p.model || "(미지정)"}
- 고객이 겪던 어려움/증상: ${p.pain || "(미지정 — 사무환경 정비의 막막함으로 가정)"}
- 해결 방법: ${p.solution || "(미지정 — 한 일에서 유추)"}
- 한 일/핵심 메시지: ${p.seed || "(미지정)"}
${kwBlock}

위 입력값과 채널 지침에 따라, 바로 발행 가능한 완성된 글 1편을 한국어로 작성하세요. 설명이나 머리말 없이 본문만 출력하세요.${limitLine}${(isShort || isBlog) ? ` 본문 뒤에 "${PLAN_DELIM}" 줄과 기획 메모를 붙이세요.` : ""}`;
}

// ── 모델 라이트사이징(비용 절감) ─────────────────────────────
// 채널별로 필요한 만큼만: 블로그(긴 글·SEO)는 품질 유지, 짧은 채널은 저가 모델.
// 단가는 백만 토큰당 USD. sonnet-5 는 2026-08-31 까지 인트로가($2/$10)라 구 sonnet-4-5($3/$15)보다 쌈.
// 특정 채널 품질이 아쉬우면 그 채널만 CHANNEL_MODEL 에서 sonnet-5 로 올리면 됨.
const MODEL_PRICING: Record<string, { in: number; out: number; noThink: boolean }> = {
  "claude-sonnet-5":  { in: 2, out: 10, noThink: true },  // sonnet-5는 thinking 기본 ON → 콘텐츠 생성엔 꺼서 토큰 절약
  "claude-haiku-4-5": { in: 1, out: 5,  noThink: false },
};
const CHANNEL_MODEL: Record<string, string> = {
  naver:     "claude-sonnet-5",   // 긴 블로그·검색 유입 → 품질 유지
  google:    "claude-sonnet-5",   // 긴 블로그·SEO → 품질 유지
  youtube:   "claude-haiku-4-5",  // 제목·설명·태그
  instagram: "claude-haiku-4-5",  // 짧은 글
  threads:   "claude-haiku-4-5",  // 500자 이내
  facebook:  "claude-haiku-4-5",  // 중간 길이 스토리
};
function modelForChannel(channel?: string): string {
  return (channel && CHANNEL_MODEL[channel]) || "claude-sonnet-5";
}

async function callClaude(prompt: string, model = "claude-sonnet-5") {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다.");
  const cfg = MODEL_PRICING[model] || MODEL_PRICING["claude-sonnet-5"];
  const body: Record<string, unknown> = {
    model,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  };
  if (cfg.noThink) body.thinking = { type: "disabled" };  // 생성 태스크는 사고 토큰 불필요
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Anthropic " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const u = d.usage || {};
  const inTok = u.input_tokens || 0, outTok = u.output_tokens || 0;
  const usd = (inTok / 1e6) * cfg.in + (outTok / 1e6) * cfg.out;
  return {
    text: d.content.map((c: { text: string }) => c.text).join(""),
    usage: { model, input_tokens: inTok, output_tokens: outTok, usd: +usd.toFixed(5) },
  };
}

// ── 생성 후처리 ─────────────────────────────────────────────
// 1) splitPlan: 짧은 채널의 기획 메모를 본문에서 떼어낸다(발행 본문 오염 방지)
// 2) postClean: 대시(—)→하이픈, 챗봇 머리·꼬리 제거 (규칙 기반, 토큰 0)
// 3) humanizePass: im-not-ai 룰북으로 haiku 1콜 재윤문. 내용·숫자·마커 보존, 문체만.
//    인스타·쓰레드는 이 콜에서 길이 제한(CHANNEL_LIMITS)도 같이 맞춘다.

function splitPlan(raw: string): { text: string; plan: string } {
  const i = raw.indexOf(PLAN_DELIM);
  if (i < 0) return { text: raw.trim(), plan: "" };
  return { text: raw.slice(0, i).trim(), plan: raw.slice(i + PLAN_DELIM.length).trim() };
}

function postClean(text: string): string {
  let t = text.replace(/\r/g, "");
  t = t.replace(/[—–]/g, "-");                                   // em/en dash 금지(사이트 규칙과 동일)
  t = t.replace(/^\s*(물론입니다[.!]?|네[,.]? 알겠습니다[.!]?|다음은 .{0,40}입니다[.:]?)\s*\n+/u, "");
  t = t.replace(/\n+\s*(도움이 되셨길 바랍니다[.!]?|추가 질문이 있으시면 .{0,40})\s*$/u, "");
  return t.trim();
}

// 본문(해시태그 제외) 글자 수. 인스타·쓰레드 길이 판정용.
function bodyLength(text: string): { body: number; lines: number } {
  const bodyLines: string[] = [];
  for (const ln of text.split("\n")) {
    const t = ln.trim();
    if (/^(#[^\s#]+\s*)+$/.test(t)) continue;   // 해시태그만 있는 줄
    if (t === "." || t === "") continue;
    bodyLines.push(t);
  }
  return { body: bodyLines.join("").length, lines: bodyLines.length };
}

const HUMANIZE_RULES = `
[윤문 규칙 — humanize-korean v2.3 핵심]
- 쉼표: 한 문장 최대 1개. 연결어미(-고/-며/-지만/-면서/-아서) 뒤 쉼표 제거. 새 쉼표를 만들지 마라.
- 번역투: "~에 대해"→"~을", "~를 통해"→"~로", "~에 있어서"→"~에서", "가지고 있다"→"있다", "되어진다"→"된다", "~에 의해"→행위자 주어.
- "할 수 있다" 4회+ → 일부만 다른 표현으로. 단정으로 바꾸지 마라(서법 보존).
- AI 관용구 삭제·치환: 결론적으로/정리하면/요약하자면/이를 통해/시사하는 바/주목할 만/크게 N가지로/~할 때입니다/~하는 이유다/중요한 것은 ~이다/핵심은 ~다.
- hype 어휘(혁신적·획기적·압도적·다양한·효과적·중요하다·필수적) → 구체 사실로.
- "~것이다/~일 것이다" 연속 3회+ → 일부만 "~다".
- 종결어미 4문장 연속 같으면 변주. 문장 길이 들쭉날쭉하게(단문 1~2 + 장문 1).
- 대시(—) 부연 → 쉼표·괄호·새 문장. 따옴표 강조 제거(진짜 인용만).
- "-성/-적/-화" 명사화 체인 → 동사·형용사로. "~적 N" 3회+ 풀어쓰기.
- 사전 은유(적신호·청사진·신호탄·뿌리내리다·잠식) → 명제로. 새 비유를 만들지 마라.
- 문두 접속사(또한/따라서/즉/나아가) 한 문단 3회+ → 절반 제거.
- 60자 넘는 문장은 둘로 자른다. "입니다/습니다" 3문장 연속 → 가운데 하나를 ~요/명사형/질문으로. 느낌표는 글 전체 1개만 남긴다.
- 추가 hype 어휘(최첨단·차별화·극대화·선도·최적·완벽·놀라운·최고·맞춤형·솔루션·신뢰할 수 있는·지속적인·경쟁력·스마트한·전문성·원스톱·강력한·간편하게·안심·걱정 없이·시대·시너지·노하우·파트너·든든·책임집니다·자랑) → 구체 사실로. 숫자는 새로 만들지 마라.
[절대 보존] 고유명사·모델명·전화번호·숫자·날짜·단위·해시태그·[📷 사진 N — …]·[🎬 영상 N — …] 마커·**굵게**·==형광펜==·"> 인용"·"## 소제목" 서식·Q./A. 구조·줄바꿈 구조. 내용 앵커(주장을 이루는 명사)는 원형 그대로 남긴다. 변경률 30% 이내. 격식체는 격식체로, 구어체는 구어체로.
[금지] 내용 추가·삭제, 문단 순서 변경, 없던 주장 삽입, 설명·머리말 출력.
`;

async function humanizePass(text: string, channel: string): Promise<{ text: string; usage: { usd: number; input_tokens: number; output_tokens: number } } | null> {
  if (!text || text.length < 40) return null;
  const lim = CHANNEL_LIMITS[channel];
  const cur = bodyLength(text);
  const overNow = !!lim && (cur.body > lim.body || (!!lim.lines && cur.lines > lim.lines));
  const lengthRule = lim
    ? `\n[길이] 이 채널은 본문(해시태그 제외) ${lim.body}자 이내${lim.lines ? `, ${lim.lines}줄 이내` : ""}다. 지금 ${cur.body}자·${cur.lines}줄. ${overNow ? "넘쳤다. 문장을 지워서 맞춰라(뜻이 겹치는 문장·수식어부터). 첫 줄 훅과 전화번호 줄은 남긴다." : "범위 안이다. 늘리지 마라."}${lim.tags ? ` 해시태그는 ${lim.tags}. 넘치면 뒤에서부터 지운다.` : ""}`
    : "";
  const prompt = `당신은 한국어 윤문가다. 아래 글에서 AI가 쓴 흔적만 지운다. 사실·내용·구조는 그대로, 문체만 사람 손으로 쓴 것처럼.
${HUMANIZE_RULES}${lengthRule}

윤문한 글 전체만 출력한다. 설명·머리말·요약 금지.

<원문>
${text}
</원문>`;
  try {
    const r = await callClaude(prompt, "claude-haiku-4-5");
    let out = r.text.trim();
    out = out.replace(/^<윤문>\s*/, "").replace(/\s*<\/윤문>$/, "").replace(/^<원문>\s*/, "").replace(/\s*<\/원문>$/, "");
    // 안전장치: 마커 개수·전화번호가 사라졌거나 반 토막이 났으면 원문 유지
    const cnt = (t: string, re: RegExp) => (t.match(re) || []).length;
    const lostMarker = cnt(out, /\[📷/g) !== cnt(text, /\[📷/g) || cnt(out, /\[🎬/g) !== cnt(text, /\[🎬/g);
    const lostTel = text.includes(COMPANY.tel) && !out.includes(COMPANY.tel);
    const tooShort = out.length < text.length * (overNow ? 0.25 : 0.5);
    if (!out || lostMarker || lostTel || tooShort) return { text, usage: r.usage };
    return { text: out, usage: r.usage };
  } catch (_e) {
    return null;  // 2차 패스 실패는 원문으로 조용히 진행(생성 자체를 막지 않는다)
  }
}

// 한도 초과 캡션 압축(haiku 1콜). 2차 다듬기로도 못 줄였을 때만 돈다.
async function condensePass(text: string, channel: string): Promise<{ text: string; usage: { usd: number; input_tokens: number; output_tokens: number } } | null> {
  const lim = CHANNEL_LIMITS[channel];
  if (!lim) return null;
  const cur = bodyLength(text);
  const prompt = `아래 글은 ${channel === "instagram" ? "인스타그램 캡션" : "쓰레드 글"}인데 너무 길다(본문 ${cur.body}자·${cur.lines}줄). 본문(해시태그 제외) ${lim.body}자 이내${lim.lines ? `, ${lim.lines}줄 이내` : ""}로 압축하라.
- 제목 줄·소제목·Q&A·마크다운(#, ##, **, ==, ---)·구분선은 전부 지운다. 캡션은 줄글이다.
- 첫 줄 훅, 전화번호 ${COMPANY.tel} 줄, 해시태그 줄(${lim.tags || "그대로"})은 남긴다. 해시태그가 15개를 넘으면 뒤에서부터 지운다.
- 사실·모델명·숫자·지역은 보존. 새 내용을 넣지 마라. [📷 사진 N] 마커가 있으면 첫 번째 하나만 남긴다.
- 사람이 쓴 말투 그대로. 쉼표 최소. "결론적으로/정리하면" 금지.
압축한 캡션만 출력한다. 설명 금지.

<원문>
${text}
</원문>`;
  try {
    const r = await callClaude(prompt, "claude-haiku-4-5");
    const out = r.text.trim().replace(/^<[^>]+>\s*/, "").replace(/\s*<\/[^>]+>$/, "");
    if (!out || out.length < 30) return { text, usage: r.usage };
    return { text: out, usage: r.usage };
  } catch (_e) {
    return null;
  }
}

// ── Q&A 3개 보장 (블로그·페이스북) ──
const FAQ_CHANNELS = new Set(["naver", "google", "facebook"]);
function countFaq(text: string): number {
  return (text.match(/^\s*(\*\*)?Q[.:]/gm) || []).length;
}
// Q&A 블록을 연락처 줄(전화번호) 앞에 끼운다. 전화 줄이 없으면 해시태그 블록 앞, 그것도 없으면 맨 끝.
function insertFaq(text: string, faq: string, channel = "google"): string {
  const lines = text.split("\n");
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(COMPANY.tel)) { at = i; break; }
  }
  if (at < 0) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const t = lines[i].trim();
      if (!t || /^(#[^\s#]+\s*)+$/.test(t) || /^Keywords?\s*:/i.test(t)) continue;
      at = i + 1; break;
    }
  }
  if (at < 0) at = lines.length;
  // 구글만 ## 소제목(HTML 로 바뀜). 네이버·페북은 복사해 붙이는 평문이라 기호 없이.
  const block = ["", channel === "google" ? "## 자주 묻는 질문" : "자주 묻는 질문", "", faq.trim(), ""];
  return [...lines.slice(0, at), ...block, ...lines.slice(at)].join("\n").replace(/\n{3,}/g, "\n\n");
}
async function ensureFaq(text: string, channel: string): Promise<{ text: string; usage: { usd: number; input_tokens: number; output_tokens: number } } | null> {
  if (!FAQ_CHANNELS.has(channel)) return null;
  const have = countFaq(text);
  if (have >= 3) return null;
  const need = 3 - have;
  const prompt = `아래 글을 읽고, 이 글을 본 고객이 실제로 궁금해할 질문 ${need}개와 답을 만들어라. 글에 이미 있는 Q&A 와 겹치지 않게.
- 후보: 비용(부가세 포함 여부)·걸리는 기간·기존 장비와 호환·고장 나면 어떻게 되나·꼭 이 업체에 맡겨야 하나·용량/대수 기준. 홍보성 질문 금지.
- 형식은 정확히 이렇게, 다른 말 없이:
Q. 질문
A. 답(두 문장 이내)
- 글에 없는 사실·숫자를 지어내지 마라. 모르면 "현장 확인 뒤 정확히 안내" 로.
- 사람 말투. 쉼표 최소. "결론적으로/정리하면" 금지. 대시(—) 금지.
회사: ${COMPANY.name}(대구, ${COMPANY.tel})

<글>
${text.slice(0, 6000)}
</글>`;
  try {
    const r = await callClaude(prompt, "claude-haiku-4-5");
    const faq = r.text.trim().replace(/[—–]/g, "-");
    if (countFaq(faq) < need) return { text, usage: r.usage };   // 형식이 어긋나면 넣지 않는다
    return { text: insertFaq(text, faq, channel), usage: r.usage };
  } catch (_e) {
    return null;
  }
}

// 생성 결과 마무리: 기획 메모 분리 → 규칙 정리 → (옵션) 2차 다듬기 → Q&A 3개 보장 → 한도 초과면 압축. usage 는 합산.
async function finishText(raw: string, channel: string, humanize = true) {
  const { text: t0, plan: plan0 } = splitPlan(raw);
  let text = postClean(t0);
  const plan = plan0.replace(/[—–]/g, "-");
  const extra = { usd: 0, input_tokens: 0, output_tokens: 0 };
  const add = (u: { usd: number; input_tokens: number; output_tokens: number }) => { extra.usd += u.usd; extra.input_tokens += u.input_tokens; extra.output_tokens += u.output_tokens; };
  if (humanize) {
    const h = await humanizePass(text, channel);
    if (h) { text = postClean(h.text); add(h.usage); }
  }
  const f = await ensureFaq(text, channel);
  if (f) { text = f.text; add(f.usage); }
  const lim = CHANNEL_LIMITS[channel];
  if (lim && bodyLength(text).body > lim.body) {
    const c = await condensePass(text, channel);
    if (c) { text = postClean(c.text); add(c.usage); }
  }
  const len = bodyLength(text);
  const over = lim ? len.body > lim.body : false;
  return { text, plan, extra: { usd: +extra.usd.toFixed(5), input_tokens: extra.input_tokens, output_tokens: extra.output_tokens }, len, over, faq: countFaq(text) };
}

type Usage = { model: string; input_tokens: number; output_tokens: number; usd: number };
function mergeUsage(u: Usage, extra: { usd: number; input_tokens: number; output_tokens: number }) {
  return { ...u, input_tokens: u.input_tokens + extra.input_tokens, output_tokens: u.output_tokens + extra.output_tokens, usd: +(u.usd + extra.usd).toFixed(5), humanized: extra.usd > 0 };
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
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 800, thinking: { type: "disabled" }, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error("Vision " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const u = d.usage || {};
  const usd = ((u.input_tokens || 0) / 1e6) * 2 + ((u.output_tokens || 0) / 1e6) * 10;
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

// ── 글 스타일 프리셋 (폰트·색상) ─────────────────────────────
// 구글 블로그 발행 HTML 에 적용. 콘솔에서 고르거나 'random' 이면 글마다 다른 프리셋.
// 폰트는 Google Fonts @import + 기기 기본 한글 폰트 폴백(블로거가 style 을 지워도 읽힌다).
interface StylePreset { id: string; name: string; family: string; gf: string; heading: string; accent: string; hl: string; quoteBg: string; }
const STYLE_PRESETS: StylePreset[] = [
  { id: "gothic-blue",   name: "깔끔 고딕 · 파랑",   family: "'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif",        gf: "Noto+Sans+KR:wght@400;700",   heading: "#1a4fa3", accent: "#d9480f", hl: "#fff3bf", quoteBg: "#eef3fb" },
  { id: "myeongjo-warm", name: "따뜻한 명조 · 갈색", family: "'Nanum Myeongjo','Batang',serif",                                         gf: "Nanum+Myeongjo:wght@400;700",  heading: "#6b3e26", accent: "#b7791f", hl: "#fdebd0", quoteBg: "#f8f1e7" },
  { id: "gowun-green",   name: "고운돋움 · 초록",     family: "'Gowun Dodum','Malgun Gothic','Apple SD Gothic Neo',sans-serif",         gf: "Gowun+Dodum",                  heading: "#2f6f4f", accent: "#c2410c", hl: "#e6f4ea", quoteBg: "#eef7f1" },
  { id: "plex-teal",     name: "IBM Plex · 청록",     family: "'IBM Plex Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif",    gf: "IBM+Plex+Sans+KR:wght@400;600", heading: "#0f766e", accent: "#be123c", hl: "#ccfbf1", quoteBg: "#f0fdfa" },
  { id: "batang-navy",   name: "고운바탕 · 남색",     family: "'Gowun Batang','Batang',serif",                                          gf: "Gowun+Batang:wght@400;700",    heading: "#3b3b6b", accent: "#9f1239", hl: "#fde2e4", quoteBg: "#f2f2f8" },
  { id: "a1-black",      name: "고딕A1 · 검정",       family: "'Gothic A1','Malgun Gothic','Apple SD Gothic Neo',sans-serif",           gf: "Gothic+A1:wght@400;700",       heading: "#111827", accent: "#2563eb", hl: "#dbeafe", quoteBg: "#f3f4f6" },
  { id: "nanum-orange",  name: "나눔고딕 · 주황",     family: "'Nanum Gothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif",        gf: "Nanum+Gothic:wght@400;700",    heading: "#c2410c", accent: "#1d4ed8", hl: "#ffedd5", quoteBg: "#fff7ed" },
  { id: "serif-plum",    name: "노토명조 · 자주",     family: "'Noto Serif KR','Batang',serif",                                         gf: "Noto+Serif+KR:wght@400;700",   heading: "#701a75", accent: "#0e7490", hl: "#fae8ff", quoteBg: "#fdf4ff" },
];
function pickStyle(sel?: { preset?: string } | string): StylePreset {
  const id = typeof sel === "string" ? sel : sel?.preset;
  const found = id && id !== "random" ? STYLE_PRESETS.find((x) => x.id === id) : undefined;
  return found || STYLE_PRESETS[Math.floor(Math.random() * STYLE_PRESETS.length)];
}

// 인라인 마커 → HTML. escHtml 이 끝난 문자열에 적용한다.
function inlineMd(escaped: string, st: StylePreset): string {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${st.accent}">$1</strong>`)
    .replace(/==(.+?)==/g, `<mark style="background:${st.hl};color:inherit;padding:0 4px;border-radius:3px">$1</mark>`);
}

// 평문 본문 → Blogger용 HTML. 스타일 프리셋(폰트·색상) + 마크다운 비슷한 마커(##, ###, >, -, **, ==) 변환.
// images 가 있으면 [📷 사진 N — ...] 마커 자리에 순서대로 <img> 삽입.
// 마커보다 사진이 많으면 본문 끝에 추가. 마커가 많으면 남은 자리는 placeholder 박스 유지.
function textToBloggerHtml(
  text: string,
  images: { media_type?: string; data?: string; url?: string }[] = [],
  videos: { url: string; caption?: string }[] = [],
  style?: StylePreset,
): string {
  const st = style || STYLE_PRESETS[0];
  // 사진은 Storage URL(im.url) 우선, 없으면 base64(im.data)
  const srcOf = (im: { media_type?: string; data?: string; url?: string }) =>
    im.url ? im.url : `data:${im.media_type || "image/jpeg"};base64,${im.data}`;
  // ── 사진: [📷 사진 N] 마커 자리에 순서대로, 남으면 끝에 전부 추가 ──
  let imgIdx = 0;
  let replaced = text.replace(/\[📷[^\]]*\]/g, (m) => {
    const caption = m.replace(/[\[\]]/g, "").trim();
    if (imgIdx < images.length) {
      const im = images[imgIdx++];
      return `\n<!--IMG-->${srcOf(im)}||${caption.replace(/\|/g, "│")}<!--/IMG-->\n`;
    }
    return `\n<!--PHOTO-->${caption}<!--/PHOTO-->\n`;
  });
  if (imgIdx < images.length) {
    replaced += images.slice(imgIdx).map((im) =>
      `\n\n<!--IMG-->${srcOf(im)}||${COMPANY.name} 현장 사진<!--/IMG-->\n`
    ).join("");
  }
  // ── 영상: [🎬 영상 N] 마커 자리에 순서대로, 남으면 끝에 전부 추가 ──
  let vidIdx = 0;
  replaced = replaced.replace(/\[🎬[^\]]*\]/g, (m) => {
    const caption = m.replace(/[\[\]]/g, "").trim();
    if (vidIdx < videos.length) {
      const v = videos[vidIdx++];
      return `\n<!--VID-->${v.url}||${caption.replace(/\|/g, "│")}<!--/VID-->\n`;
    }
    return `\n<!--VIDPH-->${caption}<!--/VIDPH-->\n`;
  });
  if (vidIdx < videos.length) {
    replaced += videos.slice(vidIdx).map((v) =>
      `\n\n<!--VID-->${v.url}||현장 영상<!--/VID-->\n`
    ).join("");
  }
  const paragraphs = replaced.split(/\n{2,}/);
  return paragraphs.map((para) => {
    const trimmed = para.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<!--IMG-->")) {
      const inner = trimmed.replace(/<!--\/?IMG-->/g, "").trim();
      const sep = inner.indexOf("||");
      const src = sep >= 0 ? inner.slice(0, sep) : inner;
      const caption = sep >= 0 ? inner.slice(sep + 2) : "";
      // alt/title = 캡션(사진 마커의 설명). AI·검색이 사진을 찾는 건 픽셀이 아니라 이 글자다.
      const alt = escHtml((caption || "현장 사진").replace(/^📷\s*사진\s*\d+\s*[-—–:]?\s*/, "").trim() || "현장 사진");
      return `<figure style="margin:14px 0;text-align:center"><img src="${src}" alt="${alt}" title="${alt}" loading="lazy" style="max-width:100%;height:auto;border-radius:8px"/>${caption ? `<figcaption style="font-size:12px;color:#888;margin-top:6px">${escHtml(caption)}</figcaption>` : ""}</figure>`;
    }
    if (trimmed.startsWith("<!--VID-->")) {
      const inner = trimmed.replace(/<!--\/?VID-->/g, "").trim();
      const sep = inner.indexOf("||");
      const src = sep >= 0 ? inner.slice(0, sep) : inner;
      const caption = sep >= 0 ? inner.slice(sep + 2) : "";
      return `<div style="margin:14px 0;text-align:center"><video controls preload="metadata" src="${src}" style="max-width:100%;border-radius:8px"></video>${caption ? `<div style="font-size:12px;color:#888;margin-top:6px">${escHtml(caption)}</div>` : ""}</div>`;
    }
    if (trimmed.startsWith("<!--PHOTO-->")) {
      const caption = trimmed.replace(/<!--\/?PHOTO-->/g, "").trim();
      return `<div style="border:2px dashed #ccc;border-radius:10px;padding:24px 12px;text-align:center;color:#aaa;margin:14px 0;font-size:13px">📷 ${escHtml(caption)}</div>`;
    }
    if (trimmed.startsWith("<!--VIDPH-->")) {
      const caption = trimmed.replace(/<!--\/?VIDPH-->/g, "").trim();
      return `<div style="border:2px dashed #ccc;border-radius:10px;padding:24px 12px;text-align:center;color:#aaa;margin:14px 0;font-size:13px">🎬 ${escHtml(caption)}</div>`;
    }
    // ── 서식 마커 ──
    if (/^##\s+/.test(trimmed)) {
      const lvl = /^###\s+/.test(trimmed) ? 3 : 2;
      const t = inlineMd(escHtml(trimmed.replace(/^#{2,3}\s+/, "")), st);
      return lvl === 2
        ? `<h2 style="font-size:1.3em;font-weight:700;color:${st.heading};margin:30px 0 12px;padding-left:12px;border-left:4px solid ${st.accent};line-height:1.4">${t}</h2>`
        : `<h3 style="font-size:1.12em;font-weight:700;color:${st.heading};margin:22px 0 8px;line-height:1.4">${t}</h3>`;
    }
    if (/^&gt;\s|^>\s/.test(trimmed) || trimmed.split("\n").every((l) => /^>\s?/.test(l.trim()))) {
      const inner = trimmed.split("\n").map((l) => l.trim().replace(/^>\s?/, "")).join("<br/>");
      return `<blockquote style="margin:16px 0;padding:12px 16px;background:${st.quoteBg};border-left:4px solid ${st.accent};border-radius:6px;color:#333">${inlineMd(escHtml(inner.replace(/<br\/>/g, "\u0001")), st).replace(/\u0001/g, "<br/>")}</blockquote>`;
    }
    const lines = trimmed.split("\n").map((l) => l.trim());
    if (lines.length >= 2 && lines.every((l) => /^[-•]\s+/.test(l))) {
      return `<ul style="margin:10px 0 16px;padding-left:22px">${lines.map((l) => `<li style="margin:4px 0">${inlineMd(escHtml(l.replace(/^[-•]\s+/, "")), st)}</li>`).join("")}</ul>`;
    }
    if (lines.length >= 2 && lines.every((l) => /^\d+[.)]\s+/.test(l))) {
      return `<ol style="margin:10px 0 16px;padding-left:22px">${lines.map((l) => `<li style="margin:4px 0">${inlineMd(escHtml(l.replace(/^\d+[.)]\s+/, "")), st)}</li>`).join("")}</ol>`;
    }
    if (/^(#[^\s#]+\s*)+$/.test(trimmed.replace(/\n/g, " "))) {
      return `<p style="margin:18px 0 0;font-size:0.9em;color:${st.accent}">${escHtml(trimmed.replace(/\n/g, " "))}</p>`;
    }
    if (/^Keywords?\s*:/i.test(trimmed)) {
      return `<p style="margin:14px 0 0;font-size:0.85em;color:#888">${escHtml(trimmed)}</p>`;
    }
    const body = lines.map((l) => {
      const m = l.match(/^([QA])[.:]\s*(.*)$/);   // FAQ 의 Q./A. 줄
      if (m) return `<strong style="color:${m[1] === "Q" ? st.heading : st.accent}">${m[1]}.</strong> ${inlineMd(escHtml(m[2]), st)}`;
      return inlineMd(escHtml(l), st);
    }).join("<br/>");
    return `<p style="margin:0 0 14px;line-height:1.85">${body}</p>`;
  }).filter(Boolean).join("\n");
}

// 프리셋 래퍼: 폰트 @import + 본문 div. 블로거가 <style> 을 지워도 family 폴백으로 읽힌다.
function wrapStyled(inner: string, st: StylePreset): string {
  return `<style>@import url('https://fonts.googleapis.com/css2?family=${st.gf}&display=swap');</style>\n<div data-hb-style="${st.id}" style="font-family:${st.family};font-size:16px;line-height:1.85;color:#222;word-break:keep-all">\n${inner}\n</div>`;
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
  videos?: { url: string; caption?: string }[];
  style?: { preset?: string } | string;
}) {
  const blogId = p.blogId || GOOGLE_BLOG_ID;
  if (!blogId) throw new Error("blogId 또는 GOOGLE_BLOG_ID 시크릿이 필요합니다.");
  const accessToken = await googleAccessToken();

  const st = pickStyle(p.style);
  const isHtml = /<\w+[^>]*>/.test(p.content);
  const html = isHtml ? p.content : wrapStyled(textToBloggerHtml(p.content, p.images || [], p.videos || [], st), st);

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
  return { id: d.id as string, url: d.url as string, published: d.published as string, style: isHtml ? undefined : st.name };
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
  video_count?: number;
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
      videoCount: p.video_count,
    }), modelForChannel(ch));
    const fin = await finishText(res.text, ch, (p as { humanize?: boolean }).humanize !== false);
    const usage = mergeUsage(res.usage, fin.extra);
    out[ch] = { text: fin.text, plan: fin.plan, usage };
    totalUsd += usage.usd;
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

// ── Batch API (−50%): 소재 → 요청 채널 한 번에 배치 제출 → 나중에 수집 ──
// 인터랙티브 /generate 는 그대로 두고, "나중에 받아도 되는" 저렴 경로만 추가.
async function submitBatch(requests: { custom_id: string; params: Record<string, unknown> }[]) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY 시크릿이 필요합니다.");
  const r = await fetch("https://api.anthropic.com/v1/messages/batches", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ requests }),
  });
  if (!r.ok) throw new Error("Batch create " + r.status + ": " + (await r.text()).slice(0, 300));
  return await r.json() as { id: string; processing_status?: string };
}

// 소재 1건 → 요청 채널들 배치 제출 → generating 으로 적재.
// batch id 는 channels._pending_batch 에 임시 보관(스키마 변경 불필요). 수집 시 실제 채널 내용으로 덮어씀.
async function queueGenerateBatch(p: QueueGenInput & { images?: { url: string; caption?: string }[]; videos?: { url: string; caption?: string }[] }) {
  const channels = (p.channels && p.channels.length ? p.channels : Object.keys(CHANNEL_AGENTS))
    .filter((c) => CHANNEL_AGENTS[c]);
  if (!channels.length) throw new Error("유효한 채널이 없습니다.");

  const requests = channels.map((ch) => {
    const model = modelForChannel(ch);
    const cfg = MODEL_PRICING[model] || MODEL_PRICING["claude-sonnet-5"];
    const params: Record<string, unknown> = {
      model,
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: buildPrompt({
          channel: ch, seed: p.raw_context, kw: p.kw, region: p.region,
          model: p.model, service: p.service, pain: p.pain, solution: p.solution,
          postType: p.post_type, imageDesc: p.image_desc,
          imageCount: p.image_count, videoCount: p.video_count,
        }),
      }],
    };
    if (cfg.noThink) params.thinking = { type: "disabled" };
    return { custom_id: ch, params };
  });

  const batch = await submitBatch(requests);

  const row = {
    topic: p.topic,
    raw_context: p.raw_context || "",
    region: p.region || null,
    post_type: p.post_type || null,
    image_desc: p.image_desc || null,
    image_count: p.image_count || 0,
    channels: { _pending_batch: batch.id },
    images: p.images || [],
    videos: p.videos || [],
    status: "generating",
    total_usd: 0,
  };
  const inserted = await sbRest("POST", "autopost_post_queue", row, { Prefer: "return=representation" });
  return Array.isArray(inserted) ? inserted[0] : inserted;
}

// generating 대기열 훑어 끝난 배치 결과 조립 → pending 승격. 콘솔이 대기열 열 때마다 호출(=폴링).
async function collectBatches() {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY 시크릿이 필요합니다.");
  const rows = (await sbRest("GET", "autopost_post_queue?status=eq.generating&order=created_at.asc")) || [];
  let collected = 0, running = 0;
  for (const row of rows) {
    try {
      const batchId = row?.channels?._pending_batch;
      if (!batchId) continue;
      const sr = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
        headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      });
      if (!sr.ok) { running++; continue; }
      const b = await sr.json();
      if (b.processing_status !== "ended" || !b.results_url) { running++; continue; }
      const rr = await fetch(b.results_url, {
        headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      });
      if (!rr.ok) { running++; continue; }
      const jsonl = await rr.text();
      const out: Record<string, unknown> = {};
      let totalUsd = 0;
      const finishJobs: Promise<void>[] = [];   // 2차 다듬기(haiku)는 채널별 병렬
      for (const line of jsonl.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let rec: { custom_id?: string; result?: { type?: string; message?: { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string } } };
        try { rec = JSON.parse(t); } catch { continue; }
        const ch = rec.custom_id;
        const res = rec.result;
        if (!ch) continue;
        if (res?.type === "succeeded" && res.message) {
          const msg = res.message;
          const text = (msg.content || []).map((c) => c.text || "").join("");
          const u = msg.usage || {};
          const priceModel = modelForChannel(ch);  // 단가는 요청한 별칭 기준(응답 model 은 날짜 붙은 풀 ID라 맵에 없음)
          const cfg = MODEL_PRICING[priceModel] || MODEL_PRICING["claude-sonnet-5"];
          const model = msg.model || priceModel;    // 표시는 실제 응답 모델
          const usd = ((u.input_tokens || 0) / 1e6 * cfg.in + (u.output_tokens || 0) / 1e6 * cfg.out) * 0.5; // 배치 −50%
          const baseUsage: Usage = { model, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, usd: +usd.toFixed(5) };
          out[ch] = { text, usage: baseUsage };
          totalUsd += usd;
          finishJobs.push((async () => {
            const fin = await finishText(text, ch, true);
            out[ch] = { text: fin.text, plan: fin.plan, usage: mergeUsage(baseUsage, fin.extra) };
            totalUsd += fin.extra.usd;
          })());
        } else {
          out[ch] = { text: "", usage: { model: modelForChannel(ch), input_tokens: 0, output_tokens: 0, usd: 0 }, error: String(res?.type || "failed") };
        }
      }
      await Promise.all(finishJobs);
      await sbRest("PATCH", `autopost_post_queue?id=eq.${row.id}`, {
        channels: out,
        status: "pending",
        total_usd: +totalUsd.toFixed(5),
      });
      collected++;
    } catch (_e) {
      running++;
    }
  }
  return { collected, running, checked: rows.length };
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
// ── 사진 메타데이터(XMP) — 사람 눈엔 안 보이고 AI·검색은 읽는 통로 ──
// 화면에 흐리게 찍은 글씨는 AI 도 같은 픽셀을 보므로 사람이 못 보면 AI 도 못 읽는다.
// 대신 JPEG 안에 XMP(dc:title/description/subject/creator, photoshop:City·Credit)를 넣는다.
// 구글 이미지·AI 도구가 읽는 표준 필드. Storage 는 바이트를 그대로 보관하므로 유지된다.
// (인스타는 업로드 때 메타데이터를 지운다 — 인스타는 캡션·해시태그가 통로.)
interface ImageMeta { title?: string; description?: string; keywords?: string[]; creator?: string; city?: string }
function xmlEsc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildXmp(m: ImageMeta): string {
  const alt = (v: string) => `<rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(v)}</rdf:li></rdf:Alt>`;
  const kws = (m.keywords || []).map((k) => k.trim()).filter(Boolean);
  const creator = m.creator || COMPANY.name;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
${m.title ? `<dc:title>${alt(m.title)}</dc:title>` : ""}
${m.description ? `<dc:description>${alt(m.description)}</dc:description>` : ""}
${kws.length ? `<dc:subject><rdf:Bag>${kws.map((k) => `<rdf:li>${xmlEsc(k)}</rdf:li>`).join("")}</rdf:Bag></dc:subject>` : ""}
<dc:creator><rdf:Seq><rdf:li>${xmlEsc(creator)}</rdf:li></rdf:Seq></dc:creator>
<dc:rights>${alt("© " + creator)}</dc:rights>
<photoshop:Credit>${xmlEsc(creator)}</photoshop:Credit>
<photoshop:City>${xmlEsc(m.city || "대구")}</photoshop:City>
<photoshop:Country>대한민국</photoshop:Country>
<xmp:CreatorTool>${xmlEsc(creator)} 광고자동화</xmp:CreatorTool>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
}
// JPEG 바이트에 XMP APP1 세그먼트를 끼운다. JFIF(APP0) 가 있으면 그 뒤, 없으면 SOI 바로 뒤. JPEG 가 아니면 그대로.
function withXmp(bytes: Uint8Array, meta: ImageMeta): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return bytes;
  const payload = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0" + buildXmp(meta));
  if (payload.length + 2 > 65533) return bytes;
  const len = payload.length + 2;
  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = (len >> 8) & 0xFF; seg[3] = len & 0xFF; seg.set(payload, 4);
  let pos = 2;
  if (bytes[2] === 0xFF && bytes[3] === 0xE0) pos = 4 + ((bytes[4] << 8) | bytes[5]);
  const out = new Uint8Array(bytes.length + seg.length);
  out.set(bytes.subarray(0, pos), 0); out.set(seg, pos); out.set(bytes.subarray(pos), pos + seg.length);
  return out;
}

async function uploadMedia(images: { data: string; media_type?: string; name?: string; meta?: ImageMeta }[]) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Storage 환경변수(SUPABASE_URL/SERVICE_ROLE)가 없습니다.");
  const out: { url: string }[] = [];
  for (const img of images.slice(0, 60)) {   // 사실상 무제한(콘솔이 4장씩 나눠 호출)
    const mt = img.media_type || "image/jpeg";
    const ext = mt.includes("png") ? "png" : mt.includes("webp") ? "webp" : "jpg";
    // 파일명에 키워드(ASCII 만): 검색·AI 가 URL 도 읽는다. 콘솔이 모델명 등으로 만들어 보낸다.
    const slug = (img.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const path = `posts/${slug ? slug + "-" : ""}${crypto.randomUUID().slice(0, 8)}.${ext}`;
    let bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
    if (img.meta && ext === "jpg") bytes = withXmp(bytes, img.meta);   // 사람 눈엔 안 보이는 사진 설명
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

// 영상은 용량이 커서 base64 불가 → 브라우저가 직접 올릴 서명 업로드 URL 발급.
async function signUpload(files: { ext?: string }[]) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Storage 환경변수가 없습니다.");
  const out: { uploadUrl: string; publicUrl: string }[] = [];
  for (const f of files.slice(0, 10)) {
    const ext = (f.ext || "mp4").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "mp4";
    const path = `videos/${crypto.randomUUID()}.${ext}`;
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/autopost-media/${path}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, authorization: "Bearer " + SERVICE_KEY, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!r.ok) throw new Error("Storage sign " + r.status + ": " + (await r.text()).slice(0, 200));
    const d = await r.json();            // { url: "/object/upload/sign/autopost-media/<path>?token=..." }
    const rel = d.url || d.signedUrl || "";
    const uploadUrl = rel.startsWith("http") ? rel : `${SUPABASE_URL}/storage/v1${rel.startsWith("/") ? rel : "/" + rel}`;
    out.push({ uploadUrl, publicUrl: `${SUPABASE_URL}/storage/v1/object/public/autopost-media/${path}` });
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
  videos?: { url: string; caption?: string }[];
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
    videos: p.videos || [],
    status: "pending",
    total_usd: p.total_usd || 0,
    scheduled_at: p.scheduled_at || null,
  };
  const inserted = await sbRest("POST", "autopost_post_queue", row, { Prefer: "return=representation" });
  return Array.isArray(inserted) ? inserted[0] : inserted;
}

// ──────────────────────────────────────────────
// Meta(Instagram·Facebook) & Threads 발행
// 토큰/ID 는 Supabase Secret. 미디어는 공개 Storage URL 사용(Meta 요구).
// ──────────────────────────────────────────────
let META_PAGE_ID    = Deno.env.get("META_PAGE_ID") || "";
let META_PAGE_TOKEN = Deno.env.get("META_PAGE_TOKEN") || "";
let META_IG_USER_ID = Deno.env.get("META_IG_USER_ID") || "";
let THREADS_USER_ID = Deno.env.get("THREADS_USER_ID") || "";
let THREADS_TOKEN   = Deno.env.get("THREADS_TOKEN") || "";
// Edge Function Secrets 를 못 쓰는 환경 대비: autopost_config 테이블(service_role 전용)에서 보충 로드.
// env 값이 있으면 env 우선. 실패해도 기존 동작 유지.
let metaCfgLoaded = false;
async function loadMetaConfig() {
  if (metaCfgLoaded) return;
  try {
    const rows = (await sbRest("GET", "autopost_config?select=key,value")) || [];
    const m: Record<string, string> = {};
    for (const r of rows as Array<{ key: string; value: string }>) m[r.key] = r.value;
    META_PAGE_ID    = META_PAGE_ID    || m.META_PAGE_ID    || "";
    META_PAGE_TOKEN = META_PAGE_TOKEN || m.META_PAGE_TOKEN || "";
    META_IG_USER_ID = META_IG_USER_ID || m.META_IG_USER_ID || "";
    THREADS_USER_ID = THREADS_USER_ID || m.THREADS_USER_ID || "";
    THREADS_TOKEN   = THREADS_TOKEN   || m.THREADS_TOKEN   || "";
    metaCfgLoaded = true;
  } catch (_e) { /* 다음 요청에서 재시도 */ }
}
// Meta 개발자앱 없이 인스타 발행하는 우회로(Make 웹훅). 직접 토큰이 있으면 그쪽이 우선.
const MAKE_IG_WEBHOOK = Deno.env.get("MAKE_IG_WEBHOOK") || "";
const GRAPH = "https://graph.facebook.com/v21.0";
const THREADS_API = "https://graph.threads.net/v1.0";

async function gpost(url: string, params: Record<string, string>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error("Graph " + r.status + ": " + JSON.stringify(d.error || d).slice(0, 300));
  return d;
}
async function gget(url: string) {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error("Graph " + r.status + ": " + JSON.stringify(d.error || d).slice(0, 300));
  return d;
}
// 영상/릴스/캐러셀 컨테이너 처리 완료 대기.
// ⚠ Instagram(Graph API)은 status_code 필드(FINISHED/IN_PROGRESS/ERROR/EXPIRED)를 쓰지만,
//   Threads(graph.threads.net)는 status_code 필드 자체가 없고 status 필드에 같은 값이 직접 들어온다.
//   같은 fields= 요청을 양쪽에 쓰면 Threads 쪽에서 "Tried accessing nonexisting field (status_code)" 400 이 난다.
async function waitContainer(api: string, id: string, token: string) {
  const isThreads = api === THREADS_API;
  const statusField = isThreads ? "status" : "status_code";
  for (let i = 0; i < 40; i++) {
    const d = await gget(`${api}/${id}?fields=${statusField}&access_token=${encodeURIComponent(token)}`);
    const code = d[statusField];
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") throw new Error("미디어 처리 실패: " + code);
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("미디어 처리 시간 초과(영상이 너무 길거나 큼)");
}

async function publishFacebook(p: { message: string; imageUrls?: string[]; videoUrls?: string[] }) {
  if (!META_PAGE_ID || !META_PAGE_TOKEN) throw new Error("META_PAGE_ID / META_PAGE_TOKEN 시크릿이 필요합니다.");
  const imgs = p.imageUrls || [], vids = p.videoUrls || [];
  let postId = "";
  if (imgs.length) {
    const attached: { media_fbid: string }[] = [];
    for (const url of imgs) {
      const d = await gpost(`${GRAPH}/${META_PAGE_ID}/photos`, { url, published: "false", access_token: META_PAGE_TOKEN });
      attached.push({ media_fbid: d.id });
    }
    const d = await gpost(`${GRAPH}/${META_PAGE_ID}/feed`, { message: p.message, attached_media: JSON.stringify(attached), access_token: META_PAGE_TOKEN });
    postId = d.id;
  } else if (!vids.length) {
    const d = await gpost(`${GRAPH}/${META_PAGE_ID}/feed`, { message: p.message, access_token: META_PAGE_TOKEN });
    postId = d.id;
  }
  for (const file_url of vids) {
    const d = await gpost(`${GRAPH}/${META_PAGE_ID}/videos`, { file_url, description: p.message, access_token: META_PAGE_TOKEN });
    if (!postId) postId = d.id;
  }
  return { id: postId, url: `https://www.facebook.com/${postId || META_PAGE_ID}` };
}

async function publishInstagramViaMake(p: { caption: string; imageUrls?: string[] }) {
  const img = (p.imageUrls || [])[0];
  if (!img) throw new Error("Make 경유 인스타 발행은 사진 1장 이상이 필요합니다(영상은 직접연동 필요).");
  const r = await fetch(MAKE_IG_WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_url: img, caption: p.caption || "" }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Make 인스타 발행 실패 ${r.status}: ${txt.slice(0, 300)}`);
  let id = "";
  try { id = (JSON.parse(txt).post_id) || ""; } catch { /* Accepted 등 텍스트 응답 */ }
  return { id, url: "https://www.instagram.com/", via: "make" };
}

async function publishInstagram(p: { caption: string; imageUrls?: string[]; videoUrls?: string[] }) {
  // 직접 연동(토큰) 없으면 Make 웹훅 우회로 사용
  if ((!META_IG_USER_ID || !META_PAGE_TOKEN) && MAKE_IG_WEBHOOK) return await publishInstagramViaMake(p);
  if (!META_IG_USER_ID || !META_PAGE_TOKEN) throw new Error("META_IG_USER_ID / META_PAGE_TOKEN 시크릿이 필요합니다.");
  const tok = META_PAGE_TOKEN, IG = META_IG_USER_ID;
  const imgs = p.imageUrls || [], vids = p.videoUrls || [];
  if (imgs.length + vids.length === 0) throw new Error("인스타그램은 사진/영상이 1개 이상 필요합니다.");
  let creationId = "";
  if (imgs.length + vids.length === 1) {
    if (imgs.length) {
      creationId = (await gpost(`${GRAPH}/${IG}/media`, { image_url: imgs[0], caption: p.caption, access_token: tok })).id;
    } else {
      creationId = (await gpost(`${GRAPH}/${IG}/media`, { media_type: "REELS", video_url: vids[0], caption: p.caption, access_token: tok })).id;
      await waitContainer(GRAPH, creationId, tok);
    }
  } else {
    const children: string[] = [];
    for (const image_url of imgs.slice(0, 10)) {
      const cid = (await gpost(`${GRAPH}/${IG}/media`, { image_url, is_carousel_item: "true", access_token: tok })).id;
      await waitContainer(GRAPH, cid, tok);   // 이미지도 비동기 처리 — FINISHED 될 때까지 대기해야 부모 캐러셀이 참조 가능
      children.push(cid);
    }
    for (const video_url of vids.slice(0, Math.max(0, 10 - children.length))) {
      const cid = (await gpost(`${GRAPH}/${IG}/media`, { media_type: "VIDEO", video_url, is_carousel_item: "true", access_token: tok })).id;
      await waitContainer(GRAPH, cid, tok);
      children.push(cid);
    }
    creationId = (await gpost(`${GRAPH}/${IG}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: p.caption, access_token: tok })).id;
    await waitContainer(GRAPH, creationId, tok);   // 부모 캐러셀 컨테이너도 비동기 처리 — 생성 직후 바로 publish 하면 "미디어를 찾을 수 없음" 남
  }
  const pub = await gpost(`${GRAPH}/${IG}/media_publish`, { creation_id: creationId, access_token: tok });
  return { id: pub.id, url: "https://www.instagram.com/" };
}

async function publishThreads(p: { text: string; imageUrls?: string[]; videoUrls?: string[] }) {
  if (!THREADS_USER_ID || !THREADS_TOKEN) throw new Error("THREADS_USER_ID / THREADS_TOKEN 시크릿이 필요합니다.");
  const TID = THREADS_USER_ID, tok = THREADS_TOKEN;
  const imgs = p.imageUrls || [], vids = p.videoUrls || [];
  let creationId = "";
  if (imgs.length + vids.length <= 1) {
    const params: Record<string, string> = { text: p.text, access_token: tok };
    if (imgs.length) { params.media_type = "IMAGE"; params.image_url = imgs[0]; }
    else if (vids.length) { params.media_type = "VIDEO"; params.video_url = vids[0]; }
    else params.media_type = "TEXT";
    creationId = (await gpost(`${THREADS_API}/${TID}/threads`, params)).id;
    if (vids.length) await waitContainer(THREADS_API, creationId, tok);
  } else {
    const children: string[] = [];
    for (const image_url of imgs) {
      const cid = (await gpost(`${THREADS_API}/${TID}/threads`, { media_type: "IMAGE", image_url, is_carousel_item: "true", access_token: tok })).id;
      await waitContainer(THREADS_API, cid, tok);   // 이미지도 비동기 처리 — FINISHED 될 때까지 대기해야 부모 캐러셀이 참조 가능
      children.push(cid);
    }
    for (const video_url of vids) {
      const cid = (await gpost(`${THREADS_API}/${TID}/threads`, { media_type: "VIDEO", video_url, is_carousel_item: "true", access_token: tok })).id;
      await waitContainer(THREADS_API, cid, tok);
      children.push(cid);
    }
    creationId = (await gpost(`${THREADS_API}/${TID}/threads`, { media_type: "CAROUSEL", children: children.join(","), text: p.text, access_token: tok })).id;
    await waitContainer(THREADS_API, creationId, tok);   // 부모 캐러셀 컨테이너도 비동기 처리 — 생성 직후 바로 publish 하면 "미디어를 찾을 수 없음" 남
  }
  const pub = await gpost(`${THREADS_API}/${TID}/threads_publish`, { creation_id: creationId, access_token: tok });
  return { id: pub.id, url: "https://www.threads.net/" };
}

// ──────────────────────────────────────────────
// 댓글 자동응답 (인스타·페이스북·쓰레드)
//   최근 게시물 훑어 새 댓글 감지 → AI 분류(감사/문의/일반/불만/스팸) → 감사·문의엔 자동 답글,
//   불만·스팸은 답글을 달지 않고 사람이 보도록 skipped_reason 만 기록.
//   중복 방지는 autopost_comments.comment_id UNIQUE 로 처리.
// ──────────────────────────────────────────────
const SELF_USERNAME = "sanghwan_hanbyeol"; // 인스타·쓰레드 공용 계정명 — 우리 자신이 단 답글은 스캔에서 제외

interface RawComment {
  platform: string;
  comment_id: string;
  post_id: string;
  author: string;
  text: string;
}

async function fetchInstagramComments(): Promise<RawComment[]> {
  const tok = META_PAGE_TOKEN;
  const media = await gget(`${GRAPH}/${META_IG_USER_ID}/media?fields=id&limit=15&access_token=${encodeURIComponent(tok)}`);
  const out: RawComment[] = [];
  for (const m of (media.data || [])) {
    try {
      const c = await gget(`${GRAPH}/${m.id}/comments?fields=id,text,username&limit=50&access_token=${encodeURIComponent(tok)}`);
      for (const cm of (c.data || [])) {
        if (!cm.text || cm.username === SELF_USERNAME) continue;
        out.push({ platform: "instagram", comment_id: cm.id, post_id: m.id, author: cm.username || "", text: cm.text });
      }
    } catch (_e) { /* 개별 게시물 댓글 조회 실패는 건너뜀 */ }
  }
  return out;
}

async function fetchFacebookComments(): Promise<RawComment[]> {
  const tok = META_PAGE_TOKEN;
  const posts = await gget(`${GRAPH}/${META_PAGE_ID}/posts?fields=id&limit=15&access_token=${encodeURIComponent(tok)}`);
  const out: RawComment[] = [];
  for (const p of (posts.data || [])) {
    try {
      const c = await gget(`${GRAPH}/${p.id}/comments?fields=id,message,from&limit=50&access_token=${encodeURIComponent(tok)}`);
      for (const cm of (c.data || [])) {
        if (!cm.message || (cm.from && cm.from.id === META_PAGE_ID)) continue;
        out.push({ platform: "facebook", comment_id: cm.id, post_id: p.id, author: (cm.from && cm.from.name) || "", text: cm.message });
      }
    } catch (_e) { /* 건너뜀 */ }
  }
  return out;
}

async function fetchThreadsComments(): Promise<RawComment[]> {
  const tok = THREADS_TOKEN;
  const posts = await gget(`${THREADS_API}/${THREADS_USER_ID}/threads?fields=id&limit=15&access_token=${encodeURIComponent(tok)}`);
  const out: RawComment[] = [];
  for (const p of (posts.data || [])) {
    try {
      const c = await gget(`${THREADS_API}/${p.id}/replies?fields=id,text,username&access_token=${encodeURIComponent(tok)}`);
      for (const cm of (c.data || [])) {
        if (!cm.text || cm.username === SELF_USERNAME) continue;
        out.push({ platform: "threads", comment_id: cm.id, post_id: p.id, author: cm.username || "", text: cm.text });
      }
    } catch (_e) { /* 건너뜀 */ }
  }
  return out;
}

// 댓글 성격 분류 + 답글 초안 생성 (Claude, 저가 모델)
async function classifyComment(text: string): Promise<{ sentiment: string; reply: string }> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY 시크릿이 필요합니다.");
  const prompt = `당신은 ${COMPANY.name} SNS 댓글 담당자입니다. 아래 댓글에 대한 답글을 작성합니다.
[톤] 파는 곳이 아니라 돕는 곳. 과장 없이 따뜻하고 담백하게. 이모지는 0~1개만.
[분류]
- thanks: 감사·칭찬·응원 댓글 → 짧고 진심 어린 감사 인사(1~2문장)
- question: 가격·설치·방문 등 문의성 댓글 → 감사 인사 + 간단 답변 + "편하게 전화(${COMPANY.tel}) 주세요" 유도(2~3문장)
- neutral: 그 외 일반 댓글(공감·한마디) → 짧은 감사·공감 답글(1문장)
- complaint: 불만·항의·클레임 → reply 는 빈 문자열로(사람이 직접 대응해야 함)
- spam: 광고·도배·욕설 등 스팸성 → reply 는 빈 문자열로

댓글: "${text.replace(/"/g, "'").slice(0, 500)}"

다른 설명 없이 JSON 한 줄로만 응답하세요: {"sentiment":"thanks|question|neutral|complaint|spam","reply":"..."}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 400, thinking: { type: "disabled" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error("Comment classify " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const raw = (d.content || []).map((c: { text: string }) => c.text).join("").trim();
  const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(jsonStr);
    return { sentiment: String(parsed.sentiment || "neutral"), reply: String(parsed.reply || "") };
  } catch {
    return { sentiment: "neutral", reply: "" };
  }
}

async function postCommentReply(platform: string, commentId: string, text: string) {
  if (platform === "instagram") {
    await gpost(`${GRAPH}/${commentId}/replies`, { message: text, access_token: META_PAGE_TOKEN });
  } else if (platform === "facebook") {
    await gpost(`${GRAPH}/${commentId}/comments`, { message: text, access_token: META_PAGE_TOKEN });
  } else if (platform === "threads") {
    const cid = (await gpost(`${THREADS_API}/${THREADS_USER_ID}/threads`, { media_type: "TEXT", text, reply_to_id: commentId, access_token: THREADS_TOKEN })).id;
    await waitContainer(THREADS_API, cid, THREADS_TOKEN);
    await gpost(`${THREADS_API}/${THREADS_USER_ID}/threads_publish`, { creation_id: cid, access_token: THREADS_TOKEN });
  } else {
    throw new Error("알 수 없는 플랫폼: " + platform);
  }
}

async function pollComments() {
  await loadMetaConfig();
  const raw: RawComment[] = [];
  if (META_PAGE_TOKEN && META_IG_USER_ID) raw.push(...(await fetchInstagramComments().catch(() => [])));
  if (META_PAGE_TOKEN && META_PAGE_ID) raw.push(...(await fetchFacebookComments().catch(() => [])));
  if (THREADS_TOKEN && THREADS_USER_ID) raw.push(...(await fetchThreadsComments().catch(() => [])));
  if (!raw.length) return { processed: [] };

  // 이미 처리한 댓글 제외 (comment_id UNIQUE 기준)
  const idList = raw.map((r) => r.comment_id).join(",");
  const existing = idList ? await sbRest("GET", `autopost_comments?select=comment_id&comment_id=in.(${idList})`) : [];
  const seen = new Set((existing || []).map((r: { comment_id: string }) => r.comment_id));
  const fresh = raw.filter((r) => !seen.has(r.comment_id));

  const processed: Record<string, unknown>[] = [];
  for (const c of fresh) {
    let sentiment = "neutral", replyText = "", replied = false, skippedReason = "";
    try {
      const cls = await classifyComment(c.text);
      sentiment = cls.sentiment;
      replyText = cls.reply;
    } catch (e) {
      skippedReason = "분류 실패: " + ((e as Error).message || String(e));
    }
    if (!skippedReason && (sentiment === "complaint" || sentiment === "spam" || !replyText)) {
      skippedReason = sentiment === "complaint" ? "불만성 댓글 — 직접 대응 필요"
        : sentiment === "spam" ? "스팸 의심 — 자동응답 안 함"
        : "답글 생성 실패";
    } else if (!skippedReason) {
      try {
        await postCommentReply(c.platform, c.comment_id, replyText);
        replied = true;
      } catch (e) {
        skippedReason = "답글 등록 실패: " + ((e as Error).message || String(e));
      }
    }
    const row = {
      platform: c.platform, comment_id: c.comment_id, post_id: c.post_id,
      author: c.author, comment_text: c.text, sentiment, reply_text: replyText,
      replied, skipped_reason: skippedReason || null,
    };
    try {
      await sbRest("POST", "autopost_comments", row, { Prefer: "return=representation" });
    } catch (_e) { /* insert 실패 시 다음 폴링에서도 다시 신규로 잡혀 재시도됨 */ }
    processed.push(row);
  }
  return { processed };
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
      await loadMetaConfig();
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
          facebook: { configured: !!(META_PAGE_ID && META_PAGE_TOKEN) },
          instagram: { configured: !!((META_IG_USER_ID && META_PAGE_TOKEN) || MAKE_IG_WEBHOOK), via: (META_IG_USER_ID && META_PAGE_TOKEN) ? "direct" : (MAKE_IG_WEBHOOK ? "make" : null) },
          threads: { configured: !!(THREADS_USER_ID && THREADS_TOKEN) },
        },
      });
    }

    if (req.method === "GET" && sub === "/styles") {
      return jsonResponse(200, { ok: true, styles: STYLE_PRESETS.map((x) => ({ id: x.id, name: x.name, family: x.family, heading: x.heading, accent: x.accent, hl: x.hl })) });
    }

    if (req.method === "POST" && sub === "/generate") {
      const p = await req.json() as GenInput & { humanize?: boolean };
      const result = await callClaude(buildPrompt(p), modelForChannel(p.channel));
      const fin = await finishText(result.text, p.channel, p.humanize !== false);
      return jsonResponse(200, { ok: true, channel: p.channel, text: fin.text, plan: fin.plan, usage: mergeUsage(result.usage, fin.extra), length: fin.len, over_limit: fin.over, faq: fin.faq });
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
        videos?: { url: string; caption?: string }[];
        style?: { preset?: string } | string;
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
        videos: p.videos,
        style: p.style,
      });
      return jsonResponse(200, { ok: true, ...out });
    }

    if (req.method === "POST" && sub === "/publish/facebook") {
      await loadMetaConfig();
      const p = await req.json() as { message?: string; imageUrls?: string[]; videoUrls?: string[] };
      if (!p.message && !(p.imageUrls?.length) && !(p.videoUrls?.length)) return jsonResponse(400, { ok: false, error: "내용이 비었습니다." });
      return jsonResponse(200, { ok: true, ...(await publishFacebook({ message: p.message || "", imageUrls: p.imageUrls, videoUrls: p.videoUrls })) });
    }

    if (req.method === "POST" && sub === "/publish/instagram") {
      await loadMetaConfig();
      const p = await req.json() as { caption?: string; imageUrls?: string[]; videoUrls?: string[] };
      return jsonResponse(200, { ok: true, ...(await publishInstagram({ caption: p.caption || "", imageUrls: p.imageUrls, videoUrls: p.videoUrls })) });
    }

    if (req.method === "POST" && sub === "/publish/threads") {
      await loadMetaConfig();
      const p = await req.json() as { text?: string; imageUrls?: string[]; videoUrls?: string[] };
      return jsonResponse(200, { ok: true, ...(await publishThreads({ text: p.text || "", imageUrls: p.imageUrls, videoUrls: p.videoUrls })) });
    }

    if (req.method === "POST" && sub === "/comments/poll") {
      return jsonResponse(200, { ok: true, ...(await pollComments()) });
    }

    // ── 대기열 파이프라인 ──
    if (req.method === "POST" && sub === "/queue/generate") {
      const p = await req.json() as QueueGenInput;
      if (!p.topic) return jsonResponse(400, { ok: false, error: "topic 필요" });
      const post = await queueGenerate(p);
      return jsonResponse(200, { ok: true, post });
    }

    // 배치 생성(−50%): 소재 → 요청 채널 한 번에 제출 → generating 적재
    if (req.method === "POST" && sub === "/queue/generate-batch") {
      const p = await req.json() as QueueGenInput;
      if (!p.topic) return jsonResponse(400, { ok: false, error: "topic 필요" });
      const post = await queueGenerateBatch(p);
      return jsonResponse(200, { ok: true, post });
    }

    // 배치 수집: 끝난 generating 항목을 pending 으로 승격(콘솔이 대기열 열 때마다 호출)
    if (req.method === "POST" && sub === "/queue/collect") {
      return jsonResponse(200, { ok: true, ...(await collectBatches()) });
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
      const p = await req.json() as { images?: { data: string; media_type?: string; name?: string; meta?: ImageMeta }[]; meta?: ImageMeta };
      if (!p.images || !p.images.length) return jsonResponse(400, { ok: false, error: "images 필요" });
      // 요청 단위 meta 는 개별 meta 가 없는 사진에 적용
      const images = await uploadMedia(p.images.map((im) => ({ ...im, meta: im.meta || p.meta })));
      return jsonResponse(200, { ok: true, images });
    }

    if (req.method === "POST" && sub === "/media/sign-upload") {
      const p = await req.json() as { files?: { ext?: string }[] };
      if (!p.files || !p.files.length) return jsonResponse(400, { ok: false, error: "files 필요" });
      const items = await signUpload(p.files);
      return jsonResponse(200, { ok: true, items });
    }

    return jsonResponse(404, { ok: false, error: "Not found. 사용: GET /health, /queue · POST /generate, /analyze-image, /generate-image, /google/connect, /publish/google, /queue/generate, /queue/update, /queue/delete" });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message || String(e) });
  }
});
