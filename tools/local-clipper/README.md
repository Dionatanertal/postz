# Local clipping pilot (isolated)

This folder is a **proof of concept**, not a replacement for Postiz's existing
YouTube/RunPod clipping flow. It does not change the main Postiz app, social
connections, database, Docker configuration, scheduling, or running services.

## Purpose

Take an **authorized local video** (MP4, MOV, MKV or WebM), transcribe spoken
Portuguese, suggest non-duplicate passages, render vertical MP4 files, and
produce captions plus a JSON manifest for **human review before publication**.

No social account, OpenAI key, cloud media service, or GitHub Action is required
for this pilot. The selection heuristic does **not** predict virality or
commercial performance. Video processing is local, and source files remain
unchanged.

## Windows setup

1. Install Python 3.10+ and FFmpeg (including ffprobe), both available on PATH.
2. Open a terminal **in the POSTZ repository**.
3. For automatic transcription, run once:

       python -m pip install faster-whisper

   The first run downloads a speech model (default small) and can take time
   on CPU. No OpenAI or cloud API key is needed. If you already have a timed
   transcript in JSON, you can skip this dependency.

## First test (do not publish)

Run from the repository root:

    python tools/local-clipper/clip.py --input "C:\Videos\video.mp4" --output-dir "C:\Videos\cortes-teste"

The command creates:

- clip_01.mp4 etc. (up to three cuts by default)
- clip_01.srt etc. (caption sidecars)
- manifest.json (start, end, duration, source speech, score, output paths)

By default, captions are also burned into video when FFmpeg includes
libass/the subtitles filter. Without that filter, MP4 cuts are still
exported, and SRT files remain available.

For comparison before rendering:

    python tools/local-clipper/clip.py --input "C:\Videos\video.mp4" --output-dir "C:\Videos\avaliacao" --dry-run

The dry run still performs transcription, computes suggestions, and writes SRT
and manifest files. It does not write MP4 outputs.

For a faster, offline test with an existing transcript:

    python tools/local-clipper/clip.py --input "C:\Videos\video.mp4" --transcript-json "C:\Videos\transcript.json" --output-dir "C:\Videos\cortes-teste"

Transcript format (seconds, not milliseconds):

    {
      "segments": [
        {"start": 0.0, "end": 8.4, "text": "Um exemplo de fala."},
        {"start": 8.4, "end": 22.0, "text": "Outra parte da explicação."}
      ]
    }

Useful options:

- --clips 5 (one to ten)
- --min-seconds 15 --max-seconds 45
- --layout crop (fill frame, cuts horizontal sides)
- --layout blur (default, preserves frame on a blurred background)
- --model base (lighter local transcription model)
- --no-burn-subtitles (keeps SRT only)
- --language pt (default; specify the correct source language)

## Acceptance conditions

1. A real video is readable by ffprobe, and outputs play with audio.
2. Vertical MP4 cuts have useful beginning and ending, without truncated
   sentences or misleading edits.
3. SRT text faithfully reflects the speaker; human review corrects mistakes.
4. The original source remains unchanged; nothing is published.
5. No paid service, token, live channel, or business system is touched.

Run standard-library unit tests:

    python -m unittest discover -s tools/local-clipper/tests -v

This does not test video-rendering codecs on your machine; final validation
requires one real sample video.

## Known limitations (intentional)

- The picker uses speech segments and straightforward editorial cues, **not**
  a trained virality model. Humans should select/edit the final cuts.
- Sentence-level transcript timing makes subtitle timing approximate; later
  versions may add forced word alignment.
- FFmpeg uses CPU by default. Processing 200–300 videos at once is not the
  purpose of this pilot.
- The system does not detect silent visual highlights.
- This is not yet a button in the Postiz interface or an automated publisher.
- The default existing Postiz YouTube/RunPod clipping feature is unchanged.

**Next milestone:** validate at least one real local video first. Only then
decide whether to integrate these processes into Postiz's media library and
approval workflow, without duplicating existing scheduling features.
