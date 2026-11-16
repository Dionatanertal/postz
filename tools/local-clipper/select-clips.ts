import { createHash } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const maxTranscriptBytes = 24_000;
const maxExcerptSeconds = 300;

async function main() {
  const { values, positionals } = parseArgs({
    options: { 'allow-paid-selection': { type: 'boolean' } },
    allowPositionals: true,
  });
  if (!values['allow-paid-selection'] || positionals.length !== 2) {
    throw new Error(
      'Usage: select-clips.ts <transcript.json> <selection.json> --allow-paid-selection'
    );
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Set OPENAI_API_KEY in the process environment.');
  }

  const [input, output] = positionals;
  const source = await open(input, 'r');
  let raw: Buffer;
  try {
    const info = await source.stat();
    if (!info.isFile() || info.size > maxTranscriptBytes) {
      throw new Error('Provide a transcript file of up to 24,000 bytes.');
    }
    raw = await source.readFile();
  } finally {
    await source.close();
  }
  if (raw.length > maxTranscriptBytes) {
    throw new Error('Provide a transcript file of up to 24,000 bytes.');
  }
  const { z } = await import('zod');
  const transcript = z
    .object({
      language: z.string().regex(/^[a-z]{2,3}$/),
      segments: z
        .array(
          z.object({
            start: z.number().finite().nonnegative(),
            end: z.number().finite().max(maxExcerptSeconds),
            text: z.string().trim().min(1),
          })
        )
        .nonempty(),
    })
    .parse(JSON.parse(raw.toString('utf8')));

  let previousEnd = 0;
  for (const segment of transcript.segments) {
    if (segment.start < previousEnd || segment.end <= segment.start) {
      throw new Error('Transcript segments must be ordered and must not overlap.');
    }
    previousEnd = segment.end;
  }
  const hasEligibleRange = transcript.segments.some(({ start }) =>
    transcript.segments.some(({ end }) => end - start >= 20 && end - start <= 90)
  );
  if (!hasEligibleRange) {
    throw new Error('No transcript range is between 20 and 90 seconds.');
  }

  const { OpenaiService } = await import(
    '../../libraries/nestjs-libraries/src/openai/openai.service'
  );
  const transcriptSha256 = createHash('sha256').update(raw).digest('hex');
  // Reserve the path before the paid request, so reruns cannot overwrite a selection.
  const selection = await open(output, 'wx');
  let saved = false;
  try {
    const clips = await new OpenaiService()
      .pickClips('', transcript.language, transcript.segments, 3)
      .catch(() => {
        throw new Error('The OpenAI clip selection request failed.');
      });
    await selection.writeFile(
      JSON.stringify({ transcriptSha256, clips }, null, 2) + '\n'
    );
    saved = true;
  } finally {
    await selection.close();
    if (!saved) {
      await unlink(output);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Selection failed.');
  process.exitCode = 1;
});
