/* 후처리·서식 검증.  실행: node supabase/functions/hanbyul-autopost-ai/postprocess.test.mjs
   (esbuild 로 index.ts 를 JS 로 바꿔 Deno 스텁 아래 불러온다. npx esbuild 첫 실행은 수십 초.)
   지키려는 것
     · 기획 메모(===기획메모===)는 본문에서 분리된다 — 발행 본문에 절대 섞이지 않는다
     · 대시(—)는 하이픈으로, 챗봇 머리·꼬리는 잘린다
     · 인스타 길이 계산은 해시태그 줄을 뺀다
     · 구글 발행 HTML 은 프리셋 폰트·색상 + 소제목·인용·불릿·굵게·형광펜 서식이 들어간다
     · 'random' 은 프리셋 중 하나를 고르고, id 를 주면 그 프리셋이다 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "index.ts");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-autopost-"));
const outJs = path.join(outDir, "index.mjs");
execSync(`npx -y esbuild@0.24.0 "${src}" --loader:.ts=ts --format=esm --log-level=error --outfile="${outJs}"`, { stdio: "inherit" });

// Deno 스텁: env 는 비고, serve 는 아무것도 안 한다 → 모듈 초기화만 통과
globalThis.Deno = { env: { get: () => undefined }, serve: () => {} };
let js = fs.readFileSync(outJs, "utf8");
js = js.replace(/^import\s+"jsr:[^"]+";\s*$/m, "");   // 타입 전용 import — node 에선 뺀다
js += "\nexport { splitPlan, postClean, bodyLength, textToBloggerHtml, wrapStyled, pickStyle, STYLE_PRESETS, PLAN_DELIM, CHANNEL_LIMITS, countFaq, insertFaq, FAQ_CHANNELS };\n";
fs.writeFileSync(outJs, js);
const m = await import(pathToFileURL(outJs).href);

// 1) 기획 메모 분리
{
  const raw = "첫 줄 훅\n본문입니다.\n\n===기획메모===\n- 메인 키워드: NAS";
  const { text, plan } = m.splitPlan(raw);
  assert.strictEqual(text, "첫 줄 훅\n본문입니다.");
  assert.ok(plan.startsWith("- 메인 키워드"), "plan 분리 실패");
  assert.deepStrictEqual(m.splitPlan("메모 없음"), { text: "메모 없음", plan: "" });
}

// 2) 대시·챗봇 프레임 정리
{
  const c = m.postClean("물론입니다!\n\n본문 — 부연 – 또\n\n도움이 되셨길 바랍니다.");
  assert.strictEqual(c, "본문 - 부연 - 또");
}

// 3) 길이 계산(해시태그 제외)
{
  const t = "월요일 아침 공유폴더가 안 열리면 하루가 꼬입니다.\n대구 사무실 NAS 점검 다녀왔습니다.\n☎053-588-7119\n.\n.\n#대구NAS #시놀로지 #한별시스템";
  const l = m.bodyLength(t);
  assert.strictEqual(l.lines, 3, "해시태그·점 줄이 본문으로 세어졌다");
  assert.ok(l.body < 80 && l.body > 40, "본문 글자수 이상: " + l.body);
  assert.strictEqual(m.CHANNEL_LIMITS.instagram.body, 250);
}

// 4) 스타일 HTML
{
  const st = m.pickStyle("myeongjo-warm");
  assert.strictEqual(st.id, "myeongjo-warm");
  const text = "## NAS 용량은 얼마나 필요할까요?\n\n**핵심**은 ==10분이면 됩니다==.\n\n> 사장님이 그러셨어요\n\n- 항목 하나\n- 항목 둘\n\nQ. 며칠 걸리나요?\nA. 하루면 됩니다.\n\n#대구NAS #한별시스템";
  const html = m.wrapStyled(m.textToBloggerHtml(text, [], [], st), st);
  assert.ok(html.includes("fonts.googleapis.com/css2?family=Nanum+Myeongjo"), "폰트 @import 없음");
  assert.ok(html.includes("font-family:'Nanum Myeongjo'"), "본문 폰트 없음");
  assert.ok(html.includes("<h2") && html.includes(st.heading), "소제목 색 없음");
  assert.ok(html.includes("<strong style=\"color:" + st.accent), "굵게 강조 색 없음");
  assert.ok(html.includes("<mark") && html.includes(st.hl), "형광펜 없음");
  assert.ok(html.includes("<blockquote"), "인용 없음");
  assert.ok(html.includes("<ul") && (html.match(/<li/g) || []).length === 2, "불릿 없음");
  assert.ok(html.includes(">Q.</strong>") && html.includes(">A.</strong>"), "Q/A 강조 없음");
  assert.ok(!html.includes("**") && !html.includes("=="), "마커가 남았다");
  assert.ok(!html.includes("## "), "## 가 그대로 남았다");
  // 사진 마커는 그대로 <img> 로
  const withImg = m.textToBloggerHtml("앞\n\n[📷 사진 1 — 설치 모습]\n\n뒤", [{ url: "https://x/y.jpg" }], [], st);
  assert.ok(withImg.includes('<img src="https://x/y.jpg"'), "사진 삽입 실패");
}

// 5) random 은 프리셋 중 하나
{
  const ids = new Set(m.STYLE_PRESETS.map((x) => x.id));
  for (let i = 0; i < 20; i++) assert.ok(ids.has(m.pickStyle("random").id));
  assert.ok(ids.has(m.pickStyle(undefined).id));
  assert.ok(m.STYLE_PRESETS.length >= 6, "프리셋이 너무 적다");
}

// 6) Q&A 3개 보장: 개수 세기 + 연락처 줄 앞에 끼우기
{
  assert.strictEqual(m.countFaq("Q. 하나\nA. 답\n**Q. 둘**\nA. 답\nQ: 셋\nA: 답"), 3);
  assert.strictEqual(m.countFaq("질문 없음"), 0);
  const body = "본문 문단.\n\n댓글로 남겨 주세요.\n\n한별시스템 053-588-7119\n\n#대구NAS #한별시스템";
  const out = m.insertFaq(body, "Q. 비용은요?\nA. 부가세 포함 안내드립니다.\nQ. 며칠 걸리나요?\nA. 하루면 됩니다.\nQ. 고장 나면요?\nA. 원격으로 먼저 봅니다.");
  const iFaq = out.indexOf("## 자주 묻는 질문"), iTel = out.indexOf("053-588-7119"), iTag = out.indexOf("#대구NAS");
  assert.ok(iFaq > 0 && iFaq < iTel && iTel < iTag, "Q&A 가 연락처 줄 앞에 들어가야 한다");
  assert.strictEqual(m.countFaq(out), 3);
  const out2 = m.insertFaq("본문.\n\n#태그 #둘", "Q. 하나\nA. 답");
  assert.ok(out2.indexOf("## 자주 묻는 질문") < out2.indexOf("#태그"), "전화 줄 없으면 해시태그 앞");
  assert.ok(m.FAQ_CHANNELS.has("naver") && m.FAQ_CHANNELS.has("facebook") && !m.FAQ_CHANNELS.has("instagram"));
  const nv = m.insertFaq("본문.\n\n한별시스템 053-588-7119", "Q. 하나\nA. 답", "naver");
  assert.ok(nv.includes("\n자주 묻는 질문\n") && !nv.includes("## "), "네이버 평문에 ## 가 들어가면 안 된다");
}

// 7) 사진 alt/title/figcaption — AI·검색이 사진을 찾는 건 이 글자다
{
  const st = m.pickStyle("gothic-blue");
  const html = m.textToBloggerHtml("앞\n\n[📷 사진 1 - 설치 완료된 DS925+ 모습]\n\n뒤", [{ url: "https://x/y.jpg" }], [], st);
  assert.ok(html.includes('alt="설치 완료된 DS925+ 모습"'), "alt 없음: " + html);
  assert.ok(html.includes('title="설치 완료된 DS925+ 모습"'), "title 없음");
  assert.ok(html.includes("<figure") && html.includes("<figcaption"), "figure/figcaption 없음");
  const extra = m.textToBloggerHtml("본문만", [{ url: "https://x/a.jpg" }], [], st);
  assert.ok(extra.includes('alt="한별시스템 현장 사진"'), "마커 없는 여분 사진의 alt 없음");
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log("postprocess.test: 전부 통과 — 기획메모 분리 · 대시/챗봇 정리 · 길이 계산 · 스타일 HTML · 랜덤 프리셋 · Q&A 3개 삽입 · 사진 alt");
