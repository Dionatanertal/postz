import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRuntime } from '../preflight.mjs';

const gib = 1024 ** 3;
const configured = {
  LOCAL_CLIPPING_ENABLED: 'true', STORAGE_PROVIDER: 'local',
  LOCAL_CLIPPING_SCRIPT: '/worker/clip.py',
  LOCAL_CLIPPING_WHISPER_MODEL: '/weights/whisper.bin',
  LOCAL_CLIPPING_LLM_MODEL: '/weights/local.gguf',
  UPLOAD_DIRECTORY: '/uploads', LOCAL_CLIPPING_TMP_DIR: '/scratch',
};
const ready = (overrides = {}) => inspectRuntime({
  env: { ...configured, ...overrides.env },
  fileCheck: overrides.fileCheck ?? (() => true),
  freeBytes: overrides.freeBytes ?? (() => 5 * gib),
  command: overrides.command ?? ((bin, args) => ({
    available: true,
    output: args[0] === '-filters' ? 'subtitles' : 'libx264 aac',
  })),
});
const status = (result, name) => result.checks.find((check) => check.name === name)?.passed;

test('valid worker prerequisites pass without running a job', () => {
  const result = ready();
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 16);
});

test('missing feature flag and model file fail closed', () => {
  const result = ready({
    env: { LOCAL_CLIPPING_ENABLED: 'false', LOCAL_CLIPPING_LLM_MODEL: '' },
    fileCheck: (path) => !!path,
  });
  assert.equal(result.ok, false);
  assert.equal(status(result, 'Feature flag'), false);
  assert.equal(status(result, 'Local language model'), false);
});

test('insufficient scratch or media space blocks readiness', () => {
  const result = ready({ freeBytes: (path) => path === '/scratch' ? 2 * gib - 1 : gib - 1 });
  assert.equal(status(result, 'Scratch free space'), false);
  assert.equal(status(result, 'Media free space'), false);
  assert.equal(result.ok, false);
});

test('missing FFmpeg subtitle filter is reported even if binary exists', () => {
  const result = ready({ command: (bin, args) => ({
    available: true,
    output: args[0] === '-filters' ? 'scale crop' : 'libx264 aac',
  }) });
  assert.equal(status(result, 'FFmpeg executable'), true);
  assert.equal(status(result, 'FFmpeg subtitles filter'), false);
});

test('missing encoder or interpreter is reported', () => {
  const result = ready({ command: (bin, args) => ({
    available: bin !== 'python',
    output: args[0] === '-filters' ? 'subtitles' : 'aac',
  }) });
  assert.equal(status(result, 'Python interpreter'), false);
  assert.equal(status(result, 'FFmpeg H.264/AAC encoders'), false);
});

test('failures report only generic checks, not private environment settings', () => {
  const result = ready({
    env: { ...configured, LOCAL_CLIPPING_LLM_MODEL: '/private/my-secret-key.gguf' },
    fileCheck: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('my-secret-key'), false);
});
