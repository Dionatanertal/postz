/**
 * Keep the original activity failure visible in Temporal history, even when
 * persisting the user-facing failed status succeeds.
 *
 * Workflow-safe: depends only on deterministic callbacks, no Node APIs.
 */
export async function runClippingWithFailureReport(
  run: () => Promise<void>,
  reportFailure: () => Promise<void>
): Promise<void> {
  try {
    await run();
  } catch (error) {
    await reportFailure();
    throw error;
  }
}
