import { proxyActivities } from '@temporalio/workflow';
import type { LocalClippingActivity } from '@gitroom/orchestrator/activities/local.clipping.activity';

const { processLocalClipping } = proxyActivities<LocalClippingActivity>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '45 seconds',
  retry: { maximumAttempts: 1 },
});

const { failLocalClipping } = proxyActivities<LocalClippingActivity>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 5 },
});

export async function localClippingWorkflowV1({
  clippingId,
  language,
}: {
  clippingId: string;
  language: string;
}) {
  try {
    await processLocalClipping(clippingId, language);
  } catch {
    await failLocalClipping(clippingId);
  }
}
