#!/usr/bin/env python3
"""Read-only local-video triage for the POSTZ clipper pilot.

No network, API credentials, social publishing, transcription or re-encoding.
Treats short verticals as review candidates, not proven finished creatives.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path


def classify_probe(probe: dict) -> dict:
    streams = probe.get('streams') or []
    video = next((s for s in streams if s.get('codec_type') == 'video'), None)
    audio = next((s for s in streams if s.get('codec_type') == 'audio'), None)
    if not video:
        raise ValueError('Arquivo sem faixa de vídeo.')
    width = int(video.get('width') or 0)
    height = int(video.get('height') or 0)
    duration = float(probe.get('format', {}).get('duration') or 0)
    if width <= 0 or height <= 0 or not math.isfinite(duration) or duration <= 0:
        raise ValueError('Dimensões ou duração inválidas.')
    short_vertical = height > width and duration <= 60
    notes = []
    if short_vertical:
        notes.append('Vídeo vertical curto: revisar se já está editado antes de recortar.')
    else:
        notes.append('Possível fonte para clipagem; requer análise de fala e contexto.')
    if not audio:
        notes.append('Sem áudio: transcrição de fala indisponível.')
    if video.get('codec_name') != 'h264':
        notes.append('Codec diferente de H.264: conferir compatibilidade da publicação.')
    return {
        'width': width, 'height': height,
        'duration_seconds': round(duration, 3),
        'aspect_ratio': round(width / height, 4),
        'video_codec': video.get('codec_name'),
        'audio_codec': audio.get('codec_name') if audio else None,
        'category': 'short_vertical_review' if short_vertical else 'clip_source_review',
        'recommended_action': 'review_before_clipping' if short_vertical else 'review_for_clipping',
        'notes': notes,
    }


def inspect(path: Path) -> dict:
    path = path.expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(str(path))
    process = subprocess.run([
        'ffprobe', '-v', 'error', '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height',
        '-of', 'json', str(path),
    ], check=True, capture_output=True, text=True)
    return {'source': str(path), **classify_probe(json.loads(process.stdout))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = inspect(args.input)
    data = json.dumps(result, indent=2, ensure_ascii=False) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(data, encoding='utf-8')
    print(data, end='')


if __name__ == '__main__':
    main()
