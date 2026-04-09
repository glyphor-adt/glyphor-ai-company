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
const DEFAULT_WORKER_REQUEST_TIMEOUT_MS = 120_000;
const parsedWorkerRequestTimeoutMs = Number.parseInt(process.env.WORKER_REQUEST_TIMEOUT_MS ?? '', 10);
const WORKER_REQUEST_TIMEOUT_MS = Number.isFinite(parsedWorkerRequestTimeoutMs) && parsedWorkerRequestTimeoutMs > 0
  ? parsedWorkerRequestTimeoutMs
  : DEFAULT_WORKER_REQUEST_TIMEOUT_MS;
const parsedWorkerRequestRetryCount = Number.parseInt(process.env.WORKER_REQUEST_RETRY_COUNT ?? '', 10);
const WORKER_REQUEST_RETRY_COUNT = Number.isFinite(parsedWorkerRequestRetryCount) && parsedWorkerRequestRetryCount >= 0
  ? parsedWorkerRequestRetryCount
  : 2;
const parsedWorkerRequestRetryDelayMs = Number.parseInt(process.env.WORKER_REQUEST_RETRY_DELAY_MS ?? '', 10);
const WORKER_REQUEST_RETRY_DELAY_MS = Number.isFinite(parsedWorkerRequestRetryDelayMs) && parsedWorkerRequestRetryDelayMs > 0
  ? parsedWorkerRequestRetryDelayMs
  : 1_500;
const QUEUE_AGENT_RUNS = `projects/${PROJECT}/locations/${LOCATION}/queues/agent-runs`;

function isTransientWorkerError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWorkerWithRetry<T>(
  idTokenClient: Awaited<ReturnType<typeof googleAuth.getIdTokenClient>>,
  request: {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    timeout: number;
    data: unknown;
    validateStatus: () => boolean;
  },
): Promise<{ status?: number | null; data?: T }> {
  let lastError: unknown = null;
  const maxAttempts = Math.max(1, WORKER_REQUEST_RETRY_COUNT + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await idTokenClient.request<T>(request);
    } catch (err) {
      lastError = err;
      if (!isTransientWorkerError(err) || attempt >= maxAttempts) {
        throw err;
      }
      const backoffMs = WORKER_REQUEST_RETRY_DELAY_MS * attempt;
      console.warn(
        `[WorkerQueue] Transient worker dispatch failure (attempt ${attempt}/${maxAttempts}) — retrying in ${backoffMs}ms: ${err instanceof Error ? err.message : String(err)}`,
      );
      await wait(backoffMs);
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Unknown worker dispatch error')));
}

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
  const response = await requestWorkerWithRetry<unknown>(idTokenClient, {
    url: `${WORKER_URL}/run`,
    method: 'POST',
    headers,
    timeout: WORKER_REQUEST_TIMEOUT_MS,
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

/** Enqueue an agent run on the worker via Cloud Tasks (non-blocking; survives long executions). */
export async function enqueueWorkerAgentExecute(metadata: WorkerAgentExecutionPayload): Promise<void> {
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
        body: Buffer.from(
          JSON.stringify({
            taskType: 'agent_execute',
            metadata,
          }),
        ).toString('base64'),
        oidcToken: {
          serviceAccountEmail: WORKER_SERVICE_ACCOUNT,
        },
      },
    },
  });
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
  const response = await requestWorkerWithRetry<RouteResult>(idTokenClient, {
    url: `${WORKER_URL}/run`,
    method: 'POST',
    headers,
    timeout: WORKER_REQUEST_TIMEOUT_MS,
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
