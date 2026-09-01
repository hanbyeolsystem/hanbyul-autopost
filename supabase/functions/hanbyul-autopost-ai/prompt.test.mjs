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

// ── 8) 노출 규칙(SEO·AEO·GEO)도 모든 유형에 실린다 ──
{
  const out = buildPrompt({ ...base, postType: "review" });
  assert.ok(out.includes("[검색·AI 노출"), "노출 규칙 없음");
  // AEO/GEO 의 핵심: 질문 아래 답부터, 40~60자
  assert.ok(out.includes("40~60자"), "직답 문단 규칙이 없다 (AI 인용의 핵심)");
  assert.ok(out.includes("질문을 소제목으로"), "질문형 소제목 규칙 없음");
  assert.ok(out.includes("숫자를 넣어라"), "구체 수치 규칙 없음");
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
