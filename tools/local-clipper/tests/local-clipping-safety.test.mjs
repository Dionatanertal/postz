import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReserveDiskSpace,
  MIN_SCRATCH_FREE_BYTES,
  MIN_MEDIA_FREE_BYTES,
  MAX_CLIPPING_SOURCE_BYTES,
  isValidLocalClippingSourceSize,
  hasCompletedLocalClipping,
  unreferencedClipPaths,
} from '../../../libraries/nestjs-libraries/src/database/prisma/clipping/local.clipping.safety.ts';

test('scratch must reserve 2 GiB before opening a processing job', () => {
  assert.equal(canReserveDiskSpace(MIN_SCRATCH_FREE_BYTES, 0, MIN_SCRATCH_FREE_BYTES), true);
  assert.equal(canReserveDiskSpace(MIN_SCRATCH_FREE_BYTES - 1, 0, MIN_SCRATCH_FREE_BYTES), false);
});

test('media storage must reserve the rendered byte count plus 1 GiB', () => {
  const renderedBytes = 175 * 1024 ** 2;
  const exact = MIN_MEDIA_FREE_BYTES + renderedBytes;
  assert.equal(canReserveDiskSpace(exact, renderedBytes, MIN_MEDIA_FREE_BYTES), true);
  assert.equal(canReserveDiskSpace(exact - 1, renderedBytes, MIN_MEDIA_FREE_BYTES), false);
  assert.equal(canReserveDiskSpace(renderedBytes - 1, renderedBytes, MIN_MEDIA_FREE_BYTES), false);
});

test('invalid and overflowed capacity figures are rejected closed', () => {
  for (const invalid of [-1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 1.4]) {
    assert.equal(canReserveDiskSpace(invalid, 0, MIN_MEDIA_FREE_BYTES), false);
    assert.equal(canReserveDiskSpace(MIN_MEDIA_FREE_BYTES, invalid, 0), false);
    assert.equal(canReserveDiskSpace(MIN_MEDIA_FREE_BYTES, 0, invalid), false);
  }
});

test('only unreferenced staging uploads are eligible for cleanup', () => {
  assert.deepEqual(
    unreferencedClipPaths(['/uploads/saved.mp4', '/uploads/orphan.mp4'], ['/uploads/saved.mp4', null]),
    ['/uploads/orphan.mp4']
  );
});

test('a committed upload survives when the worker loses its DB response', () => {
  assert.deepEqual(unreferencedClipPaths(['/uploads/kept.mp4'], ['/uploads/kept.mp4']), []);
});

test('all staging uploads are eligible when none was committed', () => {
  assert.deepEqual(unreferencedClipPaths(['/uploads/one.mp4', '/uploads/two.mp4'], []), [
    '/uploads/one.mp4', '/uploads/two.mp4'
  ]);
});


test('only non-empty source MP4s up to 1 GiB are accepted before scheduling', () => {
  assert.equal(isValidLocalClippingSourceSize(1), true);
  assert.equal(isValidLocalClippingSourceSize(MAX_CLIPPING_SOURCE_BYTES), true);
  for (const invalid of [0, -1, MAX_CLIPPING_SOURCE_BYTES + 1, NaN, Infinity, 1.5]) {
    assert.equal(isValidLocalClippingSourceSize(invalid), false);
  }
});

test('transport failure does not override a persisted completed clipping', () => {
  assert.equal(
    hasCompletedLocalClipping({
      status: 'completed',
      clips: [{ path: '/uploads/clip1.mp4' }, { path: '/uploads/clip2.mp4' }],
    }),
    true
  );
});

test('failed, incomplete, or missing clipping records must not be reported as completed', () => {
  assert.equal(hasCompletedLocalClipping(null), false);
  assert.equal(hasCompletedLocalClipping({ status: 'failed', clips: [{ path: '/uploads/a.mp4' }] }), false);
  assert.equal(hasCompletedLocalClipping({ status: 'completed', clips: [] }), false);
  assert.equal(hasCompletedLocalClipping({ status: 'completed', clips: [{ path: null }] }), false);
  assert.equal(hasCompletedLocalClipping({ status: 'completed', clips: [{ path: '' }] }), false);
});
