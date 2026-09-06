/* 광고형 프롬프트 검증.  실행: node supabase/functions/hanbyul-autopost-ai/prompt.test.mjs
   지키려는 것
     · 광고형일 때만 광고 지침이 붙는다 (평소 글이 광고 톤으로 물들면 안 된다)
     · 표시광고법 가드가 반드시 프롬프트에 실린다
     · 광고 입력값이 빠짐없이 전달된다
     · 짧은 채널에는 훅 후보 요청이 들어간다 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "index.ts"), "utf8");

// buildPrompt 와 그 의존 상수만 떼어내 돌린다 (TS 타입 표기는 지운다)
const cut = (startMark, endMark) => {
  const i = src.indexOf(startMark);
  assert.ok(i > -1, "없음: " + startMark);
  const j = src.indexOf(endMark, i);
  assert.ok(j > -1, "끝을 못 찾음: " + startMark);
  return src.slice(i, j);
};

let code = cut("const COMPANY", "interface GenInput")
  + cut("function buildPrompt", "\n}\n") + "\n}\n";
code = code
  .replace(/const (\w+): Record<string, string> =/g, "const $1 =")
  .replace(/const (\w+): Record<string, \{[^}]*\}> =/g, "const $1 =")   // CHANNEL_LIMITS 같은 객체형 타입
  .replace(/function buildPrompt\(p: GenInput\): string/, "function buildPrompt(p)")
  .replace(/\bconst (\w+): string\b/g, "const $1");

const buildPrompt = new Function(code + "\nreturn buildPrompt;")();

const base = {
  channel: "instagram", region: "대구", service: "NAS", model: "DS925+",
  seed: "신모델 입고", imageCount: 0, videoCount: 0,
};

// ── 1) 평소 글에는 광고 지침이 없어야 한다 ──
for (const t of ["review", "guide", "case"]) {
  const out = buildPrompt({ ...base, postType: t });
  assert.ok(!out.includes("[광고형 — 이 글은 광고다]"), `${t} 에 광고 지침이 붙었다`);
  assert.ok(!out.includes("표시광고법"), `${t} 에 광고법 문구가 붙었다`);
  assert.ok(!out.includes("[이번 광고의 내용]"), `${t} 에 광고 입력값이 붙었다`);
}

// ── 2) 광고형에는 지침과 법 가드가 반드시 붙는다 ──
{
  const out = buildPrompt({ ...base, postType: "ad" });
  assert.ok(out.includes("[광고형 — 이 글은 광고다]"), "광고 지침 없음");
  assert.ok(out.includes("표시광고법"), "표시광고법 가드 없음");
  for (const must of ["최고", "1등", "조건이 있으면", "부가세", "훅 후보"]) {
    assert.ok(out.includes(must), `광고 가드에 "${must}" 가 없다`);
  }
}

// ── 3) 광고 입력값이 빠짐없이 전달된다 ──
{
  const out = buildPrompt({
    ...base, postType: "ad",
    adOffer: "시놀로지 DS925+ 입고",
    adBenefit: "설치와 자료 이전까지",
    adCondition: "9월까지 선착순 5대, 부가세 별도",
    adTarget: "백업이 걱정인 대구 사무실",
    adCta: "전화로 문의",
  });
  for (const v of ["시놀로지 DS925+ 입고", "설치와 자료 이전까지",
                   "9월까지 선착순 5대, 부가세 별도", "백업이 걱정인 대구 사무실", "전화로 문의"]) {
    assert.ok(out.includes(v), `입력값이 프롬프트에 없다: ${v}`);
  }
}

// ── 4) 조건을 비워도 지어내지 말라고 일러 준다 ──
{
  const out = buildPrompt({ ...base, postType: "ad" });
  assert.ok(out.includes("지어내지 말 것"), "빈 조건을 지어낼 여지를 남겼다");
}

// ── 5) 기존 원칙(과장 금지)은 광고형에서도 살아 있다 ──
{
  const out = buildPrompt({ ...base, postType: "ad" });
  assert.ok(out.includes("경쟁사 비방 금지") || out.includes("깎아내리지"), "비방 금지가 사라졌다");
}

// ── 6) 모르는 유형은 예전처럼 후기형으로 떨어진다 (기존 동작 유지) ──
{
  const out = buildPrompt({ ...base, postType: "없는유형" });
  assert.ok(out.includes("후기형"), "알 수 없는 유형의 폴백이 깨졌다");
  assert.ok(!out.includes("[광고형"), "폴백인데 광고가 붙었다");
}

// ── 7) 사람 문체 규칙은 모든 유형에 실린다 ──
for (const t of ["review", "guide", "case", "ad"]) {
  const out = buildPrompt({ ...base, postType: t });
  assert.ok(out.includes("[사람이 쓴 글처럼"), `${t}: 사람 문체 규칙 없음`);
  for (const must of ["쉼표를 아껴라", "결론적으로", "가지고 있다", "번역투"]) {
    assert.ok(out.includes(must), `${t}: 문체 규칙에 "${must}" 없음`);
  }
}

// ── 8) 노출 규칙(SEO·AEO·GEO): 블로그는 전체본, 짧은 채널은 짧은 판(블로그 규칙이 섞이면 haiku 가 블로그를 써 버린다) ──
{
  for (const t of ["review", "guide", "case", "ad"]) {
    const out = buildPrompt({ ...base, channel: "naver", postType: t });
    assert.ok(out.includes("[검색·AI 노출(SEO·AEO·GEO)"), `${t}: 블로그 노출 규칙 없음`);
    assert.ok(out.includes("40~60자"), `${t}: 직답 문단 규칙이 없다 (AI 인용의 핵심)`);
    assert.ok(out.includes("질문을 소제목으로"), `${t}: 질문형 소제목 규칙 없음`);
    assert.ok(out.includes("숫자를 넣어라"), `${t}: 구체 수치 규칙 없음`);
  }
  for (const ch of ["instagram", "threads", "facebook", "youtube"]) {
    const out = buildPrompt({ ...base, channel: ch, postType: "review" });
    assert.ok(out.includes("[검색·AI 노출 — 짧은 채널]"), `${ch}: 짧은 채널 노출 규칙 없음`);
    assert.ok(!out.includes("40~60자") && !out.includes("질문을 소제목으로"), `${ch}: 블로그 규칙이 섞였다`);
    assert.ok(out.includes("글 유형: 후기형 — 현장 한 장면"), `${ch}: 짧은 유형 가이드 없음`);
  }
  const ig = buildPrompt({ ...base, channel: "instagram", postType: "review" });
  assert.ok(ig.includes("[길이 — 절대 규칙] 본문(해시태그 제외) 250자 이내, 6줄 이내"), "인스타 절대 길이 규칙(맨 끝) 없음");
  assert.ok(!buildPrompt({ ...base, channel: "facebook", postType: "review" }).includes("[길이 — 절대 규칙]"), "페북에 길이 규칙이 붙으면 안 된다");
}

// ── 9) 짧은 채널은 채널별 노출 규칙이 따로 붙는다 ──
{
  const ig = buildPrompt({ ...base, channel: "instagram", postType: "review" });
  assert.ok(ig.includes("저장·공유가 노출을 키운다"), "인스타 저장 유도 규칙 없음");
  const th = buildPrompt({ ...base, channel: "threads", postType: "review" });
  assert.ok(th.includes("댓글이 붙어야 퍼진다"), "쓰레드 댓글 유도 규칙 없음");
  assert.ok(!th.includes("저장·공유가 노출을 키운다"), "채널 규칙이 섞였다");
}

console.log("광고형 프롬프트 검증 통과 — 평소글 비오염 · 광고법 가드 · 입력 전달 · 폴백 · 사람문체 · 노출규칙");

// ── 8) 2026-09-06 사장님 지시: 블로그 훅·가독성·기획 메모 / 짧은 채널 기획 메모 / 인스타 길이 ──
{
  const DELIM = "===기획메모===";
  for (const ch of ["naver", "google"]) {
    const out = buildPrompt({ ...base, channel: ch, postType: "review" });
    assert.ok(out.includes("[블로그 도입부"), `${ch}: 훅 규칙 없음`);
    assert.ok(out.includes("이거 내 이야기인데?"), `${ch}: '내 이야기' 훅 문구 없음`);
    assert.ok(out.includes("[모바일 가독성"), `${ch}: 가독성 규칙 없음`);
    assert.ok(out.includes("댓글로") && out.includes("CTA"), `${ch}: 댓글·CTA 규칙 없음`);
    assert.ok(out.includes("썸네일 문구 Top 3"), `${ch}: 썸네일 문구 기획 없음`);
    assert.ok(out.includes(DELIM), `${ch}: 기획 메모 구분선 없음`);
  }
  for (const ch of ["instagram", "threads"]) {
    const out = buildPrompt({ ...base, channel: ch, postType: "review" });
    assert.ok(out.includes("메인 키워드: 1개") && out.includes("제목(첫 줄) 후보 5개"), `${ch}: 기획 메모 항목 없음`);
    assert.ok(out.includes(DELIM), `${ch}: 기획 메모 구분선 없음`);
    assert.ok(!out.includes("[블로그 도입부"), `${ch}: 블로그 훅 규칙이 섞였다`);
  }
  for (const ch of ["youtube", "facebook"]) {
    const out = buildPrompt({ ...base, channel: ch, postType: "review" });
    assert.ok(!out.includes(DELIM), `${ch}: 기획 메모가 붙으면 안 된다`);
  }
  const ig = buildPrompt({ ...base, channel: "instagram", postType: "review" });
  assert.ok(ig.includes("250자 이내") && ig.includes("6줄 이내"), "인스타 길이 제한 없음");
  assert.ok(ig.includes("8~12개"), "인스타 해시태그 상한 없음");
  const hv = buildPrompt({ ...base, channel: "naver", postType: "review" });
  for (const must of ["물론입니다", "대시(—)", "분열문", "은유"]) {
    assert.ok(hv.includes(must), `문체 규칙에 "${must}" 없음 (humanize-korean 이식분)`);
  }
  assert.ok(hv.includes("혼자 읽혀도 뜻이 통해야") && hv.includes("정의문") && hv.includes("기준 시점"), "GEO 인용 규칙 없음");
}
console.log("prompt.test: 전부 통과");

