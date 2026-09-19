"""만들어 둔 세로 영상을 유튜브·인스타그램·쓰레드에 올린다.

  python 발행.py --list                  올릴 것과 이미 올린 것 보기
  python 발행.py --next --dry-run        다음 차례가 무엇인지, 무슨 글이 나갈지만 보기
  python 발행.py --next                  다음 차례 1편을 세 곳에 발행
  python 발행.py --slug <사례> --youtube-privacy private   한 편만, 유튜브는 비공개로

발행 순서
  1. 영상을 Supabase Storage(공개)에 올린다. 인스타·쓰레드는 공개 주소여야 받는다.
  2. 유튜브: 재개 가능 업로드 주소를 받아 브라우저 없이 파일을 바로 올린다.
  3. 인스타: 릴스로 올린다(세로 영상).
  4. 쓰레드: 같은 영상 + 짧은 글.
  5. 발행기록.json 에 남긴다. 같은 편이 두 번 나가지 않게 하는 게 이 파일의 역할이다.

검증
  발행 전에 코덱스가 제목·설명·캡션을 본다(python 검증.py). 통과 표시(검증.json)가 없으면
  --force 없이는 발행하지 않는다. 사장님 지시(2026-09-19): 올리기 전에 코덱스가 먼저 본다.
"""
import argparse, json, mimetypes, re, sys, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "완성본"
LOG = ROOT / "발행기록.json"
CHECK = ROOT / "검증.json"
CONSOLE = ROOT.parent / "콘솔" / "hanbyul-autopost-dashboard.html"
API = "https://jrzesjgyrvgvwazfajec.supabase.co/functions/v1/hanbyul-autopost-ai"
KST = timezone(timedelta(hours=9))


def anon_key():
    m = re.search(r"eyJ[A-Za-z0-9_.-]{80,}", CONSOLE.read_text("utf-8", errors="replace"))
    if not m:
        sys.exit("콘솔 HTML 에서 anon 키를 못 찾았다")
    return m.group(0)


KEY = None


def call(path, body=None, method="POST", raw=None, ctype="application/json", timeout=300):
    global KEY
    KEY = KEY or anon_key()
    url = path if path.startswith("http") else API + path
    data = raw if raw is not None else (json.dumps(body or {}).encode() if method != "GET" else None)
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("content-type", ctype)
    if "supabase.co/functions" in url:
        req.add_header("apikey", KEY)
        req.add_header("authorization", "Bearer " + KEY)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            t = r.read().decode("utf-8", "replace")
            return json.loads(t) if t.strip().startswith(("{", "[")) else {"ok": True, "raw": t[:200]}
    except urllib.error.HTTPError as e:
        sys.exit(f"[{url.split('/')[-1]}] {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")


def log_read():
    return json.loads(LOG.read_text("utf-8")) if LOG.exists() else {}


def log_write(d):
    LOG.write_text(json.dumps(d, ensure_ascii=False, indent=2), "utf-8")


def items():
    """만들어 둔 영상 + 글 묶음. 파일 이름 순서대로 올린다."""
    out = []
    for j in sorted(OUT.glob("*.json")):
        mp4 = j.with_suffix(".mp4")
        if mp4.exists():
            out.append((json.loads(j.read_text("utf-8")), mp4))
    return out


def upload_storage(mp4: Path):
    r = call("/media/sign-upload", {"files": [{"ext": "mp4"}]})
    it = r["items"][0]
    call(it["uploadUrl"], method="PUT", raw=mp4.read_bytes(), ctype="video/mp4")
    return it["publicUrl"]


def to_youtube(meta, mp4: Path, privacy="public"):
    r = call("/youtube/start-upload", {
        "title": meta["youtube_title"], "description": meta["youtube_desc"],
        "tags": meta["tags"], "privacy": privacy,
        "sizeBytes": mp4.stat().st_size, "mimeType": "video/mp4",
    })
    done = call(r["uploadUrl"], method="PUT", raw=mp4.read_bytes(), ctype="video/mp4")
    vid = (done or {}).get("id")
    return {"id": vid, "url": f"https://youtu.be/{vid}" if vid else None, "privacy": privacy}


def to_instagram(meta, video_url):
    return call("/publish/instagram", {"caption": meta["instagram_caption"], "videoUrls": [video_url]})


def to_threads(meta, video_url):
    return call("/publish/threads", {"text": meta.get("threads_text") or meta["instagram_caption"][:450],
                                     "videoUrls": [video_url]})


def verified(slug):
    if not CHECK.exists():
        return False
    return json.loads(CHECK.read_text("utf-8")).get(slug, {}).get("ok") is True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--next", action="store_true")
    ap.add_argument("--slug")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="코덱스 검증 없이도 발행")
    ap.add_argument("--youtube-privacy", default="public", choices=["public", "unlisted", "private"])
    ap.add_argument("--only", default="all", choices=["all", "youtube", "instagram", "threads"])
    a = ap.parse_args()

    done = log_read()
    all_items = items()
    if a.list:
        for meta, mp4 in all_items:
            d = done.get(meta["slug"])
            mark = "올림 " + d["at"][:10] if d else ("검증됨 - 대기" if verified(meta["slug"]) else "검증 전")
            print(f"  {meta['slug']:34s} {mark}")
        print(f"\n  전체 {len(all_items)}편 · 올린 것 {len(done)}편 · 남은 것 {len(all_items)-len(done)}편")
        return

    if a.slug:
        todo = [x for x in all_items if x[0]["slug"] == a.slug]
    else:
        todo = [x for x in all_items if x[0]["slug"] not in done][:1]
    if not todo:
        print("올릴 것이 없다. 쇼츠만들기.py 로 더 만들 것")
        return

    meta, mp4 = todo[0]
    if not verified(meta["slug"]) and not a.force:
        sys.exit(f"[중단] {meta['slug']} 는 코덱스 검증을 안 거쳤다. python 검증.py 를 먼저 돌릴 것(--force 로 무시 가능)")

    print(f"■ {meta['slug']}  ({mp4.stat().st_size/1024/1024:.1f}MB)")
    print(f"  유튜브 제목: {meta['youtube_title']}")
    print(f"  인스타 캡션: {meta['instagram_caption'][:70]}…")
    if a.dry_run:
        print("  (보기만 함, 발행 안 함)")
        return

    rec = {"at": datetime.now(KST).isoformat(timespec="seconds")}
    video_url = upload_storage(mp4)
    rec["video"] = video_url
    print(f"  저장소 업로드 완료")

    if a.only in ("all", "youtube"):
        rec["youtube"] = to_youtube(meta, mp4, a.youtube_privacy)
        print(f"  유튜브 {rec['youtube'].get('url') or rec['youtube']}")
    if a.only in ("all", "instagram"):
        rec["instagram"] = to_instagram(meta, video_url)
        print(f"  인스타 {str(rec['instagram'])[:100]}")
    if a.only in ("all", "threads"):
        rec["threads"] = to_threads(meta, video_url)
        print(f"  쓰레드 {str(rec['threads'])[:100]}")

    done[meta["slug"]] = rec
    log_write(done)
    print("발행기록.json 에 남김")


if __name__ == "__main__":
    main()
