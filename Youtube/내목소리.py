"""로컬 내 목소리 스튜디오에서 장면별 음성을 만들고 영상 길이를 맞춘다."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

STUDIO = Path(os.environ.get('HANBYEOL_VOICE_HOME', str(Path.home() / 'LocalApps/MyVoice')))
ADDRESS = 'http://127.0.0.1:7865'
PRESETS = {'기본': (1., .2, 0), '활기차게': (1.12, .12, 35), '차분하게': (.92, .38, 0)}

def ensure_studio():
    def ready():
        try:
            with urllib.request.urlopen(ADDRESS + '/config', timeout=2) as response:
                return response.status == 200
        except (OSError, ValueError):
            return False
    if ready():
        return
    python = STUDIO / '.venv/Scripts/python.exe'
    if not python.exists():
        raise RuntimeError('이 PC에 내 목소리 스튜디오가 없습니다. 먼저 설치해주세요.')
    env = dict(os.environ, PYTHONUTF8='1')
    with (STUDIO / 'server.log').open('a', encoding='utf-8') as out, (STUDIO / 'server-error.log').open('a', encoding='utf-8') as err:
        process = subprocess.Popen([str(python), '-u', str(STUDIO / 'app.py')], cwd=STUDIO, env=env, stdout=out, stderr=err, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    (STUDIO / 'server.pid').write_text(str(process.pid), encoding='utf-8')
    for _ in range(60):
        if ready():
            return
        if process.poll() is not None:
            break
        time.sleep(1)
    raise RuntimeError('내 목소리 스튜디오를 시작하지 못했습니다. 바탕화면 바로가기로 실행해주세요.')

def narrate(texts, minimums, directory, style='기본', fps=30):
    """다른 Python 환경에서도 스튜디오 전용 환경을 통해 호출한다."""
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    request = directory / 'request.json'
    request.write_text(json.dumps({'texts': texts, 'minimums': minimums, 'style': style, 'fps': fps}, ensure_ascii=False), encoding='utf-8')
    python = STUDIO / '.venv/Scripts/python.exe'
    if not python.exists():
        raise RuntimeError('내 목소리 실행 환경을 찾지 못했습니다. 무음 제작은 --no-voice 옵션을 사용하세요.')
    result = subprocess.run([str(python), str(Path(__file__).resolve()), '--worker', str(request)], env=dict(os.environ, PYTHONUTF8='1'), timeout=3600)
    if result.returncode:
        raise RuntimeError('내 목소리 생성에 실패하여 영상 제작을 중단했습니다. 기존 영상은 유지됩니다.')
    data = json.loads((directory / 'result.json').read_text(encoding='utf-8'))
    return Path(data['audio']), data['durations']

def worker(request):
    import numpy as np
    import soundfile as sf
    from gradio_client import Client
    sys.path.insert(0, str(STUDIO))
    from voice_profile import load_profile
    request = Path(request)
    data = json.loads(request.read_text(encoding='utf-8'))
    texts, minimums, style, fps = (data[k] for k in ('texts', 'minimums', 'style', 'fps'))
    if len(texts) != len(minimums) or not texts or style not in PRESETS:
        raise ValueError('장면별 대본과 길이 설정이 맞지 않습니다.')
    saved = load_profile(style) or load_profile()
    if not saved:
        raise RuntimeError('내 목소리 스튜디오에서 목소리를 먼저 등록해주세요.')
    fingerprint = hashlib.sha256(Path(saved[0]).read_bytes() + saved[1].encode()).hexdigest()
    ensure_studio()
    client = Client(ADDRESS, verbose=False)
    durations, audio = [], []
    for i, (text, minimum) in enumerate(zip(texts, minimums)):
        key = hashlib.sha256(json.dumps([text, style, PRESETS[style], fingerprint, 'qwen-0.6b-v1'], ensure_ascii=False).encode()).hexdigest()[:24]
        cached = request.parent / f'{key}.wav'
        if not cached.exists():
            print(f'  내 목소리 {i+1}/{len(texts)} 장면 생성', flush=True)
            result = client.predict(text, style, *PRESETS[style], api_name='/generate')
            import shutil
            shutil.copyfile(result[0], cached)
        wav, rate = sf.read(cached, dtype='float32')
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        if rate != 24000 or not len(wav) or not np.isfinite(wav).all():
            raise RuntimeError('장면 음성 파일을 확인할 수 없습니다.')
        # 장면 경계와 프레임을 맞추고 끝에 최소 0.25초 여유를 둔다.
        duration = math.ceil(max(float(minimum), len(wav)/rate + .25)*fps)/fps
        durations.append(duration)
        audio.append(np.pad(wav, (0, round(duration*rate)-len(wav))))
    destination = request.parent / 'narration.wav'
    sf.write(destination, np.concatenate(audio), 24000, subtype='PCM_16')
    (request.parent / 'result.json').write_text(json.dumps({'audio': str(destination), 'durations': durations, 'style': style, 'texts': texts}, ensure_ascii=False, indent=2), encoding='utf-8')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--worker', required=True)
    worker(parser.parse_args().worker)
