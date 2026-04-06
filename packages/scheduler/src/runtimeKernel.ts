import crypto from 'node:crypto';
import type { CompanyAgentRole, ConversationAttachment, ConversationTurn } from '@glyphor/agent-runtime';
import type { EventRouter, RouteResult } from './eventRouter.js';

export interface DashboardRunRequestBody {
  agentRole?: string;
  agent?: string;
  task?: string;
  runId?: string;
  userName?: string;
  message?: string;
  history?: { role: string; content: string }[];
  payload?: Record<string, unknown>;
  persistTranscript?: boolean;
  conversationId?: string;
  attachments?: Array<{ name: string; mimeType: string; data: string }>;
}

export interface NormalizedDashboardRunRequest {
  agentRole: CompanyAgentRole;
  task: string;
  runId: string;
  userName?: string;
  originalMessage: string;
  message?: string;
  conversationHistory: ConversationTurn[];
  payload: Record<string, unknown>;
  attachments?: ConversationAttachment[];
  persistTranscript: boolean;
  conversationId: string;
}

export function buildDashboardConversationId(email: string, agentRole: string): string {
  return `dashboard:${email.trim().toLowerCase()}:${agentRole}`;
}

export function buildDashboardResultContent(result: {
  output?: string | null;
  action?: string;
  status?: string;
  error?: string;
  reason?: string;
}): string {
  if (typeof result.output === 'string' && result.output.trim().length > 0) {
    return result.output;
  }
  if (result.action === 'queued_for_approval') {
    return 'This request was sent to your approval queue for review.';
  }
  if (result.status === 'aborted') {
    return 'Sorry, I wasn’t able to finish my response. Could you try again?';
  }
  if (result.error || result.reason) {
    const raw = String(result.error ?? result.reason);
    return `Something went wrong: ${raw.replace(/sk-ant-[a-zA-Z0-9_-]+|sk-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]+/g, '[REDACTED]')}`;
  }
  return 'I completed the task but had nothing to report back.';
}

export function normalizeDashboardRunRequest(input: {
  body: DashboardRunRequestBody;
  dashboardUserEmail: string;
  dbRunIdTurnPrefix: string;
}): NormalizedDashboardRunRequest {
  const { body, dashboardUserEmail, dbRunIdTurnPrefix } = input;
  const agentRole = (body.agentRole ?? body.agent) as CompanyAgentRole;
  const runId = typeof body.runId === 'string' && body.runId.trim().length > 0
    ? body.runId.trim()
    : crypto.randomUUID();
  const userName = typeof body.userName === 'string' ? body.userName : undefined;
  const originalMessage = typeof body.message === 'string' ? body.message : '';
  const persistTranscript = body.persistTranscript === true;
  const conversationId = typeof body.conversationId === 'string' && body.conversationId.trim().length > 0
    ? body.conversationId.trim()
    : buildDashboardConversationId(dashboardUserEmail, agentRole);

  let message: string | undefined = originalMessage || undefined;
  if (message && dashboardUserEmail) {
    const founders: Record<string, string> = {
      'kristina@glyphor.ai': 'Kristina',
      'andrew@glyphor.ai': 'Andrew',
    };
    const effectiveEmail = dashboardUserEmail.toLowerCase();
    const founderName = founders[effectiveEmail];
    const identity = founderName
      ? `[You are speaking with ${founderName} (${effectiveEmail}), Co-Founder of Glyphor. Treat this as a direct conversation with your founder.]`
      : `[You are speaking with ${userName ?? 'a user'} (${effectiveEmail}).]`;
    message = `${identity}\n${message}`;
  }

  const rawHistory = Array.isArray(body.history) ? body.history : undefined;
  const conversationHistory: ConversationTurn[] = [];
  if (rawHistory?.length) {
    for (const h of rawHistory) {
      conversationHistory.push({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content,
        timestamp: Date.now(),
      });
    }
  }
  const hasDbRunCarrier = conversationHistory.some(
    (turn) => typeof turn.content === 'string' && turn.content.startsWith(dbRunIdTurnPrefix),
  );
  if (!hasDbRunCarrier) {
    conversationHistory.unshift({
      role: 'user',
      content: `${dbRunIdTurnPrefix}${runId}`,
      timestamp: Date.now(),
    });
  }

  const attachments = body.attachments?.length
    ? body.attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, data: a.data }))
    : undefined;

  return {
    agentRole,
    task: body.task ?? 'on_demand',
    runId,
    userName,
    originalMessage,
    message,
    conversationHistory,
    payload: (body.payload ?? {}) as Record<string, unknown>,
    attachments,
    persistTranscript,
    conversationId,
  };
}

export async function executeDashboardRun(
  router: EventRouter,
  normalized: NormalizedDashboardRunRequest,
): Promise<RouteResult> {
  return router.route({
    source: 'manual',
    agentRole: normalized.agentRole,
    task: normalized.task,
    payload: {
      ...normalized.payload,
      runId: normalized.runId,
      message: normalized.message,
      ...(normalized.attachments ? { attachments: normalized.attachments } : {}),
      ...(normalized.conversationHistory.length > 0 ? { conversationHistory: normalized.conversationHistory } : {}),
    },
  });
}

