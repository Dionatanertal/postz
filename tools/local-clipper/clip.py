#!/usr/bin/env python3
"""Local, approval-first clipping pilot for the POSTZ repository.

This tool does not modify the running Postiz app, touch its database, or publish.
It transcribes local audio with faster-whisper (optional dependency), picks
promising speech passages using transparent heuristics, and renders vertical
MP4 files using FFmpeg. A transcript JSON can be supplied for offline tests.

No performance/virality prediction is implied by the heuristic score.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

HOOKS = (
    "como", "por que", "porque", "erro", "atenção", "nunca", "você sabia",
    "aprenda", "diferença", "segredo", "exemplo", "importante", "cuidado",
    "vale a pena", "consórcio", "imóvel", "investimento", "planejamento",
)
WEAK_OPENINGS = ("olá pessoal", "oi pessoal", "bom dia pessoal", "se inscreva")


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Candidate:
    start: float
    end: float
    score: float
    segments: tuple[Segment, ...]

    @property
    def text(self) -> str:
        return " ".join(s.text.strip() for s in self.segments).strip()


def require_binary(name: str) -> str:
    result = shutil.which(name)
    if not result:
        raise RuntimeError(f"{name} is required. Install FFmpeg and add it to PATH.")
    return result


def video_duration(source: Path) -> float:
    probe = subprocess.run(
        [require_binary("ffprobe"), "-v", "error", "-show_entries",
         "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
         str(source)],
        capture_output=True, text=True, check=True,
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError as exc:
        raise RuntimeError("Could not read media duration") from exc
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("Input has an invalid duration")
    return duration


def load_transcript(path: Path) -> list[Segment]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("segments") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        raise ValueError("Transcript must be an array or {'segments': [...]} object")
    segments = []
    for row in rows:
        try:
            start, end = float(row["start"]), float(row["end"])
            text = str(row["text"]).strip()
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("Each transcript segment needs start, end and text") from exc
        if not all(math.isfinite(v) for v in (start, end)) or start < 0 or end <= start:
            raise ValueError("Transcript contains invalid timestamps")
        if text:
            segments.append(Segment(start, end, text))
    return sorted(segments, key=lambda s: (s.start, s.end))


def transcribe(source: Path, model_name: str, language: str | None) -> list[Segment]:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "Install transcription support: python -m pip install faster-whisper "
            "(or supply --transcript-json for an existing transcript)."
        ) from exc
    model = WhisperModel(model_name, device="auto", compute_type="int8")
    segments, _ = model.transcribe(str(source), language=language, vad_filter=True)
    return [
        Segment(float(s.start), float(s.end), s.text.strip())
        for s in segments if s.text.strip() and s.end > s.start
    ]


def score_passage(parts: tuple[Segment, ...]) -> float:
    body = " ".join(p.text for p in parts).lower()
    opening = parts[0].text.strip().lower()
    word_count = len(body.split())
    score = min(word_count / 18.0, 5.0)
    score += sum(1.2 for phrase in HOOKS if phrase in body)
    score += 1.5 if "?" in body else 0
    score += 1 if any(c.isdigit() for c in body) else 0
    score -= 2.5 if opening.startswith(WEAK_OPENINGS) else 0
    return round(score, 3)


def pick_clips(
    segments: list[Segment], duration: float, count: int = 3,
    min_seconds: float = 18, max_seconds: float = 55,
) -> list[Candidate]:
    if count < 1 or count > 10:
        raise ValueError("count must be between 1 and 10")
    if min_seconds <= 0 or max_seconds < min_seconds:
        raise ValueError("Invalid duration limits")
    # Short existing Reels are kept usable instead of being rejected.
    minimum = min(min_seconds, max(4.0, duration * 0.6))
    maximum = min(max_seconds, duration)
    candidates: list[Candidate] = []
    usable = [s for s in segments if s.start < duration and s.end > s.start]
    if not usable:
        return []
    for i, first in enumerate(usable):
        parts: list[Segment] = []
        for item in usable[i:]:
            if item.start > duration or item.end > first.start + maximum:
                break
            if parts and item.start - parts[-1].end > 5:
                break
            parts.append(item)
            length = min(item.end, duration) - first.start
            if minimum <= length <= maximum:
                group = tuple(parts)
                candidates.append(Candidate(
                    start=max(0, first.start - 0.15),
                    end=min(duration, item.end + 0.15),
                    score=score_passage(group),
                    segments=group,
                ))
    candidates.sort(key=lambda c: (-c.score, c.start, c.end))
    winners: list[Candidate] = []
    for candidate in candidates:
        # Reject materially overlapping clips; otherwise top-N would repeat.
        if any(
            max(0.0, min(candidate.end, w.end) - max(candidate.start, w.start))
            / max(0.01, min(candidate.end - candidate.start, w.end - w.start)) > 0.35
            for w in winners
        ):
            continue
        winners.append(candidate)
        if len(winners) >= count:
            break
    return sorted(winners, key=lambda c: c.start)


def format_srt_time(seconds: float) -> str:
    ms = max(0, round(seconds * 1000))
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    secs, ms = divmod(ms, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{ms:03}"


def write_srt(candidate: Candidate, destination: Path) -> None:
    # Approximate word timings when Whisper supplies sentence-level segments.
    # For frame-accurate captions a word-alignment engine is needed later.
    entries: list[str] = []
    idx = 1
    for segment in candidate.segments:
        words = segment.text.split()
        if not words:
            continue
        chunks = [words[i:i + 7] for i in range(0, len(words), 7)]
        for n, chunk in enumerate(chunks):
            left = segment.start + (segment.end - segment.start) * n / len(chunks)
            right = segment.start + (segment.end - segment.start) * (n + 1) / len(chunks)
            left = max(0.0, left - candidate.start)
            right = min(candidate.end - candidate.start, right - candidate.start)
            if right <= left:
                continue
            text = " ".join(chunk).replace("<", "").replace(">", "")
            entries.append(
                f"{idx}\n{format_srt_time(left)} --> {format_srt_time(right)}\n{text}\n"
            )
            idx += 1
    destination.write_text("\n".join(entries), encoding="utf-8")


def has_subtitle_filter(ffmpeg: str) -> bool:
    process = subprocess.run(
        [ffmpeg, "-hide_banner", "-filters"],
        capture_output=True, text=True, check=True,
    )
    return bool(re.search(r"\bsubtitles\b", process.stdout))


def render(
    source: Path, destination: Path, candidate: Candidate, subtitles: Path,
    layout: str, burn_subtitles: bool, width: int = 720, height: int = 1280,
) -> None:
    if layout == "blur":
        vf = (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=20:1[blur];"
            f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[front];"
            f"[blur][front]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p"
        )
    else:
        vf = (
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},setsar=1,format=yuv420p"
        )
    if burn_subtitles:
        # Run ffmpeg inside the output directory, so no absolute path escaping.
        vf += (
            f",subtitles={subtitles.name}:"
            "force_style='FontName=Arial,FontSize=18,Alignment=2,MarginV=65,"
            "Outline=2,Shadow=0'"
        )
    ffmpeg = require_binary("ffmpeg")
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{candidate.start:.3f}", "-i", str(source),
        "-t", f"{candidate.end - candidate.start:.3f}",
        "-vf", vf,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", str(destination),
    ]
    subprocess.run(command, cwd=destination.parent, check=True)


def process(args: argparse.Namespace) -> dict:
    source = args.input.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Input not found: {source}")
    if source.suffix.lower() not in (".mp4", ".mov", ".mkv", ".webm"):
        raise ValueError("Supported input: MP4, MOV, MKV or WebM")
    duration = video_duration(source)
    segments = (
        load_transcript(args.transcript_json)
        if args.transcript_json else transcribe(source, args.model, args.language)
    )
    selected = pick_clips(
        segments, duration, args.clips, args.min_seconds, args.max_seconds
    )
    if not selected:
        raise RuntimeError(
            "No speech passage matched the duration limits. "
            "Review the transcript or lower --min-seconds."
        )
    output = args.output_dir.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    ffmpeg = require_binary("ffmpeg")
    burn_subtitles = not args.no_burn_subtitles and has_subtitle_filter(ffmpeg)
    if not args.no_burn_subtitles and not burn_subtitles:
        print("FFmpeg has no subtitles filter; saving SRT sidecars instead.", file=sys.stderr)
    manifest = {
        "source": str(source), "source_duration_seconds": duration,
        "mode": "dry-run" if args.dry_run else "rendered",
        "selection": "speech transcript + transparent editorial heuristics",
        "subtitle_timing": "estimated sentence-level timing",
        "clips": [],
    }
    for i, clip in enumerate(selected, 1):
        name = f"clip_{i:02d}"
        srt = output / f"{name}.srt"
        mp4 = output / f"{name}.mp4"
        write_srt(clip, srt)
        if not args.dry_run:
            render(source, mp4, clip, srt, args.layout, burn_subtitles)
        manifest["clips"].append({
            "file": str(mp4) if not args.dry_run else None,
            "subtitles": str(srt),
            "start": round(clip.start, 3), "end": round(clip.end, 3),
            "duration": round(clip.end - clip.start, 3),
            "heuristic_score": clip.score, "text": clip.text,
            "burned_subtitles": burn_subtitles and not args.dry_run,
        })
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Local source video")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--transcript-json", type=Path, help="Reuse existing timed transcript")
    parser.add_argument("--model", default="small", help="faster-whisper model, default small")
    parser.add_argument("--language", default="pt", help="Transcription language")
    parser.add_argument("--clips", type=int, default=3)
    parser.add_argument("--min-seconds", type=float, default=18)
    parser.add_argument("--max-seconds", type=float, default=55)
    parser.add_argument("--layout", choices=("blur", "crop"), default="blur")
    parser.add_argument("--no-burn-subtitles", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = process(args)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Clipping error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "status": "ok", "clips": len(result["clips"]), "manifest": str(
            args.output_dir.expanduser().resolve() / "manifest.json"
        )
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
