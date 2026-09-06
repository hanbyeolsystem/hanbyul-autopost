// 구글 블로거 발행글 제자리 수정 — URL 을 보존한 채 본문/제목/라벨만 고친다.
// 인증: x-hb-key 헤더를 app_config.blogger_publish_key 와 대조 (blogger-publish 와 동일, verify_jwt=false 사유).
// PATCH 를 쓰므로 넘긴 필드만 바뀌고 퍼머링크는 그대로 유지된다.
// 사용: POST { postId, html?, title?, labels? }  ·  조회만 하려면 { postId, read: true } (초안도 읽음, view=ADMIN)
//       삭제: { postId, delete: true } — 초안·테스트 글 정리용. 되돌릴 수 없으니 호출 쪽에서 확인할 것.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN")!;
const GOOGLE_BLOG_ID = Deno.env.get("GOOGLE_BLOG_ID")!;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

const REST_HEADERS = { apikey: SERVICE_KEY, authorization: "Bearer " + SERVICE_KEY, "content-type": "application/json" };

async function expectedKey(): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/app_config?key=eq.blogger_publish_key&select=value`, { headers: REST_HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.value ?? null;
}

async function accessToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("google token error");
  return d.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const expect = await expectedKey();
  if (!expect || req.headers.get("x-hb-key") !== expect) return json({ error: "unauthorized" }, 401);

  let p: { postId?: string; title?: string; html?: string; labels?: string[]; read?: boolean; delete?: boolean };
  try {
    p = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!p.postId) return json({ error: "postId required" }, 400);

  try {
    const token = await accessToken();
    const base = `https://www.googleapis.com/blogger/v3/blogs/${GOOGLE_BLOG_ID}/posts/${p.postId}`;

    if (p.delete) {
      const r = await fetch(base, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
      if (!r.ok) return json({ error: "delete failed", status: r.status, detail: await r.text() }, 502);
      return json({ ok: true, deleted: p.postId });
    }

    if (p.read) {
      // view=ADMIN 이어야 초안(draft)도 읽힌다. 없으면 초안은 404.
      const r = await fetch(base + "?view=ADMIN", { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (!r.ok) return json({ error: "read failed", status: r.status, detail: d }, 502);
      return json({ ok: true, id: d.id, url: d.url, title: d.title, labels: d.labels, content: d.content });
    }

    const patch: Record<string, unknown> = {};
    if (p.title) patch.title = p.title;
    if (p.html) patch.content = p.html;
    if (p.labels) patch.labels = p.labels;
    if (!Object.keys(patch).length) return json({ error: "nothing to update" }, 400);

    const r = await fetch(base, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(patch),
    });
    const d = await r.json();
    if (!r.ok || !d.id) return json({ error: "update failed", status: r.status, detail: d }, 502);
    return json({ ok: true, id: d.id, url: d.url, title: d.title, labels: d.labels });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
