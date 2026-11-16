#!/usr/bin/env node
/**
 * POSTZ local-clipping runtime preflight. Read-only: it does not install
 * dependencies, download AI weights, build containers or start jobs.
 */
import { accessSync, constants, statSync, statfsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const GIB = 1024 ** 3;

function defaultFileCheck(path, kind) {
  try {
    if (!path || typeof path !== 'string') return false;
    accessSync(path, constants.R_OK | (kind === 'directory' ? constants.W_OK : 0));
    const info = statSync(path);
    return kind === 'directory' ? info.isDirectory() : info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function defaultFreeBytes(path) {
  try {
    const { bavail, bsize } = statfsSync(path);
    return bavail * bsize;
  } catch {
    return NaN;
  }
}

function defaultCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 3 * 1024 * 1024,
  });
  return {
    available: !result.error && result.status !== null,
    output: (result.stdout || '') + (result.stderr || ''),
  };
}

/** All checks can be supplied with test doubles; production defaults are read-only. */
export function inspectRuntime({
  env = process.env,
  fileCheck = defaultFileCheck,
  freeBytes = defaultFreeBytes,
  command = defaultCommand,
} = {}) {
  const checks = [];
  const record = (name, passed, detail) => checks.push({ name, passed: !!passed, detail });

  record('Feature flag', env.LOCAL_CLIPPING_ENABLED === 'true',
    'LOCAL_CLIPPING_ENABLED must be true');
  record('Media storage provider',
    !env.STORAGE_PROVIDER || env.STORAGE_PROVIDER === 'local',
    'STORAGE_PROVIDER must be local');
  const paths = [
    ['Python clipper script', env.LOCAL_CLIPPING_SCRIPT, 'file'],
    ['Whisper model', env.LOCAL_CLIPPING_WHISPER_MODEL, 'file'],
    ['Local language model', env.LOCAL_CLIPPING_LLM_MODEL, 'file'],
    ['Media directory', env.UPLOAD_DIRECTORY, 'directory'],
    ['Scratch directory', env.LOCAL_CLIPPING_TMP_DIR || tmpdir(), 'directory'],
  ];
  for (const [name, path, kind] of paths) {
    record(name, fileCheck(path, kind), 'Must exist and be accessible');
  }

  const scratch = env.LOCAL_CLIPPING_TMP_DIR || tmpdir();
  const scratchFree = freeBytes(scratch);
  record('Scratch free space',
    Number.isSafeInteger(scratchFree) && scratchFree >= 2 * GIB,
    'At least 2 GiB must be free on the scratch filesystem');
  const mediaFree = freeBytes(env.UPLOAD_DIRECTORY);
  record('Media free space',
    Number.isSafeInteger(mediaFree) && mediaFree >= GIB,
    'At least 1 GiB must be free before writing rendered clips');

  for (const [name, binary, args] of [
    ['Python interpreter', env.LOCAL_CLIPPING_PYTHON || 'python', ['--version']],
    ['FFprobe', 'ffprobe', ['-version']],
    ['Whisper CLI', 'whisper-cli', ['--help']],
    ['Llama CLI', 'llama-completion', ['--help']],
  ]) {
    const result = command(binary, args);
    record(name, result.available, 'Executable must be available on PATH');
  }

  const ffmpegFilters = command('ffmpeg', ['-filters']);
  const ffmpegEncoders = command('ffmpeg', ['-encoders']);
  record('FFmpeg executable',
    ffmpegFilters.available && ffmpegEncoders.available,
    'ffmpeg must be available on PATH');
  record('FFmpeg subtitles filter',
    ffmpegFilters.available && /\bsubtitles\b/.test(ffmpegFilters.output),
    'FFmpeg must include the libass subtitles filter');
  record('FFmpeg H.264/AAC encoders',
    ffmpegEncoders.available &&
      /\blibx264\b/.test(ffmpegEncoders.output) &&
      /\baac\b/.test(ffmpegEncoders.output),
    'FFmpeg must include libx264 and AAC encoders');

  return { ok: checks.every((check) => check.passed), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectRuntime();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const check of result.checks) {
      console.log((check.passed ? 'OK' : 'MISSING') + ' ' + check.name + ': ' + check.detail);
    }
    console.log(result.ok ? 'Runtime prerequisites satisfied.' :
      'Runtime not ready. No changes were made.');
  }
  process.exitCode = result.ok ? 0 : 1;
}
