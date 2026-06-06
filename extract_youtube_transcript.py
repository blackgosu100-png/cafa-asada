import html
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor" / "python"
if VENDOR.exists():
    sys.path.insert(0, str(VENDOR))

from yt_dlp import YoutubeDL  # noqa: E402
import imageio_ffmpeg  # noqa: E402


KEYWORDS = re.compile(
    r"사장|매출|손님|직원|배달|돈|시간|힘들|메뉴|가게|주방|인건비|장사|문제|운영|창업|식당|고객|리뷰|가격"
)


def clean_text(value):
    value = html.unescape(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\[[^\]]+\]", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def parse_json3(text):
    data = json.loads(text)
    segments = []
    for event in data.get("events", []):
        text_value = "".join(seg.get("utf8", "") for seg in event.get("segs", []))
        cleaned = clean_text(text_value)
        if cleaned:
            segments.append({"start": (event.get("tStartMs") or 0) / 1000, "text": cleaned})
    return segments


def parse_vtt(text):
    segments = []
    blocks = re.split(r"\n\s*\n", text)
    for block in blocks:
        match = re.search(r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,]\d+\s+-->", block)
        if not match:
            continue
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        seconds = int(match.group(3) or 0)
        lines = [
            line
            for line in block.splitlines()
            if line and "-->" not in line and not line.strip().isdigit() and not line.startswith("WEBVTT")
        ]
        cleaned = clean_text(" ".join(lines))
        if cleaned:
            segments.append({"start": hours * 3600 + minutes * 60 + seconds, "text": cleaned})
    return segments


def parse_xml(text):
    segments = []
    for attrs, content in re.findall(r"<text\b([^>]*)>([\s\S]*?)</text>", text):
        start_match = re.search(r'\bstart="([^"]+)"', attrs)
        cleaned = clean_text(content)
        if cleaned:
            segments.append({"start": float(start_match.group(1)) if start_match else 0, "text": cleaned})
    for attrs, content in re.findall(r"<p\b([^>]*)>([\s\S]*?)</p>", text):
        start_match = re.search(r'\bt="([^"]+)"', attrs)
        cleaned = clean_text(content)
        if cleaned:
            segments.append({"start": (float(start_match.group(1)) / 1000) if start_match else 0, "text": cleaned})
    return segments


def fetch_text(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", errors="replace")


def with_format(url, fmt):
    if "fmt=" in url:
        return re.sub(r"([?&])fmt=[^&]+", rf"\1fmt={fmt}", url)
    return url + ("&" if "?" in url else "?") + "fmt=" + fmt


def parse_subtitle_url(url):
    last_error = None
    for fmt in ("json3", "vtt", "srv3", "ttml"):
        try:
            text = fetch_text(with_format(url, fmt))
            if fmt == "json3":
                segments = parse_json3(text)
            elif fmt == "vtt":
                segments = parse_vtt(text)
            else:
                segments = parse_xml(text)
            if segments:
                return segments
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    if last_error:
        raise last_error
    return []


def pick_track(info):
    containers = [info.get("subtitles") or {}, info.get("automatic_captions") or {}]
    preferred_langs = ["ko", "ko-orig", "ko-KR", "en"]
    for captions in containers:
        for lang in preferred_langs:
            if lang in captions and captions[lang]:
                return captions[lang][0], lang
        for lang, tracks in captions.items():
            if tracks:
                return tracks[0], lang
    return None, ""


def seconds_to_time(seconds):
    total = max(0, int(seconds or 0))
    return f"{total // 60}:{total % 60:02d}"


def representative_excerpt(segments, limit=6500):
    picked = []
    for segment in segments:
        if len(picked) < 18 or KEYWORDS.search(segment["text"]):
            picked.append(segment)
        if len(" ".join(item["text"] for item in picked)) > limit:
            break
    seen = set()
    lines = []
    for segment in picked:
        key = segment["text"][:60]
        if key in seen:
            continue
        seen.add(key)
        lines.append(f"[{seconds_to_time(segment['start'])}] {segment['text']}")
    return "\n".join(lines)[:limit]


def transcript_text(segments, limit=12000):
    lines = [f"[{seconds_to_time(segment['start'])}] {segment['text']}" for segment in segments]
    return "\n".join(lines)[:limit]


def pick_scenes(segments, video_url):
    visual_keywords = re.compile(
        r"주방|매장|돈가스|양배추|기계|슬라이스|사용|세척|칼날|시간|단축|오픈|사장|직원|준비"
    )
    source = [
        seg
        for seg in segments
        if len(seg["text"]) >= 12 and (visual_keywords.search(seg["text"]) or KEYWORDS.search(seg["text"]))
    ]
    if len(source) < 15:
        source = [seg for seg in segments if len(seg["text"]) >= 12]

    picked = []
    min_gap = 8
    for seg in source:
        if all(abs(seg["start"] - prev["start"]) >= min_gap for prev in picked):
            picked.append(seg)
        if len(picked) >= 15:
            break

    if len(picked) < 15 and source:
        step = max(1, len(source) // 15)
        for seg in source[::step]:
            if seg not in picked:
                picked.append(seg)
            if len(picked) >= 15:
                break

    return [
        {
            "time": seconds_to_time(seg["start"]),
            "seconds": int(seg["start"]),
            "captureSeconds": round(float(seg["start"]) + 1.5, 1),
            "text": seg["text"],
            "url": f"{video_url}&t={int(seg['start'])}s",
        }
        for seg in picked[:15]
    ]


def pick_video_stream_url(info):
    formats = info.get("formats") or []
    candidates = [
        fmt
        for fmt in formats
        if fmt.get("url")
        and fmt.get("vcodec") != "none"
        and (fmt.get("height") or 0) <= 720
        and (fmt.get("height") or 0) >= 240
    ]
    candidates.sort(key=lambda fmt: ((fmt.get("height") or 0), fmt.get("tbr") or 0), reverse=True)
    if candidates:
        return candidates[0]["url"]
    if info.get("url"):
        return info["url"]
    return ""


def capture_screenshots(info, scenes):
    stream_url = pick_video_stream_url(info)
    if not stream_url or not scenes:
        return scenes

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    video_id = info.get("id") or "youtube"
    output_dir = ROOT / "data" / "youtube_screenshots" / video_id
    output_dir.mkdir(parents=True, exist_ok=True)

    for index, scene in enumerate(scenes, start=1):
        capture_seconds = scene.get("captureSeconds", scene["seconds"])
        output_path = output_dir / f"scene_{index:02d}_{int(capture_seconds):04d}.jpg"
        command = [
            ffmpeg,
            "-y",
            "-ss",
            str(max(0, capture_seconds)),
            "-i",
            stream_url,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            "-vf",
            "scale=960:-1",
            str(output_path),
        ]
        try:
            subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=35, check=True)
            scene["imagePath"] = str(output_path)
            scene["imageUrl"] = f"/data/youtube_screenshots/{video_id}/{output_path.name}"
        except Exception:  # noqa: BLE001
            scene["imageError"] = "캡쳐 실패"
    return scenes


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: extract_youtube_transcript.py <youtube-url>")
    url = sys.argv[1]
    options = {
        "quiet": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["ko", "ko-orig", "en", "all"],
        "extract_flat": False,
    }
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)

    video_url = f"https://www.youtube.com/watch?v={info.get('id')}"
    track, lang = pick_track(info)
    if not track:
        raise RuntimeError("yt-dlp가 사용할 수 있는 자막을 찾지 못했습니다.")

    segments = parse_subtitle_url(track["url"])
    if not segments:
        raise RuntimeError("yt-dlp 자막 URL은 찾았지만 읽을 수 있는 문장이 없습니다.")

    scenes = capture_screenshots(info, pick_scenes(segments, video_url))
    result = {
        "ok": True,
        "videoId": info.get("id"),
        "title": info.get("title") or "",
        "author": info.get("channel") or info.get("uploader") or "",
        "language": lang,
        "source": (
            f"유튜브 영상 제목: {info.get('title') or ''}\n"
            f"채널: {info.get('channel') or info.get('uploader') or ''}\n"
            f"URL: {video_url}\n\n"
            f"카페글 소스로 쓸 대본\n"
            f"{transcript_text(segments)}\n\n"
            "참고: 위 내용은 카페 원고 소재화를 위한 유튜브 자막입니다. "
            "그대로 복붙하지 말고 사장님 고충/운영 인사이트로 바꿔 써야 합니다."
        ),
        "sceneCandidates": scenes,
        "warning": "yt-dlp로 자막을 추출했고 장면 후보를 캡쳐했습니다. 캡쳐 이미지는 저작권 이슈가 있어 내부 참고용으로만 쓰는 것을 권장합니다.",
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
