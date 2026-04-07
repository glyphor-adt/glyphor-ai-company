import { CloudTasksClient } from '@google-cloud/tasks';
import { GoogleAuth } from 'google-auth-library';
import type { CompanyAgentRole, ConversationAttachment, ConversationTurn } from '@glyphor/agent-runtime';
import type { RouteResult } from './eventRouter.js';

const client = new CloudTasksClient();
const googleAuth = new GoogleAuth();
const PROJECT = process.env.GCP_PROJECT_ID || 'ai-glyphor-company';
const LOCATION = process.env.GCP_REGION || 'us-central1';
const WORKER_URL = process.env.WORKER_URL?.replace(/\/$/, '');
const WORKER_SERVICE_ACCOUNT = process.env.WORKER_SERVICE_ACCOUNT;
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET?.trim();
const QUEUE_AGENT_RUNS = `projects/${PROJECT}/locations/${LOCATION}/queues/agent-runs`;

export interface DeepDiveExecutionTask {
  deepDiveId: string;
  runId: string;
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

export async function executeWorkerDeepDiveExecution(task: DeepDiveExecutionTask): Promise<void> {
  if (!WORKER_URL) {
    throw new Error('Worker execution dispatch is not configured. Set WORKER_URL.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (WORKER_SHARED_SECRET) {
    headers['x-worker-shared-secret'] = WORKER_SHARED_SECRET;
  }

  const idTokenClient = await googleAuth.getIdTokenClient(WORKER_URL);
  const response = await idTokenClient.request<unknown>({
    url: `${WORKER_URL}/run`,
    method: 'POST',
    headers,
    data: {
      taskType: 'deep_dive_execute',
      metadata: task,
    },
    validateStatus: () => true,
  });

  if ((response.status ?? 500) >= 400) {
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? {});
    throw new Error(`Worker deep dive dispatch failed (${response.status}): ${text.slice(0, 500)}`);
  }
}

export interface WorkerAgentExecutionPayload {
  runId: string;
  agentRole: CompanyAgentRole;
  task: string;
  payload: Record<string, unknown>;
  message?: string;
  conversationHistory?: ConversationTurn[];
  attachments?: ConversationAttachment[];
  assignmentId?: string;
  directiveId?: string;
}

export async function executeWorkerAgentRun(
  payload: WorkerAgentExecutionPayload,
): Promise<RouteResult> {
  if (!WORKER_URL) {
    throw new Error('Worker execution dispatch is not configured. Set WORKER_URL.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (WORKER_SHARED_SECRET) {
    headers['x-worker-shared-secret'] = WORKER_SHARED_SECRET;
  }

  const idTokenClient = await googleAuth.getIdTokenClient(WORKER_URL);
  const response = await idTokenClient.request<RouteResult>({
    url: `${WORKER_URL}/run`,
    method: 'POST',
    headers,
    data: {
      taskType: 'agent_execute',
      metadata: payload,
    },
    validateStatus: () => true,
  });

  if ((response.status ?? 500) >= 400) {
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? {});
    throw new Error(`Worker execution dispatch failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const result = response.data as RouteResult;
  return result;
}
