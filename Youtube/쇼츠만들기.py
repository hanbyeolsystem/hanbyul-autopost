"""구축 사례 사진으로 유튜브 쇼츠·인스타 릴스용 세로 영상을 만든다.

  python 쇼츠만들기.py --list                 사례 목록 보기
  python 쇼츠만들기.py --slug <사례>          한 편 만들기
  python 쇼츠만들기.py --all --limit 12       여러 편 만들기

왜 이렇게 만드나
  사장님이 따로 촬영하지 않아도 이미 찍어 둔 현장 사진 108장과 사례 20건이 있다.
  거기서 '어떤 현장 / 무엇이 문제였나 / 무엇을 했나 / 어떻게 됐나'를 그대로 자막으로 올린다.
  문구는 cases.ts 에 적힌 사실만 쓴다. AI 가 새로 지어내지 않는다(없는 사례·수치 금지 규칙).

구성 (약 35초, 1080x1920)
  1 표지      지역·업종 + 제목
  2 문제      challenge 첫 문장
  3~4 조치    solution 앞 두 개
  5 결과      result 첫 문장
  6 끝        한별시스템 · 전화 · 사이트 주소

필요한 것: ffmpeg(설치됨), 글꼴(고객용사이트 public/fonts 의 잘난체·Noto Sans KR)
"""
import argparse, json, random, subprocess, sys, textwrap, shutil, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parent.parent / "고객용사이트" / "customer"
OUT = ROOT / "완성본"
TMP = ROOT / ".작업"
W, H = 1080, 1920
FPS = 30

# 글꼴: 제목은 잘난체, 본문은 Noto Sans KR. 둘 다 사이트가 쓰는 것과 같다.
# ⚠️ ffmpeg(freetype)는 경로에 한글이 있으면 글꼴 파일을 못 연다. 오류도 안 내고 조용히
#    다른 글꼴로 그려서 한글이 전부 네모로 나온다. 그래서 영문 경로(TMP)로 복사해 쓴다.
FONT_SRC = SITE / ".font-src"
FONT_DIR = Path(os.environ.get("TEMP", "C:/Windows/Temp")) / "hbs-fonts"
FONT_TITLE = FONT_DIR / "jalnan.ttf"
FONT_BODY = FONT_DIR / "noto.ttf"


def ready_fonts():
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    for src, dst in ((FONT_SRC / "JalnanGothicTTF.ttf", FONT_TITLE), (FONT_SRC / "NotoSansKR-VF.ttf", FONT_BODY)):
        if not src.exists():
            sys.exit(f"글꼴 원본이 없다: {src} (고객용사이트에서 python scripts/build-core-subset.py 를 한 번 돌리면 받아진다)")
        if not dst.exists() or dst.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dst)

# ─────────────── 후킹 (사장님 2026-09-19 지시) ───────────────
# 릴스·쇼츠는 첫 1초에 손가락을 멈춰 세워야 한다. 다섯 가지 유형을 업종마다 준비해 두고
# 무작위로 하나를 쓴 뒤, 어떤 유형을 썼는지 기록한다(meta 의 hook_type). 나중에 조회수와
# 대조해서 잘 먹힌 유형만 남기려는 것이다.
#   loss   손실 회피·금지형   - 지금 손해 보고 있나 하는 불안
#   myth   통념 파괴형        - 다들 맞다고 믿는 것을 뒤집기
#   number 결과 선공개·숫자형 - 얻을 것을 1초 안에 확정
#   target 타깃 저격형        - "내 얘기네" 착각
#   save   저장 유도형        - 지금 못 보면 아까운 정보
#
# ⚠️ 지키는 선: 문구는 전부 사실이어야 한다. "업계가 숨기는 진실", "나중에 지울게요" 같은
#    거짓 희소성·근거 없는 폭로는 쓰지 않는다(표시광고법·신뢰). 확정 수치만 쓴다
#    (18년 · 거래처 500곳↑ · NAS 100건↑ · 복사기 300대↑ · 흑백 월 7만원부터 · 컬러 월 10만원부터
#     · PC+모니터 월 4만원부터 · 대구·경북 당일 출장 가능).
# 첫 줄은 10단어 이내. 소리 없이 보는 사람이 많아 화면 위쪽에 크게 박는다.
# 맨 끝 항목은 "이 후킹이 어울리는 사례"를 가리는 말들이다. 비어 있으면 그 업종 아무 사례에나 쓴다.
# (코덱스 2026-09-19 지적: 무작위로 붙이면 자료 분산 후킹이 RAID 고장 사례에 붙어 말이 안 맞는다)
HOOKS = {
    "nas": [
        ("loss", "외장하드 하나만 믿고 계신가요", "외장하드도 고장 납니다", "그래서 사본을 두 벌 두고 한 벌은 따로 보관합니다", ["외장", "백업", "복구", "USB", "하드"]),
        ("myth", "클라우드면 안전하다고들 합니다", "회사 자료는 얘기가 다릅니다", "용량이 늘수록 매달 나가는 돈도 같이 늘어납니다", ["클라우드", "구독", "드라이브", "이관"]),
        ("number", "자료 한 곳에 모으셨나요", "흩어져 있으면 찾기부터 오래 걸립니다", "한 곳에 모아 두면 찾기도 관리도 수월해집니다", []),
        ("target", "자료가 직원 PC마다 흩어져 있다면", "이 영상이 그 얘기입니다", "한 곳에 모으면 누가 어떤 파일을 가졌는지 찾기 쉬워집니다", ["흩어", "분산", "공유", "폴더", "권한"]),
        ("loss", "하드디스크는 언젠가 고장 납니다", "RAID 는 백업이 아닙니다", "RAID 를 걸어 놔도 사본은 따로 둬야 합니다", ["RAID", "레이드", "고장", "장애", "복구", "디스크"]),
        ("save", "대구에서 NAS 맡길 곳 찾는다면", "저장해 두세요", "구축 실적 100건 이상, 대구·경북은 당일 출장이 가능합니다", []),
    ],
    "printer": [
        ("loss", "복합기 쓰면서 토너 따로 사고 계신가요", "그만큼 매달 더 나갑니다", "임대는 토너·부품·출장 수리가 월 요금에 들어 있습니다", ["토너", "소모품", "비용", "임대"]),
        ("myth", "복합기는 기종부터 고르죠", "그게 순서가 아닙니다", "고장 났을 때 누가 얼마나 빨리 오는지를 먼저 봅니다", []),
        ("number", "흑백 복사기 월 7만원부터", "토너·부품·출장 수리 포함", "월 출력량에 맞는 기종을 고르면 임대료가 내려갑니다", []),
        ("target", "복합기 고장에 하루 날려 보셨다면", "이 영상 보세요", "대구 전역은 당일 출장이 가능합니다", ["고장", "수리", "걸림", "멈", "잼", "교체"]),
        ("save", "대구 복합기 임대 알아보신다면", "저장해 두세요", "설치·운영 300대 이상, 월 임대료는 사이트에 그대로 적어 뒀습니다", []),
    ],
    "pc": [
        ("loss", "사무실 컴퓨터 비싼 거 사지 마세요", "문서 작업엔 그 성능 안 씁니다", "하는 일에 맞추면 값이 내려갑니다", ["사양", "조립", "성능", "구매"]),
        ("myth", "컴퓨터는 사야 한다고 생각하시죠", "렌탈이 나은 경우가 있습니다", "고장 수리가 월 요금에 들어 있어 수리 기사를 따로 찾지 않아도 됩니다", ["렌탈", "임대", "구매"]),
        ("number", "데스크탑+모니터 월 4만원부터", "설치·세팅·고장 수리 포함", "사무실 전용이고 사양은 하는 일에 맞춰 정합니다", []),
        ("target", "컴퓨터 새로 살까 고민 중이라면", "이것부터 보세요", "쓰는 프로그램을 먼저 정하면 사양이 정해집니다", []),
        ("save", "사무실 PC 견적 받아 보신다면", "저장해 두세요", "대구·경북은 당일 출장이 가능합니다", []),
    ],
    "network": [
        ("loss", "공유기 하나로 버티고 계신가요", "사무실이 커지면 먼저 막힙니다", "선과 장비는 처음에 잡아야 나중에 헤매지 않습니다", ["공유기", "속도", "끊", "느리", "와이파이"]),
        ("myth", "인터넷 느리면 통신사 탓 같죠", "사무실 안이 문제일 때가 많습니다", "배선과 장비 구성부터 봐야 원인이 나옵니다", ["느리", "끊", "속도", "장애"]),
        ("number", "랜선은 벽 뜯기 전에 잡아야 합니다", "배선·공유기·공유폴더 한 번에", "이사나 입주 전에 하면 선정리가 깔끔해집니다", ["배선", "랜", "공사", "시공"]),
        ("target", "사무실 옮기실 예정이라면", "인테리어 끝나기 전에 보세요", "전원과 랜선 자리를 같이 잡아야 합니다", ["이전", "이사", "입주", "신축", "확장"]),
        ("save", "대구 사무실 네트워크 공사 찾는다면", "저장해 두세요", "대구·경북 중심으로 50개사 이상 시공했습니다", []),
    ],
    "etc": [
        ("loss", "전산 업체 따로따로 부르고 계신가요", "문제 생기면 서로 떠넘깁니다", "컴퓨터·복합기·네트워크를 한 회사가 맡으면 책임이 갈리지 않습니다", []),
        ("target", "대구에서 전산 맡길 곳 찾는다면", "이 영상 보세요", "관리 고객사 500곳 이상, 18년째 같은 자리에서 합니다", []),
        ("save", "전산 유지관리 알아보신다면", "저장해 두세요", "원격으로 먼저 보고 안 되면 그날 갑니다", []),
    ],
}

PHONE = "053-588-7119"
SITE_TEXT = "한별시스템.kr"


def ff(*args, quiet=True):
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error" if quiet else "info", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"[ffmpeg 실패] {' '.join(str(a) for a in args)[:200]}\n{r.stderr[-800:]}")


def cases():
    """cases.ts 를 그대로 읽는다(node 가 타입만 떼고 실행한다)."""
    js = (
        "import('file://" + str(SITE / "src/data/cases.ts").replace("\\", "/") + "')"
        ".then(m=>console.log(JSON.stringify(m.caseStudies)))"
    )
    r = subprocess.run(["node", "--experimental-strip-types", "-e", js],
                       capture_output=True, text=True, encoding="utf-8", cwd=SITE)
    if r.returncode != 0:
        sys.exit(f"cases.ts 를 못 읽었다\n{r.stderr[-500:]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


# 광고에 쓰면 곤란한 말. 사례 원문에 있어도 쇼츠 자막·캡션에서는 그 문장을 피한다.
# (코덱스 2026-09-19 지적: "플래그십 라인"은 최상위 제품군으로 오인할 소지가 있다)
AVOID = ("플래그십", "최고", "최상", "최적", "업계 1위", "1위", "무조건", "100%", "완벽", "절대")


def split_sentences(s):
    s = " ".join(s.split())
    out, cur = [], ""
    for ch in s:
        cur += ch
        if ch in ".!?" and len(cur.strip()) > 8:
            out.append(cur.strip())
            cur = ""
    if cur.strip():
        out.append(cur.strip())
    return out


def first_sentence(s, limit=60):
    """쓸 만한 첫 문장. 최상급·단정 표현이 든 문장은 건너뛴다. 자막은 짧아야 읽힌다."""
    sents = split_sentences(s)
    clean = [x for x in sents if not any(w in x for w in AVOID)]
    for x in (clean or sents):
        if len(x) <= limit + 25:
            return x
    return textwrap.shorten((clean or sents)[0], width=limit, placeholder="…")


def wrap(s, per_line):
    return "\n".join(textwrap.wrap(s, width=per_line)) or " "


def esc(p: Path):
    """ffmpeg 필터에 넣는 윈도우 경로: 역슬래시와 콜론을 피한다."""
    return str(p).replace("\\", "/").replace(":", "\\:")


def textfile(name: str, s: str) -> Path:
    """자막은 파일로 넘긴다(따옴표·쉼표 escape 지옥을 피한다). 경로도 영문 폴더에 둔다."""
    p = FONT_DIR / f"txt-{name}.txt"
    p.write_text(s, "utf-8")
    return p


def clean_items(items):
    """최상급·단정 표현이 든 항목은 아예 후보에서 뺀다(문장 하나뿐이면 건너뛸 데가 없어서)."""
    out = [x for x in items if not any(w in x for w in AVOID)]
    return out or items


def pick_hook(case):
    """사례에 맞는 후킹을 고른다. 맞는 게 여럿이면 무작위(사례마다 고정)로 하나.
    맞는 게 없으면 그 업종 아무 데나 써도 되는 후킹(가리는 말이 빈 것) 중에서 고른다.
    무작위는 유형별 성적을 보려는 것이고, '맞는지'가 무작위보다 먼저다."""
    pool = HOOKS.get(case["category"], HOOKS["etc"])
    hay = " ".join([case["title"], case["challenge"], " ".join(case.get("tags", []))])
    fitted = [h for h in pool if h[4] and any(k in hay for k in h[4])]
    general = [h for h in pool if not h[4]]
    cand = fitted or general or pool
    h = cand[random.Random(case["slug"]).randrange(len(cand))]
    return h[0], h[1], h[2], h[3]


def hook_filter(idx: int, line1: str, line2: str, dur: float, accent="0xFFD34D"):
    """첫 장면. 소리 없이 보는 사람을 위해 화면 위쪽 1/3 에 큰 자막을 1초 안에 띄우고,
    정지 화면이면 바로 넘기므로 스냅 줌으로 움직임을 준다(사장님 2026-09-19 지시)."""
    t, b = textfile(f"t{idx}", line1), textfile(f"b{idx}", line2)
    # ⚠️ zoompan 의 d 는 "입력 한 장을 몇 프레임으로 늘릴까"다. 루프 입력(이미 96프레임)에
    #    d=96 을 주면 96×96 프레임이 나와 영상이 287초가 된다(실측). 반드시 d=1 로 두고
    #    출력 프레임 번호(on)로 배율을 정한다. 0.5초 동안 1.14배에서 1.0배로 당겨 붙는다.
    snap = int(FPS * 0.5)
    zoom = (f"zoompan=z='if(lte(on,{snap}),1.14-0.14*on/{snap},1.0)':d=1:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS}")
    return (
        f"[{idx}:v]scale={int(W*1.3)}:{int(H*1.3)}:force_original_aspect_ratio=increase,"
        f"crop={int(W*1.15)}:{int(H*1.15)},{zoom},scale={W}:{H},setsar=1,"
        f"drawbox=x=0:y=0:w={W}:h={int(H*0.42)}:color=black@0.62:t=fill,"
        f"drawtext=fontfile='{esc(FONT_TITLE)}':textfile='{esc(t)}':"
        f"fontcolor={accent}:fontsize=74:line_spacing=16:x=(w-text_w)/2:y={int(H*0.08)}:text_align=C,"
        f"drawtext=fontfile='{esc(FONT_BODY)}':textfile='{esc(b)}':"
        f"fontcolor=white:fontsize=54:line_spacing=20:x=(w-text_w)/2:y={int(H*0.28)}:text_align=C[v{idx}]"
    )


def scene_filter(idx: int, title: str, body: str, is_end=False, accent="0xE8B94A"):
    """장면 하나의 필터 문자열. 사진을 세로 화면에 꽉 채우고 아래를 어둡게 깔아 글자를 읽히게 한다."""
    t, b = textfile(f"t{idx}", title), textfile(f"b{idx}", body)
    base = "" if is_end else (
        f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,"
        f"drawbox=x=0:y={int(H*0.50)}:w={W}:h={int(H*0.50)}:color=black@0.64:t=fill,"
    )
    if is_end:
        return (
            f"[{idx}:v]setsar=1,"
            f"drawtext=fontfile='{esc(FONT_TITLE)}':textfile='{esc(t)}':fontcolor=white:fontsize=96:"
            f"x=(w-text_w)/2:y={int(H*0.34)}:text_align=C,"
            f"drawtext=fontfile='{esc(FONT_BODY)}':textfile='{esc(b)}':fontcolor={accent}:fontsize=60:"
            f"line_spacing=30:x=(w-text_w)/2:y={int(H*0.46)}:text_align=C[v{idx}]"
        )
    return (
        f"[{idx}:v]{base}"
        f"drawtext=fontfile='{esc(FONT_TITLE)}':textfile='{esc(t)}':"
        f"fontcolor={accent}:fontsize=60:line_spacing=14:x=(w-text_w)/2:y={int(H*0.555)}:text_align=C,"
        f"drawtext=fontfile='{esc(FONT_BODY)}':textfile='{esc(b)}':"
        f"fontcolor=white:fontsize=50:line_spacing=22:x=(w-text_w)/2:y={int(H*0.645)}:text_align=C[v{idx}]"
    )


def build(case, quiet=True):
    """한 번의 ffmpeg 호출로 만든다. 조각 mp4 를 만들어 이어 붙이면 파일이 잘려 나왔다."""
    OUT.mkdir(exist_ok=True)

    imgs = [SITE / "public" / p.lstrip("/") for p in case["images"]]
    imgs = [p for p in imgs if p.exists()]
    if not imgs:
        return None
    pick = lambda i: imgs[min(i, len(imgs) - 1)]
    kind, line1, line2, why = pick_hook(case)
    case["_hook"] = {"type": kind, "line1": line1, "line2": line2, "why": why}

    # 0~1초 후킹(화면 위쪽·스냅 줌) → 왜 필요한지 → 현장 기록으로 증명 → 연락처.
    # 현장 문구는 cases.ts 에 적힌 사실 그대로 쓴다. 후킹·이유 문구만 우리가 쓴 일반론이다.
    HOOK_SEC = 3.2
    scenes = [
        (pick(1), "그래서 필요합니다", wrap(why, 15), 4.6),
        (pick(1), f"{case['region']} {case['industry']}", wrap(first_sentence(case["challenge"], 52), 15), 5.8),
    ]
    for i, step in enumerate(clean_items(case["solution"])[:2]):
        scenes.append((pick(i + 2), f"한 일 {i + 1}", wrap(first_sentence(step, 48), 15), 5.4))
    scenes.append((pick(len(imgs) - 1), "그래서", wrap(first_sentence(case["result"], 52), 15), 5.6))

    END = 4.0
    total = HOOK_SEC + sum(s[3] for s in scenes) + END

    # 0번 입력 = 후킹 장면(첫 사진, 스냅 줌)
    args = ["-loop", "1", "-t", f"{HOOK_SEC}", "-i", str(pick(0))]
    filters = [hook_filter(0, wrap(line1, 11), wrap(line2, 15), HOOK_SEC)]
    labels = ["[v0]"]
    for i, (img, title, body, dur) in enumerate(scenes, start=1):
        args += ["-loop", "1", "-t", f"{dur}", "-i", str(img)]
        filters.append(scene_filter(i, title, body))
        labels.append(f"[v{i}]")
    e = len(scenes) + 1   # 후킹 장면이 0번이라 끝 장면은 장면 수 + 1
    args += ["-f", "lavfi", "-t", f"{END}", "-i", f"color=c=0x06354F:s={W}x{H}:r={FPS}"]
    filters.append(scene_filter(e, "한별시스템", f"{PHONE}\n{SITE_TEXT}\n대구·경북 당일 출장", is_end=True))
    labels.append(f"[v{e}]")
    # 인스타 릴스는 소리 트랙이 없으면 거부될 때가 있어 무음 트랙을 넣는다. 음악은 저작권 때문에 안 넣는다.
    args += ["-f", "lavfi", "-t", f"{total}", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]

    graph = ";".join(filters) + ";" + "".join(labels) + f"concat=n={len(labels)}:v=1:a=0[v]"
    out = OUT / f"{case['slug']}.mp4"
    ff(*args, "-filter_complex", graph, "-map", "[v]", "-map", f"{e + 1}:a",
       "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
       "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
       "-movflags", "+faststart", str(out), quiet=quiet)
    return out


def meta(case):
    """유튜브 제목·설명·태그와 인스타·쓰레드 글. 사실만 쓴다.
    첫 줄은 영상과 같은 후킹으로 시작한다(피드에서 글만 보는 사람도 멈추게)."""
    h = case.get("_hook") or {"type": "-", "line1": "", "line2": "", "why": ""}
    url = f"https://한별시스템.kr/cases/{case['slug']}"
    title = f"{h['line1']} | {case['region']} {case['title'].split(' - ')[-1]}"[:100]
    desc = (
        f"{h['line1']} {h['line2']}\n{h['why']}\n\n"
        f"{case['region']} {case['industry']} 현장입니다.\n"
        f"{first_sentence(case['challenge'], 90)}\n"
        + "".join(f"- {first_sentence(s, 70)}\n" for s in clean_items(case["solution"])[:3])
        + f"\n{first_sentence(case['result'], 90)}\n\n"
        f"투입 장비: {', '.join(case['gear'][:4])}\n"
        f"자세한 기록: {url}\n"
        f"문의 {PHONE} (대구·경북 당일 출장 가능)\n"
    )
    tags = list(dict.fromkeys(case["tags"] + [case["region"], "한별시스템", "대구"]))[:12]
    hash_ = " ".join("#" + t.replace(" ", "") for t in tags[:10])
    # 인스타는 250자 안팎(해시태그 제외). 첫 줄이 후킹이라 미리보기에서 잘려도 손이 멈춘다.
    did = " / ".join(first_sentence(s, 34) for s in clean_items(case["solution"])[:2])
    insta = (
        f"{h['line1']}\n{h['line2']}\n\n"
        f"{h['why']}\n\n"
        f"[{case['region']} {case['industry']}]\n"
        f"{first_sentence(case['challenge'], 48)}\n"
        f"한 일: {did}\n"
        f"{first_sentence(case['result'], 44)}\n\n"
        f"문의 {PHONE} · 프로필 링크에 현장 기록 전부\n\n{hash_}"
    )
    if len(insta) > 295:
        insta = insta[:292].rstrip() + "…"
    threads = (
        f"{h['line1']} {h['line2']}\n\n{h['why']}\n\n"
        f"{case['region']} {case['industry']} 현장 기록입니다.\n"
        f"{first_sentence(case['result'], 60)}\n\n{url}\n{PHONE}"
    )[:450]
    return {"slug": case["slug"], "hook_type": h["type"], "hook_line": f"{h['line1']} {h['line2']}",
            "youtube_title": title[:100], "youtube_desc": desc, "tags": tags,
            "instagram_caption": insta, "threads_text": threads, "case_url": url}


def main():
    ready_fonts()
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, default=99)
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    cs = cases()
    if a.list:
        for c in cs:
            print(f"  {c['slug']:36s} 사진 {len(c['images'])}장  {c['region']} {c['industry']}")
        return
    targets = [c for c in cs if c["slug"] == a.slug] if a.slug else (cs[: a.limit] if a.all else cs[:1])
    if not targets:
        sys.exit("그 사례를 못 찾았다. --list 로 확인할 것")

    made = []
    for c in targets:
        p = build(c)
        if not p:
            print(f"  건너뜀(사진 없음) {c['slug']}")
            continue
        m = meta(c)
        (OUT / f"{c['slug']}.json").write_text(json.dumps(m, ensure_ascii=False, indent=2), "utf-8")
        size = p.stat().st_size / 1024 / 1024
        dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                              "-of", "default=nw=1:nk=1", str(p)], capture_output=True, text=True).stdout.strip()
        print(f"  만듦 {p.name}  {float(dur):.0f}초 {size:.1f}MB")
        made.append(p)
    print(f"\n완성본 {len(made)}편 → {OUT}")


if __name__ == "__main__":
    main()
