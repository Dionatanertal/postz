#!/usr/bin/env python3
"""Transcribe local video and render vertical cuts for editorial review."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

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
    score: float | None
    segments: tuple[Segment, ...]
    title: str | None = None
    content: str | None = None

    @property
    def text(self) -> str:
        return " ".join(s.text.strip() for s in self.segments).strip()


def require_binary(name: str) -> str:
    result = shutil.which(name)
    if not result:
        raise RuntimeError(f"{name} is required on PATH.")
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
    segments = parse_transcript(json.loads(path.read_text(encoding="utf-8")))
    return sorted(segments, key=lambda s: (s.start, s.end))


def parse_transcript(data: dict | list) -> list[Segment]:
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
    return segments


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


def transcribe_with_whisper_cli(
    source: Path, model_file: Path, language: str, sentence_segments: bool = False
) -> list[Segment]:
    model_file = model_file.expanduser().resolve(strict=True)
    if not model_file.is_file():
        raise ValueError("--whisper-model-file requires a local GGML model file")
    whisper = require_binary("whisper-cli")
    ffmpeg = require_binary("ffmpeg")
    with TemporaryDirectory() as temporary:
        audio = Path(temporary) / "speech.wav"
        output = Path(temporary) / "speech"
        subprocess.run([
            ffmpeg, "-nostdin", "-loglevel", "error", "-i", str(source),
            "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            str(audio),
        ], check=True)
        subprocess.run([
            whisper, "-m", str(model_file), "-f", str(audio), "-l", language,
            "-ng", "-np", "-ojf" if sentence_segments else "-oj", "-of", str(output),
        ], check=True, stdout=subprocess.DEVNULL)
        data = json.loads(output.with_suffix(".json").read_text(encoding="utf-8"))
    try:
        if sentence_segments:
            return whisper_sentences(data["transcription"])
        rows = [
            {
                "start": row["offsets"]["from"] / 1000,
                "end": row["offsets"]["to"] / 1000,
                "text": row["text"],
            }
            for row in data["transcription"]
            if row["offsets"]["to"] > row["offsets"]["from"]
        ]
    except (KeyError, TypeError) as exc:
        raise ValueError("whisper-cli returned an invalid transcript") from exc
    return parse_transcript(rows)


def whisper_sentences(transcription: list[dict]) -> list[Segment]:
    sentences = []
    text = ""
    start = None
    end = 0.0
    for row in transcription:
        for token in row["tokens"]:
            word = token["text"]
            times = token.get("offsets")
            if not times or not word.strip() or word.startswith("[_"):
                continue
            if start is None:
                start = max(end, times["from"] / 1000)
            text += word
            if not re.search(r"[.!?…][\"”')]*$", word.rstrip()):
                continue
            stop = times["to"] / 1000
            if stop > start:
                sentences.append(Segment(start, stop, text.strip()))
                end = stop
            start = None
            text = ""
    return sentences


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


def load_selected_clips(
    selection_path: Path, transcript_path: Path, duration: float
) -> list[Candidate]:
    if duration > 300:
        raise ValueError("Rendering selected clips requires a video excerpt of up to 300 seconds")
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    raw = transcript_path.read_bytes()
    transcript_sha256 = hashlib.sha256(raw).hexdigest()
    if not isinstance(selection, dict) or selection.get("transcriptSha256") != transcript_sha256:
        raise ValueError("Selection does not match the transcript file")
    rows = selection.get("clips")
    transcript = json.loads(raw)
    if not isinstance(rows, list) or not isinstance(transcript, dict):
        raise ValueError("Invalid semantic selection or transcript")
    segments = parse_transcript(transcript)
    if len(segments) != len(transcript["segments"]) or any(
        segment.end > duration or (i > 0 and segment.start < segments[i - 1].end)
        for i, segment in enumerate(segments)
    ):
        raise ValueError("Transcript has empty, overlapping or out-of-bounds segments")
    # Keep the selection order and use only complete transcript ranges.
    selected = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        first, last = row.get("from"), row.get("to")
        if type(first) is not int or type(last) is not int:
            continue
        if not 0 <= first <= last < len(segments):
            continue
        start, end = segments[first].start, segments[last].end
        if not 20 <= end - start <= 90 or any(
            start < clip.end and clip.start < end for clip in selected
        ):
            continue
        title, content = row.get("title"), row.get("content")
        if not isinstance(title, str) or not isinstance(content, str):
            continue
        selected.append(Candidate(
            start, end, None, tuple(segments[first:last + 1]), title, content
        ))
        if len(selected) == 3:
            break
    return selected


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
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
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
    output = args.output_dir.expanduser().resolve()
    if args.transcribe_only:
        if duration > 300:
            raise ValueError("Provide a video excerpt of up to 300 seconds")
        segments = (
            transcribe_with_whisper_cli(
                source, args.whisper_model_file, args.language, args.sentence_segments
            )
            if args.whisper_model_file else transcribe(source, args.model, args.language)
        )
        segments = [segment for segment in segments if segment.end <= duration]
        if not segments:
            raise RuntimeError("No complete speech segments found in this excerpt")
        output.mkdir(parents=True, exist_ok=True)
        transcript_path = output / "transcript.json"
        with transcript_path.open("x", encoding="utf-8") as target:
            json.dump({
                "language": args.language,
                "segments": [asdict(segment) for segment in segments],
            }, target, ensure_ascii=False, indent=2)
        return {"transcript": str(transcript_path), "segments": len(segments)}

    selection_path = args.local_selection or args.semantic_selection or args.editorial_selection
    if selection_path:
        selected = load_selected_clips(selection_path, args.transcript_json, duration)
    else:
        segments = (
            load_transcript(args.transcript_json)
            if args.transcript_json else transcribe(source, args.model, args.language)
        )
        selected = pick_clips(
            segments, duration, args.clips, args.min_seconds, args.max_seconds
        )
    if not selected:
        raise RuntimeError(
            "No selected passage matched the transcript and duration limits."
            if selection_path else
            "No speech passage matched the duration limits. "
            "Review the transcript or lower --min-seconds."
        )
    if selection_path and output.is_dir() and any(output.iterdir()):
        raise ValueError("Use a separate empty output directory for the selected clips")
    output.mkdir(parents=True, exist_ok=True)
    burn_subtitles = (
        not args.dry_run and not args.no_burn_subtitles
        and has_subtitle_filter(require_binary("ffmpeg"))
    )
    if not args.dry_run and not args.no_burn_subtitles and not burn_subtitles:
        print("FFmpeg has no subtitles filter; saving SRT sidecars instead.", file=sys.stderr)
    manifest = {
        "source": str(source), "source_duration_seconds": duration,
        "mode": "dry-run" if args.dry_run else "rendered",
        "selection": "speech transcript + transparent editorial heuristics",
        "subtitle_timing": "estimated sentence-level timing",
        "clips": [],
    }
    if args.semantic_selection:
        manifest["selection"] = "OpenaiService.pickClips"
    elif args.local_selection:
        manifest["selection"] = "local model selection from transcript"
    elif args.editorial_selection:
        manifest["selection"] = "editorial selection from transcript"
    for i, clip in enumerate(selected, 1):
        name = f"clip_{i:02d}"
        srt = output / f"{name}.srt"
        mp4 = output / f"{name}.mp4"
        write_srt(clip, srt)
        technical_qa = None
        if not args.dry_run:
            render(source, mp4, clip, srt, args.layout, burn_subtitles)
            # Keep output checks independent from semantic/editorial acceptance.
            # The CLI script directory is on sys.path during normal execution.
            from verify_output import inspect_media
            technical_qa = inspect_media(mp4)
        manifest["clips"].append({
            "file": str(mp4) if not args.dry_run else None,
            "subtitles": str(srt),
            "start": round(clip.start, 3), "end": round(clip.end, 3),
            "duration": round(clip.end - clip.start, 3),
            "heuristic_score": clip.score, "text": clip.text,
            "burned_subtitles": burn_subtitles and not args.dry_run,
            "technical_qa": technical_qa,
            "editorial_approval": "PENDING_HUMAN_REVIEW",
            "ready_to_publish": False,
        })
        if selection_path:
            manifest["clips"][-1].update(title=clip.title, content=clip.content)
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Local source video")
    parser.add_argument("--output-dir", type=Path, required=True)
    transcription = parser.add_mutually_exclusive_group()
    transcription.add_argument("--transcript-json", type=Path, help="Reuse existing timed transcript")
    transcription.add_argument("--transcribe-only", action="store_true",
                               help="Save a timed transcript from an excerpt of up to five minutes")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--semantic-selection", type=Path,
                           help="Render suggestions from select-clips.ts for --transcript-json")
    selection.add_argument("--editorial-selection", type=Path,
                           help="Render editorially chosen transcript ranges from a local JSON file")
    selection.add_argument("--local-selection", type=Path,
                           help="Render ranges chosen by the local model")
    parser.add_argument("--model", default="small", help="faster-whisper model, default small")
    parser.add_argument("--whisper-model-file", type=Path,
                        help="Use a local whisper-cli GGML model for --transcribe-only")
    parser.add_argument("--sentence-segments", action="store_true",
                        help="Use Whisper token timestamps to preserve sentence boundaries")
    parser.add_argument("--language", default="pt", help="Transcription language")
    parser.add_argument("--clips", type=int, default=3)
    parser.add_argument("--min-seconds", type=float, default=18)
    parser.add_argument("--max-seconds", type=float, default=55)
    parser.add_argument("--layout", choices=("blur", "crop"), default="blur")
    parser.add_argument("--no-burn-subtitles", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    selection_path = args.local_selection or args.semantic_selection or args.editorial_selection
    if selection_path and not args.transcript_json:
        parser.error("A selection file requires --transcript-json")
    if args.whisper_model_file and not args.transcribe_only:
        parser.error("--whisper-model-file requires --transcribe-only")
    if args.sentence_segments and not args.whisper_model_file:
        parser.error("--sentence-segments requires --whisper-model-file")
    if args.transcribe_only and args.dry_run:
        parser.error("--transcribe-only and --dry-run are mutually exclusive")
    try:
        result = process(args)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Clipping error: {exc}", file=sys.stderr)
        return 1
    if args.transcribe_only:
        print(json.dumps({"status": "ok", **result}, ensure_ascii=False))
        return 0
    failed_qa = selection_path is not None and any(
        clip["technical_qa"] and not clip["technical_qa"]["passed_technical_checks"]
        for clip in result["clips"]
    )
    print(json.dumps({
        "status": "qa_failed" if failed_qa else "ok",
        "clips": len(result["clips"]), "manifest": str(
            args.output_dir.expanduser().resolve() / "manifest.json"
        )
    }, ensure_ascii=False))
    return int(failed_qa)


if __name__ == "__main__":
    raise SystemExit(main())
