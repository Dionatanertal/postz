/**
 * Pure guardrails for local media processing; no Docker, database, or AI required.
 * File size and filesystem statistics are supplied by the caller.
 */
export const MIN_SCRATCH_FREE_BYTES = 2 * 1024 ** 3;
export const MIN_MEDIA_FREE_BYTES = 1024 ** 3;

/** Shared cap with the media library's MP4 upload allowance (1 GiB). */
export const MAX_CLIPPING_SOURCE_BYTES = 1024 ** 3;

export function isValidLocalClippingSourceSize(size: number): boolean {
  return Number.isSafeInteger(size) && size > 0 && size <= MAX_CLIPPING_SOURCE_BYTES;
}

export function canReserveDiskSpace(
  freeBytes: number,
  bytesToWrite: number,
  minimumRemainingBytes: number
): boolean {
  if (
    ![freeBytes, bytesToWrite, minimumRemainingBytes].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    )
  ) {
    return false;
  }
  return bytesToWrite <= freeBytes && freeBytes - bytesToWrite >= minimumRemainingBytes;
}

/**
 * A worker can lose the response after the database transaction commits.
 * Confirm the persisted job has at least one complete clip before treating
 * that transport error as success. Never trust the transport result alone.
 */
export function hasCompletedLocalClipping(
  job: {
    status: string;
    clips: readonly { path: string | null }[];
  } | null
): boolean {
  return (
    job?.status === 'completed' &&
    job.clips.length > 0 &&
    job.clips.every((clip) => typeof clip.path === 'string' && clip.path.length > 0)
  );
}

/** Never remove a staging upload that is referenced by committed clips. */
export function unreferencedClipPaths(
  stagedPaths: readonly string[],
  committedPaths: readonly (string | null)[]
): string[] {
  const referenced = new Set(committedPaths.filter((path): path is string => !!path));
  return stagedPaths.filter((path) => !referenced.has(path));
}
