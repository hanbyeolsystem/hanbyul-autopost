"""올린 영상의 조회수를 모아 후킹 유형별로 비교한다.
   사장님 지시(2026-09-19): 처음엔 무작위로 올리되, 조회수를 보고 잘 먹힌 쪽으로 좁혀 간다.

  python 성과.py            조회수 새로 읽고 유형별 성적 보기
  python 성과.py --추천     다음에 어느 후킹 유형을 밀지 계산

읽는 법
  유튜브는 공개 시청 페이지에 조회수가 들어 있다(로그인·API 키 없이 읽는다).
  인스타·쓰레드 조회수는 계정 안에서만 보여서 여기 숫자는 유튜브 기준이다.
  편수가 적을 때(유형당 3편 미만)는 순위를 믿지 말 것. 그래서 표에 편수를 같이 적는다.
"""
import argparse, json, re, urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "완성본"
LOG = ROOT / "발행기록.json"
STATS = ROOT / "성과.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
TYPE_NAME = {"loss": "손실 회피", "myth": "통념 깨기", "number": "숫자 선공개",
             "target": "타깃 저격", "save": "저장 유도"}


def views(video_id):
    req = urllib.request.Request(f"https://www.youtube.com/watch?v={video_id}", headers={"User-Agent": UA})
    try:
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    except Exception as e:
        return None, f"못 읽음({e})"
    m = re.search(r'"viewCount":\s*"(\d+)"', html)
    return (int(m.group(1)), "") if m else (None, "조회수 항목을 못 찾음")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--추천", action="store_true")
    a = ap.parse_args()

    if not LOG.exists():
        print("아직 올린 영상이 없다")
        return
    log = json.loads(LOG.read_text("utf-8"))
    metas = {p.stem: json.loads(p.read_text("utf-8")) for p in OUT.glob("*.json")}

    rows, by_type = [], defaultdict(list)
    for slug, rec in log.items():
        vid = (rec.get("youtube") or {}).get("id")
        if not vid:
            continue
        n, note = views(vid)
        hook = metas.get(slug, {}).get("hook_type", "-")
        rows.append((slug, hook, n, rec["at"][:10], note))
        if n is not None:
            by_type[hook].append(n)

    rows.sort(key=lambda r: (r[2] is None, -(r[2] or 0)))
    print(f"{'사례':34s} {'후킹':10s} {'조회수':>8s}  올린날")
    for slug, hook, n, at, note in rows:
        print(f"  {slug:32s} {TYPE_NAME.get(hook, hook):10s} {(n if n is not None else '-'):>8}  {at} {note}")

    print("\n후킹 유형별 (편수가 3편 미만이면 아직 판단 금물)")
    rank = []
    for t, v in by_type.items():
        avg = sum(v) / len(v)
        rank.append((avg, t, len(v)))
        print(f"  {TYPE_NAME.get(t, t):10s} 평균 {avg:8.0f}회  {len(t and v):2d}편  최고 {max(v)}")
    rank.sort(reverse=True)

    STATS.write_text(json.dumps({"rows": rows, "by_type": {k: v for k, v in by_type.items()}},
                                ensure_ascii=False, indent=2), "utf-8")
    if a.추천:
        solid = [r for r in rank if r[2] >= 3]
        if not solid:
            print("\n아직 유형별 3편이 안 찼다. 그대로 무작위로 더 올릴 것.")
        else:
            best = solid[0]
            print(f"\n다음 회차 추천: '{TYPE_NAME.get(best[1], best[1])}' 유형을 두 배로 쓰고,"
                  f" 꼴찌 유형은 문구를 바꿔서 다시 시험할 것.")


if __name__ == "__main__":
    main()
