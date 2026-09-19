"""올리기 전에 코덱스가 제목·설명·캡션을 본다. 통과한 것만 발행.py 가 내보낸다.
   (사장님 지시 2026-09-19: 올리기 전에는 코덱스가 먼저 검증해야 한다)

  python 검증.py            아직 안 본 것 전부 검증
  python 검증.py --slug X   한 편만
  python 검증.py --show     결과 보기

무엇을 보게 하나
  1. 사실과 다른 말이 있는가 (사례에 없는 수치·장비·실적을 지어냈는가)
  2. 과장·단정·겁주기가 있는가 (표시광고법에서 걸리는 표현)
  3. 후킹이 첫 3초에 걸리는가, 손님이 "왜 필요한지" 알 수 있는가
  4. 전화번호·주소·사이트 주소가 맞는가
  5. 해시태그·문구가 채널 규칙에 맞는가 (인스타 250자, 쓰레드 450자, 유튜브 제목 100자)
결과는 검증.json 에 {슬러그: {ok, 지적, 확인일}} 로 남는다.
"""
import argparse, json, re, subprocess, sys, glob, os
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "완성본"
CHECK = ROOT / "검증.json"
SITE_CASES = ROOT.parent.parent / "고객용사이트" / "customer" / "src" / "data" / "cases.ts"
KST = timezone(timedelta(hours=9))


def codex_cmd():
    base = sorted(glob.glob(os.path.expanduser("~/.claude/plugins/cache/openai-codex/codex/*/")))
    if not base:
        sys.exit("코덱스 플러그인을 못 찾았다")
    return str(Path(base[-1]) / "scripts" / "codex-companion.mjs")


PROMPT = """한국어로 답해 줘. 파일은 고치지 말고 판정만 해 달라.

한별시스템(대구 IT 업체, 18년) 유튜브 쇼츠·인스타 릴스·쓰레드에 올릴 글이다.
영상은 실제 시공 현장 사진으로 만들었고, 아래 글이 같이 나간다.

== 올라갈 글 ==
[유튜브 제목] {title}
[유튜브 설명]
{desc}
[인스타 캡션]
{insta}
[쓰레드]
{threads}

== 이 글의 근거가 된 사례(원본) ==
{source}

== 회사 확정 사실 (사례에 없어도 이건 써도 된다) ==
대구광역시 달서구 문화회관11안길 22-7 1층 · 053-588-7119 · 2008년 창업 18년차
관리 고객사 500곳 이상 · NAS 구축 100건 이상 · 복사기 설치·운영 300대 이상
네트워크 시공 50개사 이상 · 대구 전역과 경북은 당일 출장 가능(경남은 일정 협의, 전국 1영업일)
흑백 복사기 월 7만원부터 · 컬러 복사기 월 10만원부터 · 데스크탑+모니터 월 4만원부터(VAT 별도)
임대는 토너 등 소모품·부품 교체·출장 수리·분기 점검 포함 · 시놀로지 공식 대리점

다음 5가지만 보고, 마지막 줄에 정확히 `판정: 통과` 또는 `판정: 수정필요` 를 적어 달라.
1. 원본에 없는 사실(수치·장비·실적·지역)을 지어냈는가
2. 과장·단정·겁주기가 있는가 (한국 표시광고법 기준. "무조건", "100%", "최고" 같은 말)
3. 첫 줄이 후킹이 되는가. 손님이 "이게 왜 나한테 필요한지" 알 수 있는가.
   그리고 후킹이 이 사례의 실제 문제와 맞는가(예: RAID 고장 사례에 자료 분산 후킹을 붙이면 안 맞는다)
4. 전화 053-588-7119, 사이트 한별시스템.kr 이 맞게 적혔는가
5. 길이 규칙: 유튜브 제목 100자 이하, 인스타 캡션 300자 이하(해시태그 포함), 쓰레드 450자 이하

지적은 짧게 항목별로. 통과면 "통과" 한 줄이면 된다."""


def source_of(slug):
    """사례 원문을 그대로 붙여 준다. 코덱스가 지어낸 것을 잡으려면 원본이 있어야 한다."""
    t = SITE_CASES.read_text("utf-8", errors="replace")
    i = t.find(f'slug: "{slug}"')
    if i < 0:
        return "(원본을 못 찾음)"
    return t[max(0, i - 200): i + 2200]


def review(meta):
    p = PROMPT.format(title=meta["youtube_title"], desc=meta["youtube_desc"],
                      insta=meta["instagram_caption"],
                      threads=meta.get("threads_text") or meta["instagram_caption"][:450],
                      source=source_of(meta["slug"]))
    r = subprocess.run(["node", codex_cmd(), "task", "--effort", "medium", p],
                       capture_output=True, text=True, encoding="utf-8", timeout=1800)
    out = (r.stdout or "") + (r.stderr or "")
    ok = bool(re.search(r"판정\s*:\s*통과", out))
    tail = out.strip().splitlines()
    return ok, "\n".join(tail[-40:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug")
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--limit", type=int, default=3)
    a = ap.parse_args()

    res = json.loads(CHECK.read_text("utf-8")) if CHECK.exists() else {}
    if a.show:
        for k, v in res.items():
            print(f"  {k:34s} {'통과' if v['ok'] else '수정필요'}  {v['확인일'][:16]}")
        return

    metas = [json.loads(p.read_text("utf-8")) for p in sorted(OUT.glob("*.json"))]
    todo = [m for m in metas if (m["slug"] == a.slug if a.slug else m["slug"] not in res)][: a.limit]
    if not todo:
        print("검증할 것이 없다")
        return

    for m in todo:
        print(f"■ 코덱스 검증 {m['slug']} …")
        ok, note = review(m)
        res[m["slug"]] = {"ok": ok, "지적": note, "확인일": datetime.now(KST).isoformat(timespec="seconds")}
        CHECK.write_text(json.dumps(res, ensure_ascii=False, indent=2), "utf-8")
        print(f"  → {'통과' if ok else '수정필요'}")
        if not ok:
            print("  " + note[-600:].replace("\n", "\n  "))


if __name__ == "__main__":
    main()
