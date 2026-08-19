// 한별광고 → 인스타그램 발행 브릿지
//
// 왜 이 함수가 따로 있는가:
//   Meta 개발자 앱(직접 토큰)이 아직 없어서, 이미 승인된 Make 연결을 경유해 인스타에 올린다.
//   Make 웹훅 URL 은 공개되면 누구나 사장님 인스타에 글을 올릴 수 있으므로 절대 프론트에 두지 않고
//   이 함수(서버) 안에만 둔다. 시크릿 MAKE_IG_WEBHOOK 이 있으면 그것을 우선 사용.
//
// 나중에 META_PAGE_TOKEN·META_IG_USER_ID 가 발급되면 hanbyul-autopost-ai 의 /publish/instagram
// (직접 Graph API)으로 되돌리고 이 함수는 폐기하면 된다.
//
// 요청:  POST { caption: string, imageUrls: string[] }
// 응답:  { ok: true, id, url, via:"make" } | { ok:false, error }

const MAKE_IG_WEBHOOK = Deno.env.get("MAKE_IG_WEBHOOK") || "__MAKE_WEBHOOK_URL__";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  if (req.method === "GET" || url.pathname.endsWith("/health")) {
    return json({ ok: true, configured: !!MAKE_IG_WEBHOOK && !MAKE_IG_WEBHOOK.startsWith("__"), via: "make" });
  }
  if (req.method !== "POST") return json({ ok: false, error: "POST 만 지원합니다." }, 405);

  if (!MAKE_IG_WEBHOOK || MAKE_IG_WEBHOOK.startsWith("__")) {
    return json({ ok: false, error: "MAKE_IG_WEBHOOK 이 설정되지 않았습니다." }, 500);
  }

  let body: { caption?: string; imageUrls?: string[]; image_url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON 본문이 필요합니다." }, 400);
  }

  const img = body.image_url || (body.imageUrls || [])[0];
  if (!img) {
    return json({ ok: false, error: "인스타 발행은 공개 URL 사진이 1장 이상 필요합니다(영상은 직접연동 필요)." }, 400);
  }

  let r: Response;
  try {
    r = await fetch(MAKE_IG_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image_url: img, caption: (body.caption || "").slice(0, 2200) }),
    });
  } catch (e) {
    return json({ ok: false, error: `Make 호출 실패: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  const txt = await r.text();
  if (!r.ok) return json({ ok: false, error: `Make ${r.status}: ${txt.slice(0, 500)}` }, 502);

  let id = "";
  try { id = JSON.parse(txt)?.post_id || ""; } catch { /* Accepted 같은 평문 응답 */ }
  return json({ ok: true, id, url: "https://www.instagram.com/", via: "make", raw: txt.slice(0, 200) });
});
