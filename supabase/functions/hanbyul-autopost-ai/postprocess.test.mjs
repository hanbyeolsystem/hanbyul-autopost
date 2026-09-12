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
js += "\nexport { splitPlan, postClean, bodyLength, textToBloggerHtml, wrapStyled, pickStyle, STYLE_PRESETS, PLAN_DELIM, CHANNEL_LIMITS, countFaq, insertFaq, FAQ_CHANNELS, withXmp, buildXmp, ruleViolations };\n";
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

// 8) 사진 메타데이터(XMP): JPEG 에 APP1 세그먼트가 JFIF 뒤에 들어가고, 길이 필드가 맞고, 본문이 보존된다
{
  const jfif = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00];
  const body = [0xFF, 0xDB, 0x00, 0x04, 0x01, 0x02, 0xFF, 0xD9];
  const src = new Uint8Array([...jfif, ...body]);
  const meta = { title: "대구 달서구 사무실 NAS 설치", description: "한별시스템 현장 사진 & <DS925+>", keywords: ["대구 NAS", "시놀로지"], city: "대구" };
  const out = m.withXmp(src, meta);
  assert.ok(out.length > src.length, "세그먼트가 안 들어갔다");
  assert.ok(out[0] === 0xFF && out[1] === 0xD8 && out[2] === 0xFF && out[3] === 0xE0, "SOI/JFIF 순서 깨짐");
  const pos = 4 + ((out[4] << 8) | out[5]);
  assert.ok(out[pos] === 0xFF && out[pos + 1] === 0xE1, "APP1 이 JFIF 바로 뒤가 아니다");
  const len = (out[pos + 2] << 8) | out[pos + 3];
  const xml = new TextDecoder().decode(out.subarray(pos + 4, pos + 2 + len));
  assert.ok(xml.startsWith("http://ns.adobe.com/xap/1.0/\0"), "XMP 헤더 없음");
  assert.ok(xml.includes("대구 달서구 사무실 NAS 설치") && xml.includes("&amp; &lt;DS925+&gt;"), "제목/이스케이프 문제");
  assert.ok(xml.includes("<rdf:li>대구 NAS</rdf:li>") && xml.includes("<photoshop:City>대구</photoshop:City>"), "키워드/도시 없음");
  assert.ok(xml.includes("한별시스템"), "creator 없음");
  // 원본 본문은 그대로 뒤에
  const tail = Array.from(out.subarray(out.length - body.length));
  assert.deepStrictEqual(tail, body, "본문 바이트 손상");
  // JPEG 아니면 그대로
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
  assert.strictEqual(m.withXmp(png, meta), png);
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log("postprocess.test: 전부 통과 — 기획메모 분리 · 대시/챗봇 정리 · 길이 계산 · 스타일 HTML · 랜덤 프리셋 · Q&A 3개 삽입 · 사진 alt · XMP 메타데이터");

// 사람글 규칙 게이트(2026-09-12): 입니다 3연속·60자·금지어·이모지 감지
{
  const v = m.ruleViolations("견적서가 어디 있는지 몰랐습니다. 직원이 여섯입니다. 자료가 흩어져 있습니다. 혁신적인 솔루션입니다.", "google");
  assert.ok(v.some((x) => x.startsWith("입니다 3연속")), "입니다 3연속 감지 실패: " + v.join(" | "));
  assert.ok(v.some((x) => x.includes("혁신")) && v.some((x) => x.includes("솔루션")), "금지어 감지 실패");
  assert.ok(m.ruleViolations("★ 강조", "google").some((x) => x.startsWith("이모지")), "기호 감지 실패");
  assert.ok(m.ruleViolations("짧게 씁니다. 그래서 됩니다요. 끝.", "google").length === 0, "정상 글에 오탐");
  assert.ok(m.ruleViolations("좋아요 😊 한 개", "instagram").length === 0, "인스타 이모지 1개는 허용");
  console.log("ruleViolations 통과");
}
