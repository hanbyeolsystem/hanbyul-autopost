/**
 * 한별시스템 AI 발행 백엔드
 * ─────────────────────────────────────────────
 * 역할: 콘솔(브라우저)이 호출하는 안전한 AI 게이트웨이.
 *  - API 키는 이 서버(환경변수)에만 존재. 브라우저에 노출되지 않음.
 *  - 6개 채널 에이전트 프롬프트를 내장하고, 입력값으로 실제 AI 글을 생성.
 *  - Anthropic(Claude) 우선, 없으면 OpenAI(GPT), 둘 다 없으면 오류 안내.
 *
 * 의존성 없음(Node 18+ 내장 fetch 사용). 그냥 `node server.js`로 실행.
 * 환경변수:
 *   ANTHROPIC_API_KEY  (권장)  또는  OPENAI_API_KEY
 *   PORT (기본 8787)
 *   ALLOW_ORIGIN (기본 *  — 운영 시 콘솔 도메인으로 제한 권장)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

// 키 로딩: 환경변수 우선, 없으면 같은 폴더 key.txt의 모든 줄을 읽어 자동 배정
// (sk-ant-... → Claude, 그 외 sk-... → OpenAI). 두 키를 줄바꿈으로 같이 넣어도 됨.
function readKeyLines(){
  try{
    const t = fs.readFileSync(path.join(__dirname, 'key.txt'), 'utf8');
    return t.split(/\r?\n/).map(s=>s.trim()).filter(s=> s && !s.startsWith('#'));
  }catch(e){ return []; }
}
let ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
let OPENAI_KEY = process.env.OPENAI_API_KEY || '';
// 힉스필드 키: 환경변수 HIGGSFIELD_API_KEY, 또는 key.txt에 "hf:<키>" 형식 줄
let HIGGSFIELD_KEY = process.env.HIGGSFIELD_API_KEY || '';
readKeyLines().forEach(k=>{
  if(k.startsWith('sk-ant-')){ if(!ANTHROPIC_KEY) ANTHROPIC_KEY = k; }
  else if(k.startsWith('hf:')){ if(!HIGGSFIELD_KEY) HIGGSFIELD_KEY = k.slice(3).trim(); }
  else if(k.startsWith('sk-')){ if(!OPENAI_KEY) OPENAI_KEY = k; }
});

const COMPANY = {
  name: '한별시스템',
  addr: '대구 달서구 문화회관11안길 22-7 1층',
  tel: '053-588-7119',
  bizline: '컴퓨터 · 복사기 · 프린터 · NAS · 서버 · 잉크젯 · 토너 · 공기제균기 등 사무기기 일체',
};

// ── 공통 철학(모든 채널에 주입) ──
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

// ── 채널별 에이전트 지침(분석한 이긴 공식 + 도움 톤) ──
const CHANNEL_AGENTS = {
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

const TYPE_GUIDE = {
  review: '글 유형: 후기형 — 상황→추천 이유→설치 과정→솔직 평가→이런 분께 추천.',
  guide: '글 유형: 가이드형 — 왜 필요한가→선택지 비교(표 가능)→상황별 추천→선택 기준 N가지→주의점.',
  case: '글 유형: 사례형(B2B) — 고객사 소개→요청사항→제안 구성→구축 과정→도입 효과→비슷한 고민 상담 제안.',
};

// ── 입력값으로 프롬프트 빌드 ──
function buildPrompt(p){
  const { channel, seed, kw, tone, region, model, service, pain, solution, postType, imageDesc, history } = p;
  const agent = CHANNEL_AGENTS[channel];
  if(!agent) throw new Error('알 수 없는 채널: ' + channel);
  const typeGuide = TYPE_GUIDE[postType] || TYPE_GUIDE.review;

  // 사진 분석 결과가 있으면 '글과 사진 일치' 지침 주입
  const imageBlock = imageDesc ? `
[첨부 사진 분석 결과]
${imageDesc}
★ 매우 중요: 글의 내용은 위 사진에 실제로 보이는 것과 반드시 일치해야 합니다. 사진에 없는 장비·모델·상황을 지어내지 마세요. 글과 사진이 어긋나면 신뢰가 깨집니다.` : '';

  // 과거 발행 기록(같은 채널)을 참고자료로 주입 → 톤 일관성·학습
  const histBlock = (history && history.length) ? `
[참고: 이 채널의 과거 발행 사례 (톤·구성을 참고하되 내용은 새로 작성)]
${history.slice(0,3).map((h,i)=>`(${i+1}) ${String(h).slice(0,300)}`).join('\n---\n')}` : '';

  // 핵심 키워드 자동 생성 안내
  const kwBlock = (kw && kw.trim())
    ? `- 핵심 키워드: ${kw}`
    : `- 핵심 키워드: (자동) 지역·서비스·모델·증상을 바탕으로 검색에 유리한 핵심 키워드 4~6개를 스스로 정해 글과 해시태그에 자연스럽게 녹이세요.`;

  return `${PHILOSOPHY}

${agent}

${typeGuide}
${imageBlock}
${histBlock}

[이번 글의 입력값]
- 지역: ${region || '대구'}
- 서비스 분류: ${service || '(미지정)'}
- 모델/장비: ${model || '(미지정)'}
- 고객이 겪던 어려움/증상: ${pain || '(미지정 — 사무환경 정비의 막막함으로 가정)'}
- 해결 방법: ${solution || '(미지정 — 한 일에서 유추)'}
- 한 일/핵심 메시지: ${seed || '(미지정)'}
${kwBlock}

위 입력값과 채널 지침에 따라, 바로 발행 가능한 완성된 글 1편을 한국어로 작성하세요. 설명이나 머리말 없이 본문만 출력하세요.`;
}

// ── AI 호출: Claude 우선, 없으면 OpenAI ──
async function callAI(prompt){
  if(ANTHROPIC_KEY){
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-api-key':ANTHROPIC_KEY,
        'anthropic-version':'2023-06-01',
      },
      body: JSON.stringify({
        model:'claude-sonnet-4-5',
        max_tokens:2000,
        messages:[{role:'user', content:prompt}],
      }),
    });
    if(!r.ok) throw new Error('Anthropic '+r.status+': '+(await r.text()).slice(0,200));
    const d = await r.json();
    const u = d.usage || {};
    // Claude Sonnet 가격: 입력 $3 / 출력 $15 (백만 토큰당)
    const inTok = u.input_tokens||0, outTok = u.output_tokens||0;
    const usd = (inTok/1e6)*3 + (outTok/1e6)*15;
    return {
      text: d.content.map(c=>c.text).join(''),
      usage: { model:'claude-sonnet-4-5', input_tokens:inTok, output_tokens:outTok, usd:+usd.toFixed(5) }
    };
  }
  if(OPENAI_KEY){
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{'content-type':'application/json','authorization':'Bearer '+OPENAI_KEY},
      body: JSON.stringify({
        model:'gpt-4o',
        max_tokens:2000,
        messages:[{role:'user', content:prompt}],
      }),
    });
    if(!r.ok) throw new Error('OpenAI '+r.status+': '+(await r.text()).slice(0,200));
    const d = await r.json();
    const u = d.usage || {};
    // GPT-4o 가격: 입력 $2.5 / 출력 $10 (백만 토큰당)
    const inTok = u.prompt_tokens||0, outTok = u.completion_tokens||0;
    const usd = (inTok/1e6)*2.5 + (outTok/1e6)*10;
    return {
      text: d.choices[0].message.content,
      usage: { model:'gpt-4o', input_tokens:inTok, output_tokens:outTok, usd:+usd.toFixed(5) }
    };
  }
  throw new Error('API 키가 설정되지 않았습니다. ANTHROPIC_API_KEY 또는 OPENAI_API_KEY 환경변수를 설정하세요.');
}

// ── 사진 분석 (Claude Vision) ──
// images: [{ media_type:'image/jpeg', data:'<base64>' }, ...]
async function analyzeImages(images){
  if(!ANTHROPIC_KEY) throw new Error('사진 분석은 ANTHROPIC_API_KEY가 필요합니다.');
  if(!images || !images.length) throw new Error('분석할 이미지가 없습니다.');
  const content = [];
  images.slice(0,4).forEach(img=>{
    content.push({ type:'image', source:{ type:'base64', media_type:img.media_type||'image/jpeg', data:img.data } });
  });
  content.push({ type:'text', text:
    `당신은 컴퓨터·프린터·복사기·복합기·시놀로지 NAS 등 사무기기/전산 장비 전문가입니다. 위 사진들을 분석해서 블로그 글 작성에 쓸 수 있도록 정리하세요:\n`+
    `1) 사진에 보이는 장비/물건이 무엇인지 (가능하면 종류·브랜드 추정)\n`+
    `2) 현장/상황 (사무실, 설치 중, 케이블 정리 등)\n`+
    `3) 글에 활용할 만한 시각적 포인트\n`+
    `4) 주의: 확실하지 않은 모델명은 단정하지 말고 '추정'으로 표기.\n`+
    `간결한 한국어로, 사실 위주로만 작성하세요.` });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'content-type':'application/json', 'x-api-key':ANTHROPIC_KEY, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:800, messages:[{role:'user', content}] }),
  });
  if(!r.ok) throw new Error('Vision '+r.status+': '+(await r.text()).slice(0,200));
  const d = await r.json();
  const u = d.usage||{};
  const usd = ((u.input_tokens||0)/1e6)*3 + ((u.output_tokens||0)/1e6)*15;
  return { desc: d.content.map(c=>c.text).join(''), usage:{ usd:+usd.toFixed(5), input_tokens:u.input_tokens||0, output_tokens:u.output_tokens||0 } };
}

// ── AI 그림 생성 (OpenAI DALL·E 3) ──
async function generateImage(promptText){
  if(!OPENAI_KEY) throw new Error('AI 그림 생성은 OPENAI_API_KEY가 필요합니다. (콘솔 안내 참고)');
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method:'POST',
    headers:{ 'content-type':'application/json', 'authorization':'Bearer '+OPENAI_KEY },
    body: JSON.stringify({ model:'dall-e-3', prompt:promptText, n:1, size:'1024x1024' }),
  });
  if(!r.ok) throw new Error('Image '+r.status+': '+(await r.text()).slice(0,200));
  const d = await r.json();
  return { url: d.data[0].url, usage:{ usd:0.04 } }; // DALL·E 3 1024 ≈ $0.04/장
}

// ── AI 영상 생성 (Higgsfield) ──
// 비동기: 생성 요청 → status_url 폴링 → 완료 시 비디오 URL.
// 주의: 공식 엔드포인트/파라미터는 제공사 문서 기준으로 ENDPOINTS를 조정하세요.
const HF_BASE = process.env.HIGGSFIELD_BASE || 'https://platform.higgsfield.ai/v1';
async function generateVideo({ prompt, imageUrl, mode }){
  if(!HIGGSFIELD_KEY) throw new Error('영상 생성은 Higgsfield 키가 필요합니다. key.txt에 "hf:<키>" 줄을 추가하세요.');
  // 1) 생성 요청
  const reqBody = imageUrl
    ? { mode:'image2video', image_url:imageUrl, prompt: prompt||'', seed: 42 }
    : { mode:'text2video', prompt: prompt||'사무기기 설치 현장', seed: 42 };
  const start = await fetch(HF_BASE.replace(/\/$/,'')+'/generate', {
    method:'POST',
    headers:{ 'content-type':'application/json', 'authorization':'Bearer '+HIGGSFIELD_KEY },
    body: JSON.stringify(reqBody),
  });
  if(!start.ok) throw new Error('Higgsfield '+start.status+': '+(await start.text()).slice(0,200));
  const s = await start.json();
  const statusUrl = s.status_url || (s.generation_id ? HF_BASE.replace(/\/$/,'')+'/status/'+s.generation_id : null);
  if(!statusUrl) return { status:'submitted', raw:s };  // 폴링 불가 시 제출만 반환

  // 2) 폴링 (최대 ~90초)
  for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,3000));
    const st = await fetch(statusUrl, { headers:{ 'authorization':'Bearer '+HIGGSFIELD_KEY } });
    if(!st.ok) continue;
    const d = await st.json();
    const state = (d.status||d.state||'').toLowerCase();
    if(state==='completed'||state==='succeeded'||d.video_url||d.url){
      return { status:'completed', url: d.video_url || d.url || (d.result&&d.result.url), usage:{ usd: 0 } };
    }
    if(state==='failed'||state==='error') throw new Error('Higgsfield 생성 실패: '+JSON.stringify(d).slice(0,200));
  }
  return { status:'pending', statusUrl };  // 아직 진행 중 — 클라이언트가 나중에 다시 확인
}

// ── HTTP 서버 ──
function cors(res){
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res)=>{
  cors(res);
  if(req.method==='OPTIONS'){ res.writeHead(204); return res.end(); }

  if(req.method==='GET' && req.url==='/health'){
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      ok:true,
      ai: ANTHROPIC_KEY ? 'anthropic' : (OPENAI_KEY ? 'openai' : 'none'),
      vision: !!ANTHROPIC_KEY,           // 사진 분석 가능 여부
      imagegen: !!OPENAI_KEY,            // AI 그림 생성 가능 여부
      videogen: !!HIGGSFIELD_KEY,        // AI 영상 생성(힉스필드) 가능 여부
      channels: Object.keys(CHANNEL_AGENTS),
    }));
  }

  // 본문 수집 (이미지 base64 대비 넉넉히)
  const collect = (cb)=>{
    let body='';
    req.on('data', c=>{ body+=c; if(body.length > 25*1024*1024){ req.destroy(); } });
    req.on('end', ()=> cb(body));
  };
  const sendErr = (e)=>{ res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:e.message||String(e)})); };
  const sendOk = (obj)=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true,...obj})); };

  if(req.method==='POST' && req.url==='/generate'){
    collect(async (body)=>{
      try{
        const p = JSON.parse(body||'{}');
        const result = await callAI(buildPrompt(p));
        sendOk({ channel:p.channel, text: result.text, usage: result.usage });
      }catch(e){ sendErr(e); }
    });
    return;
  }

  if(req.method==='POST' && req.url==='/analyze-image'){
    collect(async (body)=>{
      try{
        const p = JSON.parse(body||'{}');
        const out = await analyzeImages(p.images);
        sendOk({ desc: out.desc, usage: out.usage });
      }catch(e){ sendErr(e); }
    });
    return;
  }

  if(req.method==='POST' && req.url==='/generate-image'){
    collect(async (body)=>{
      try{
        const p = JSON.parse(body||'{}');
        const out = await generateImage(p.prompt || '한별시스템 사무기기 관련 깔끔한 일러스트');
        sendOk({ url: out.url, usage: out.usage });
      }catch(e){ sendErr(e); }
    });
    return;
  }

  if(req.method==='POST' && req.url==='/generate-video'){
    collect(async (body)=>{
      try{
        const p = JSON.parse(body||'{}');
        const out = await generateVideo({ prompt:p.prompt, imageUrl:p.imageUrl, mode:p.mode });
        sendOk(out);
      }catch(e){ sendErr(e); }
    });
    return;
  }

  res.writeHead(404, {'Content-Type':'application/json'});
  res.end(JSON.stringify({ ok:false, error:'Not found. 사용: GET /health, POST /generate, /analyze-image, /generate-image' }));
});

// 테스트를 위해 buildPrompt 노출
module.exports = { buildPrompt, CHANNEL_AGENTS, TYPE_GUIDE };

if(require.main === module){
  server.listen(PORT, ()=>{
    console.log(`[한별 AI 백엔드] 포트 ${PORT}에서 실행 중`);
    console.log(`AI 엔진: ${ANTHROPIC_KEY ? 'Claude(Anthropic)' : (OPENAI_KEY ? 'GPT(OpenAI)' : '⚠ 키 없음 — 환경변수 설정 필요')}`);
    console.log(`상태 확인: http://localhost:${PORT}/health`);
  });
}
