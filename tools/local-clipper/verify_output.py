#!/usr/bin/env python3
"""Technical QA gate for a locally rendered short video.

Checks structure and optionally audio level; never claims a clip is meaningful,
compliant or suitable to publish. Requires ffprobe; ffmpeg for audio analysis.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
from pathlib import Path


def check_metadata(data: dict, *, max_seconds: float = 180.0) -> dict:
    video = next((x for x in data.get('streams', []) if x.get('codec_type') == 'video'), None)
    audio = next((x for x in data.get('streams', []) if x.get('codec_type') == 'audio'), None)
    errors, warnings = [], []
    if video is None:
        errors.append('Missing video track')
        width = height = 0
    else:
        width, height = int(video.get('width') or 0), int(video.get('height') or 0)
        if width < 360 or height < 640 or abs(width / max(height, 1) - 9 / 16) > 0.025:
            errors.append('Video is not suitable 9:16 vertical output')
        if video.get('codec_name') != 'h264':
            warnings.append('Video codec is not H.264')
    try:
        duration = float(data.get('format', {}).get('duration', 0))
    except (TypeError, ValueError):
        duration = 0.0
    if not math.isfinite(duration) or duration <= 0 or duration > max_seconds:
        errors.append(f'Video duration outside 0–{max_seconds:g} seconds')
    if audio is None:
        errors.append('Missing audio track: manual review required')
    elif audio.get('codec_name') != 'aac':
        warnings.append('Audio codec is not AAC')
    return {
        'passed_technical_checks': not errors,
        'video_width': width,
        'video_height': height,
        'duration_seconds': round(duration, 3) if math.isfinite(duration) else None,
        'audio_present': audio is not None,
        'errors': errors,
        'warnings': warnings,
        'editorial_approval': 'NOT_EVALUATED',
    }


def inspect_media(path: Path, *, audio_level: bool = True) -> dict:
    path = path.expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    probe = subprocess.run([
        'ffprobe', '-v', 'error', '-show_entries',
        'stream=codec_type,codec_name,width,height:format=duration',
        '-of', 'json', str(path)
    ], capture_output=True, text=True, check=True)
    result = check_metadata(json.loads(probe.stdout))
    result['file'] = str(path)
    result['file_bytes'] = path.stat().st_size
    if result['audio_present'] and audio_level:
        sound = subprocess.run([
            'ffmpeg', '-hide_banner', '-nostdin', '-i', str(path),
            '-t', '20', '-vn', '-af', 'volumedetect', '-f', 'null', '-'
        ], capture_output=True, text=True)
        match = re.search(r'max_volume:\s*([-\d.]+)\s*dB', sound.stderr)
        if match:
            maximum = float(match.group(1))
            result['opening_max_volume_db'] = maximum
            if maximum < -35:
                result['warnings'].append('First 20 seconds have very quiet audio; listen before approval')
        else:
            result['warnings'].append('Audio loudness could not be measured')
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, help='Optional JSON report destination')
    parser.add_argument('--no-audio-level', action='store_true')
    args = parser.parse_args()
    report = inspect_media(args.input, audio_level=not args.no_audio_level)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding='utf-8')
    print(rendered, end='')
    return 0 if report['passed_technical_checks'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
