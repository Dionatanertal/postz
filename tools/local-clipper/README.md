# Local clipping pilot (isolated)

## Clipping in the Postiz media panel

The local mode uses the existing media upload, Temporal worker and draft
composer. In **Media → Clipagem inteligente**, upload an MP4, enter the
starting time in seconds and choose the spoken language. The worker analyzes
up to five minutes from that point and returns up to three cuts. The upload
uses the media library's 1 GiB limit. A source needs audio and at least 20
seconds available after the chosen start.

The worker uses Whisper token times to group complete sentences. A local
llama.cpp model compares eligible transcript ranges and selects candidates.
FFmpeg produces vertical H.264/AAC clips with burned-in captions and
normalized audio. Clips must pass technical checks before appearing for
review. Approve or reject each clip in the panel. For an approved clip,
select an existing channel and choose **Criar rascunho**. The draft appears
in the regular Postiz calendar. Its publish controls remain in the existing
editor. Once a linked post is **published**, its clip card offers
**Ver resultados deste corte**. On operator request, it reads that same
post's provider-reported analytics (7, 30 or 90 days) and existing Postiz
short-link clicks. There is no background polling or invented conversion
attribution. If a provider does not return metrics, the panel says so.

### Runtime configuration

Apply the additive Prisma schema update to the intended environment before
running builds from this branch. Existing rows keep null values in the new
fields. Use the project's existing Prisma schema update procedure. For local
testing, point it at a disposable database.

Use local media storage and share its existing upload directory between the
frontend, API and orchestrator. Preview files use the existing local media
URLs. The media panel only lists the authenticated organization's jobs.
Treat preview links like other local media links.

Set these values in the API and worker runtime configuration:

    STORAGE_PROVIDER=local
    LOCAL_CLIPPING_ENABLED=true
    LOCAL_CLIPPING_SCRIPT=/absolute/path/to/postz/tools/local-clipper/clip.py
    LOCAL_CLIPPING_WHISPER_MODEL=/absolute/path/to/ggml-small-q5_1.bin
    LOCAL_CLIPPING_LLM_MODEL=/absolute/path/to/instruct-model.gguf
    LOCAL_CLIPPING_PYTHON=python3
    # Optional: a dedicated mounted scratch directory with sufficient capacity
    LOCAL_CLIPPING_TMP_DIR=/mnt/clipping-scratch

The worker refuses to start a clipping job when its scratch filesystem has
less than **2 GiB free**. With no `LOCAL_CLIPPING_TMP_DIR`, it uses the
operating system's temporary directory, which can consume Docker's internal
disk. For a dedicated scratch location, provision a writable, capacity-limited
directory on a **separate mounted volume** and give the API/worker access to
it. The configured directory must already exist. Temporary excerpts and
transcriptions are removed after processing; clips selected for review remain
in media storage. Before saving the completed cuts, the worker checks their
combined file size and requires enough capacity on `UPLOAD_DIRECTORY` to
preserve **at least 1 GiB free** after copying them. Rejected cuts are still
stored for review: this check is not a retention or cleanup policy.
Do not point scratch at the host Windows `C:` drive when the Docker data disk
there is already low on space. These protections apply to clipping jobs,
**not Docker image builds**: control build cache separately.

The worker needs Python 3.10+, FFmpeg with the subtitles filter and libx264,
ffprobe, `whisper-cli` from [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
and `llama-completion` from [llama.cpp](https://github.com/ggml-org/llama.cpp)
on PATH. Use a multilingual GGML model for Whisper and an instruction-tuned
GGUF file with a chat template for the selector. Model files must already be
present on the worker. The worker launches both CPU tools as subprocesses,
so there is no model server to operate and no per-video terminal command.

The setting is opt-in. The existing YouTube clipping workflow continues
through the original workflow and routes.

The standalone commands below are available for offline testing of the same
media pipeline and for repeating the earlier editorial pilot.

## Check worker prerequisites before building or deploying

The worker needs installed executables, readable local models, writable
scratch/media directories and enough free space. Use the read-only preflight
**inside the intended worker runtime** before enabling local clipping:

```sh
node tools/local-clipper/preflight.mjs
# Machine-readable report (reports categories, never credential values):
node tools/local-clipper/preflight.mjs --json
```

The command verifies the local feature flag, storage mode, clipper Python file,
Whisper/LLM model files, Python, FFprobe, Whisper CLI, llama-completion,
FFmpeg subtitle support and H.264/AAC encoders. It checks at least 2 GiB free
scratch space and 1 GiB free media space. Exit code `0` means the inspected
requirements passed; `1` means something is missing. It does **not**
download models, create Docker images, initialize the database, invoke AI
models, connect to social accounts, or publish content.

This is a **prerequisite check, not runtime homologation**. Execute in the
actual container or worker environment: running it on a developer machine
cannot prove the tools and mounted files exist in the final image.

The offline regression tests for this check (no Docker, external network or
model execution required) are:

```sh
node --experimental-strip-types --test \
  tools/local-clipper/tests/preflight.test.mjs \
  tools/local-clipper/tests/local-clipping-safety.test.mjs
```

## Fast, offline safety regression tests

The local clipping worker uses pure guard functions to reject invalid disk
capacity, preserve temporary-volume headroom and protect committed media paths
when cleaning up interrupted attempts. These checks can be tested without
Docker, PostgreSQL, FFmpeg, AI models, paid APIs or a video input:

```sh
node --experimental-strip-types --test tools/local-clipper/tests/local-clipping-safety.test.mjs
```

Requires Node.js 22+ with type stripping support. This verifies six guard
cases. It does **not** replace an orchestrator build, Temporal integration
test, database migration test or real-media rendering test.

## Triage first (before making clips)

Run this no-cost inspection to avoid unnecessarily cutting a Reel that may
already be finished:

    python tools/local-clipper/intake.py --input "C:\\Videos\\video.mp4"

A `short_vertical_review` result means **review the original first**, not
that the system detected captions, edit quality, or an approved CTA. Keep the
original intact. `clip_source_review` suggests a longer or horizontal source
that may benefit from clipping. Either decision still requires context review.

Run the triage unit tests:

    python -m unittest discover -s tools/local-clipper/tests -p 'test_intake.py' -v

## Purpose

Take an **authorized local video** (MP4, MOV, MKV or WebM), transcribe spoken
Portuguese, suggest non-duplicate passages, render vertical MP4 files, and
produce captions plus a JSON manifest for **human review before publication**.

The original heuristic mode runs locally without credentials. The optional
semantic mode sends the timed transcript to Postiz's OpenAI selector. Media
processing and human review take place locally.

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

## Semantic selection with the Postiz service

Use a video excerpt with coherent speech and a maximum duration of five
minutes. Keep that same excerpt for transcription and render. The examples
use the repo's ignored `tmp` directory so working files stay out of Git.

1. Extract a three-minute passage beginning at an appropriate time in the video.
   Adjust `-ss` to the intended start. Omit this command if the authorized
   source is already an excerpt.

       ffmpeg -n -ss 00:10:00 -i "C:\Videos\video.mp4" -t 180 -c:v libx264 -c:a aac "C:\Videos\excerpt.mp4"

2. Transcribe the excerpt with the local Whisper model. Listen to the passage
   and check the text and timing before submitting it for selection.

       python tools/local-clipper/clip.py --input "C:\Videos\excerpt.mp4" --output-dir tmp/clipping-pilot --transcribe-only

3. With the workspace dependencies installed through pnpm, run the selector
   only after the operator authorizes sending the timed transcript and the
   billable OpenAI request. Supply `OPENAI_API_KEY` through the process
   environment. This step submits up to 24,000 bytes of transcript input
   (timings and text) and its language to the native selector in one request,
   with no automatic retries. Preserve `selection.json` for subsequent renders.

       pnpm exec ts-node --project apps/backend/tsconfig.json --transpile-only tools/local-clipper/select-clips.ts tmp/clipping-pilot/transcript.json tmp/clipping-pilot/selection.json --allow-paid-selection

4. Use the same transcript and excerpt with an empty render destination. This
   step runs locally. The selector can return up to three clips of 20–90
   seconds. The renderer accepts consecutive whole transcript lines within
   those limits and rejects overlapping ranges. A changed transcript requires
   a new selection.

       python tools/local-clipper/clip.py --input "C:\Videos\excerpt.mp4" --output-dir tmp/clipping-pilot/render --transcript-json tmp/clipping-pilot/transcript.json --semantic-selection tmp/clipping-pilot/selection.json

5. Open the MP4, SRT and manifest. Verify that the first and last words are
   audible, captions match the speech, and each clip makes a complete point on
   its own. Review the suggested title and post copy against the excerpt.
   `qa_failed` and exit code 1 indicate a technical failure. Every clip still
   requires human approval.

## Local transcription and editorial selection

Install or unpack FFmpeg and [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
and make their executables available on PATH for the current terminal. Use a
local multilingual [GGML model](https://huggingface.co/ggerganov/whisper.cpp)
such as `ggml-small-q5_1.bin`. After obtaining the binaries and weights these
steps run offline.

1. Extract a spoken excerpt of up to five minutes using the FFmpeg command in
   the previous section.
2. Produce the timed transcript on the local machine.

       python tools/local-clipper/clip.py --input "C:\Videos\excerpt.mp4" --output-dir tmp/clipping-pilot --transcribe-only --whisper-model-file "C:\Tools\ggml-small-q5_1.bin"

3. Review the transcript in order. Mark zero-based inclusive `from` and `to`
   indices for up to three complete passages of 20–90 seconds, and use the
   file's SHA-256 in the selection JSON. On PowerShell, compute it with
   `(Get-FileHash tmp/clipping-pilot/transcript.json).Hash.ToLowerInvariant()`.
   Replace the example values with those for the excerpt.

       {
         "transcriptSha256": "<transcript file hash>",
         "clips": [
           {"from": 3, "to": 12, "title": "Proposed title", "content": "Draft post"}
         ]
       }

4. Save the JSON as `selection.json` and render from the same excerpt. Use an
   empty output directory. The manifest records the editorial provenance and
   leaves approval pending.

       python tools/local-clipper/clip.py --input "C:\Videos\excerpt.mp4" --output-dir tmp/clipping-pilot/render --transcript-json tmp/clipping-pilot/transcript.json --editorial-selection tmp/clipping-pilot/selection.json

## Technical validation of rendered clips

Run after rendering each MP4:

    python tools/local-clipper/verify_output.py --input "C:\Videos\cortes-teste\clip_01.mp4"

The command checks container streams, codec, dimensions, duration and the first
20 seconds of audio. It exits nonzero for technical failures. This **does not
verify the meaning of the cut**. Every generated clip remains marked
PENDING_HUMAN_REVIEW in its JSON manifest, even if all technical checks pass.
There is no automatic publishing in this pilot.

Verified in the development environment against three already-rendered clips
from a real long source: all three passed technical checks. Six standalone
technical-QA unit tests passed. Automatic speech-to-text, semantic selection,
Postiz UI integration and publishing remain **unverified**.

## Acceptance conditions

1. A real video is readable by ffprobe, and outputs play with audio.
2. Vertical MP4 cuts have useful beginning and ending, without truncated
   sentences or misleading edits.
3. SRT text faithfully reflects the speaker; human review corrects mistakes.
4. The original source remains unchanged; nothing is published.
5. The semantic request is made only with explicit authorization. The
   heuristic path runs without credentials or paid services.

Run standard-library unit tests:

    python -m unittest discover -s tools/local-clipper/tests -v

This does not test video-rendering codecs on your machine; final validation
requires one real sample video.

## Known limitations (intentional)

- The picker uses speech segments and straightforward editorial cues, **not**
  a trained virality model. Humans should select/edit the final cuts.
- A long video can take substantial CPU time to transcribe locally. Start with
  one short excerpt to validate quality before running hours of material.
- Rendered clips include FFmpeg loudness normalization to help with quiet audio;
  review for background-noise amplification and adjust if needed.
- Selecting portions from images or audio level alone does NOT validate their
  meaning. The end-to-end intelligent clipping test requires a real transcript.
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
