import { CloudTasksClient } from '@google-cloud/tasks';

const client = new CloudTasksClient();
const PROJECT = process.env.GCP_PROJECT_ID || 'ai-glyphor-company';
const LOCATION = process.env.GCP_REGION || 'us-central1';
const WORKER_URL = process.env.WORKER_URL?.replace(/\/$/, '');
const WORKER_SERVICE_ACCOUNT = process.env.WORKER_SERVICE_ACCOUNT;
const QUEUE_AGENT_RUNS = `projects/${PROJECT}/locations/${LOCATION}/queues/agent-runs`;

export interface DeepDiveExecutionTask {
  deepDiveId: string;
  target: string;
  context?: string;
  requestedBy: string;
}

export function isWorkerQueueConfigured(): boolean {
  return Boolean(WORKER_URL && WORKER_SERVICE_ACCOUNT);
}

export async function enqueueDeepDiveExecution(task: DeepDiveExecutionTask): Promise<void> {
  if (!WORKER_URL || !WORKER_SERVICE_ACCOUNT) {
    throw new Error('Worker Cloud Tasks dispatch is not configured. Set WORKER_URL and WORKER_SERVICE_ACCOUNT.');
  }

  await client.createTask({
    parent: QUEUE_AGENT_RUNS,
    task: {
      httpRequest: {
        url: `${WORKER_URL}/run`,
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({
          taskType: 'deep_dive_execute',
          metadata: task,
        })).toString('base64'),
        oidcToken: {
          serviceAccountEmail: WORKER_SERVICE_ACCOUNT,
        },
      },
    },
  });
}