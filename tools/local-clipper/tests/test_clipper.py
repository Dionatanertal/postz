"""Offline unit tests for the isolated local clipper.

No network, AI model, or media rendering is required to run these tests.
"""
from __future__ import annotations

import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "clip.py"
spec = importlib.util.spec_from_file_location("postz_local_clipper", MODULE)
clipper = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = clipper
spec.loader.exec_module(clipper)


class TestLocalClipper(unittest.TestCase):
    def test_empty_transcript_produces_no_suggestions(self):
        self.assertEqual(clipper.pick_clips([], 120), [])

    def test_invalid_count_is_rejected(self):
        with self.assertRaises(ValueError):
            clipper.pick_clips([], 120, count=11)

    def test_invalid_duration_limits_are_rejected(self):
        with self.assertRaises(ValueError):
            clipper.pick_clips([], 120, min_seconds=30, max_seconds=10)

    def test_selects_nonoverlapping_cuts(self):
        segments = [
            clipper.Segment(i * 10.0, (i + 1) * 10.0,
                            f"Você sabia como funciona o consórcio? Exemplo {i}")
            for i in range(12)
        ]
        picked = clipper.pick_clips(segments, 120, count=3, min_seconds=18, max_seconds=24)
        self.assertEqual(len(picked), 3)
        for item in picked:
            self.assertGreaterEqual(item.end - item.start, 18)
            self.assertLessEqual(item.end - item.start, 24)
        for index, a in enumerate(picked):
            for b in picked[index + 1:]:
                overlap = max(0, min(a.end, b.end) - max(a.start, b.start))
                self.assertLess(overlap, 1)

    def test_short_existing_reel_is_eligible(self):
        segments = [clipper.Segment(0, 9, "Aqui temos uma explicação rápida de consórcio.")]
        candidates = clipper.pick_clips(segments, 9, count=1)
        self.assertEqual(len(candidates), 1)
        self.assertLessEqual(candidates[0].end, 9)

    def test_hook_has_greater_score(self):
        basic = (clipper.Segment(0, 20, "Este assunto tem vários pontos de análise."),)
        hook = (clipper.Segment(0, 20, "Você sabia por que este erro é importante?"),)
        self.assertGreater(clipper.score_passage(hook), clipper.score_passage(basic))

    def test_bad_transcript_timestamp_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.json"
            path.write_text(json.dumps({"segments": [
                {"start": 10, "end": 5, "text": "invalid"}
            ]}), encoding="utf-8")
            with self.assertRaises(ValueError):
                clipper.load_transcript(path)

    def test_transcript_sorted_and_empty_segments_dropped(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.json"
            path.write_text(json.dumps([
                {"start": 8, "end": 10, "text": "dois"},
                {"start": 0, "end": 8, "text": "um"},
                {"start": 10, "end": 12, "text": " "}
            ]), encoding="utf-8")
            result = clipper.load_transcript(path)
            self.assertEqual([s.text for s in result], ["um", "dois"])

    def test_srt_relative_timing(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate = clipper.Candidate(
                start=10.0, end=30.0, score=5,
                segments=(clipper.Segment(12, 16, "Legenda relativa ao corte"),)
            )
            target = Path(tmp) / "clip.srt"
            clipper.write_srt(candidate, target)
            text = target.read_text(encoding="utf-8")
            self.assertIn("00:00:02,000 --> 00:00:06,000", text)
            self.assertIn("Legenda relativa ao corte", text)

    def test_srt_time_handles_long_videos(self):
        self.assertEqual(clipper.format_srt_time(3661.5), "01:01:01,500")

    def test_whisper_sentence_boundaries_cross_raw_segments(self):
        def token(text, start, end):
            return {"text": text, "offsets": {"from": start, "to": end}}

        sentences = clipper.whisper_sentences([
            {"tokens": [token(" Uma frase", 100, 2000), token(" com", 2000, 3000)]},
            {"tokens": [
                token(" sentido.", 3000, 6000),
                {"text": "[_TT_300]"},
                token(" Outra frase!", 5900, 9000),
                token(" Um final incompleto", 9500, 11000),
            ]},
        ])
        self.assertEqual(sentences, [
            clipper.Segment(0.1, 6, "Uma frase com sentido."),
            clipper.Segment(6, 9, "Outra frase!"),
        ])

    def test_semantic_dry_run_keeps_whole_transcript_lines_and_requires_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "example.mp4"
            video.touch()
            transcript = root / "transcript.json"
            transcript.write_text(json.dumps({"language": "pt", "segments": [
                {"start": i * 10, "end": (i + 1) * 10, "text": f"Frase {i}."}
                for i in range(12)
            ]}), encoding="utf-8")
            selection = root / "selection.json"
            selection.write_text(json.dumps({
                "transcriptSha256": hashlib.sha256(transcript.read_bytes()).hexdigest(),
                "clips": [
                    {"from": first, "to": last, "title": "Título", "content": "Texto"}
                    for first, last in [(0, 0), (0, 9), (2, 4), (3, 5), (-1, 2), (7, 8)]
                ],
            }), encoding="utf-8")
            for flag, provenance in [
                ("--semantic-selection", "OpenaiService.pickClips"),
                ("--editorial-selection", "editorial selection from transcript"),
                ("--local-selection", "local model selection from transcript"),
            ]:
                with self.subTest(flag=flag):
                    output = root / flag[2:]
                    with patch.object(clipper, "video_duration", return_value=120), patch.object(
                        clipper, "render"
                    ) as render:
                        self.assertEqual(clipper.main([
                            "--input", str(video), "--output-dir", str(output),
                            "--transcript-json", str(transcript), flag,
                            str(selection), "--dry-run",
                        ]), 0)
                        render.assert_not_called()
                    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
                    self.assertEqual(manifest["selection"], provenance)
            self.assertEqual(
                [(item["start"], item["end"]) for item in manifest["clips"]],
                [(20, 50), (70, 90)],
            )
            first = manifest["clips"][0]
            self.assertEqual(first["text"], "Frase 2. Frase 3. Frase 4.")
            self.assertEqual(first["title"], "Título")
            self.assertIsNone(first["heuristic_score"])
            self.assertEqual(first["editorial_approval"], "PENDING_HUMAN_REVIEW")
            self.assertFalse(first["ready_to_publish"])
            subtitles = (output / "clip_01.srt").read_text(encoding="utf-8")
            self.assertIn("00:00:00,000 --> 00:00:10,000\nFrase 2.", subtitles)

            with self.assertRaisesRegex(ValueError, "out-of-bounds"):
                clipper.load_selected_clips(selection, transcript, 119)
            transcript.write_bytes(transcript.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "does not match"):
                clipper.load_selected_clips(selection, transcript, 120)


if __name__ == "__main__":
    unittest.main()
