import test from 'node:test';
import assert from 'node:assert/strict';
import { runClippingWithFailureReport } from '../../../apps/orchestrator/src/workflows/local.clipping.outcome.ts';

test('successful processing completes without reporting failure', async () => {
  const calls: string[] = [];
  await runClippingWithFailureReport(
    async () => { calls.push('process'); },
    async () => { calls.push('fail'); }
  );
  assert.deepEqual(calls, ['process']);
});

test('failed activity is reported and still rejects the Temporal workflow', async () => {
  const calls: string[] = [];
  const error = new Error('media processing failed');
  await assert.rejects(
    runClippingWithFailureReport(
      async () => { calls.push('process'); throw error; },
      async () => { calls.push('fail'); }
    ),
    (err: unknown) => err === error
  );
  assert.deepEqual(calls, ['process', 'fail']);
});

test('failure recording is attempted exactly once', async () => {
  let failures = 0;
  await assert.rejects(
    runClippingWithFailureReport(
      async () => { throw new Error('worker unavailable'); },
      async () => { failures++; }
    )
  );
  assert.equal(failures, 1);
});

test('a failed status report cannot make a failed workflow appear successful', async () => {
  let failed = false;
  await assert.rejects(
    runClippingWithFailureReport(
      async () => { throw new Error('work failed'); },
      async () => { failed = true; throw new Error('status store unavailable'); }
    ),
    /status store unavailable/
  );
  assert.equal(failed, true);
});
