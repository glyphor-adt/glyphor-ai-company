import { CloudTasksClient } from '@google-cloud/tasks';

const client = new CloudTasksClient();
const PROJECT = process.env.GCP_PROJECT_ID || 'ai-glyphor-company';
const LOCATION = process.env.GCP_REGION || 'us-central1';

// Validate required environment variables on module initialization
const WORKER_URL = process.env.WORKER_URL;
const WORKER_SERVICE_ACCOUNT = process.env.WORKER_SERVICE_ACCOUNT;

if (!WORKER_URL) {
  throw new Error('WORKER_URL environment variable is required but not set');
}

if (!WORKER_SERVICE_ACCOUNT) {
  throw new Error('WORKER_SERVICE_ACCOUNT environment variable is required but not set');
}

const QUEUE_AGENT_RUNS = `projects/${PROJECT}/locations/${LOCATION}/queues/agent-runs`;
const QUEUE_PRIORITY = `projects/${PROJECT}/locations/${LOCATION}/queues/agent-runs-priority`;
const QUEUE_DELIVERY = `projects/${PROJECT}/locations/${LOCATION}/queues/delivery`;

export interface AgentRunParams {
  tenantId: string;
  agentRole: string;
  modelTier?: string;
  taskType: string;
  priority?: boolean;
  metadata?: Record<string, any>;
}

export async function enqueueAgentRun(params: AgentRunParams) {
  const queue = params.priority ? QUEUE_PRIORITY : QUEUE_AGENT_RUNS;
  const jitterSeconds = Math.floor(Math.random() * 30);

  await client.createTask({
    parent: queue,
    task: {
      httpRequest: {
        url: `${WORKER_URL}/run`,
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(params)).toString('base64'),
        oidcToken: {
          serviceAccountEmail: WORKER_SERVICE_ACCOUNT,
        },
      },
      scheduleTime: {
        seconds: Math.floor(Date.now() / 1000) + jitterSeconds,
      },
    },
  });
}

export interface DeliveryParams {
  tenantId: string;
  agentRole: string;
  channel: string;
  content: string;
  platform: string;
}

export async function enqueueDelivery(params: DeliveryParams) {
  await client.createTask({
    parent: QUEUE_DELIVERY,
    task: {
      httpRequest: {
        url: `${WORKER_URL}/deliver`,
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(params)).toString('base64'),
        oidcToken: {
          serviceAccountEmail: WORKER_SERVICE_ACCOUNT,
        },
      },
    },
  });
}
