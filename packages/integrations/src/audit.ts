/**
 * Platform Audit Logger
 *
 * Wraps external API calls with structured audit logging to
 * the platform_audit_log table. Every integration call can be
 * traced back to the agent that initiated it.
 */

import { systemQuery } from '@glyphor/shared/db';

export interface AuditContext {
  agentRole: string;
  platform: string;
  action: string;
  resource?: string;
  costEstimate?: number;
  requestPayload?: Record<string, unknown>;
}

export interface MicrosoftWriteAuditContext {
  agentRole: string;
  action: string;
  resource: string;
  identityType: string;
  tenantId?: string | null;
  workspaceKey?: string | null;
  approvalId?: string | null;
  toolName?: string | null;
  outcome?: 'success' | 'failure';
  fallbackUsed?: boolean;
  targetType?: string;
  targetId?: string;
  approvalReference?: string | null;
  limitation?: string | null;
  responseCode?: number;
  responseSummary?: string;
}

/**
 * Wrap any external API call with audit logging.
 * Logs the agent, platform, action, and response status to the database.
 */
export async function auditedFetch<T>(
  ctx: AuditContext,
  fn: () => Promise<T & { status?: number; ok?: boolean }>,
): Promise<T> {
  let responseCode: number | undefined;
  let responseSummary: string | undefined;

  try {
    const result = await fn();

    // If the result has HTTP response-like shape, extract status
    if (typeof result === 'object' && result !== null) {
      const r = result as Record<string, unknown>;
      if (typeof r.status === 'number') responseCode = r.status;
      responseSummary = r.ok === false ? 'error' : 'success';
    } else {
      responseSummary = 'success';
    }

    await logAudit(ctx, responseCode, responseSummary);
    return result;
  } catch (error) {
    responseSummary = (error as Error).message?.slice(0, 500);
    await logAudit(ctx, responseCode ?? 500, responseSummary);
    throw error;
  }
}

/**
 * Log an external API call result directly (when not wrapping a fetch).
 */
export async function logPlatformAudit(
  ctx: AuditContext & { responseCode?: number; responseSummary?: string },
): Promise<void> {
  await logAudit(ctx, ctx.responseCode, ctx.responseSummary);
}

export async function logMicrosoftWriteAudit(
  ctx: MicrosoftWriteAuditContext,
): Promise<void> {
  await logAudit(
    {
      agentRole: ctx.agentRole,
      platform: 'microsoft',
      action: ctx.action,
      resource: ctx.resource,
      requestPayload: {
        identityType: ctx.identityType,
        tenantId: ctx.tenantId ?? null,
        workspaceKey: ctx.workspaceKey ?? null,
        approvalId: ctx.approvalId ?? null,
        toolName: ctx.toolName ?? null,
        outcome: ctx.outcome ?? null,
        fallbackUsed: ctx.fallbackUsed ?? false,
        targetType: ctx.targetType ?? null,
        targetId: ctx.targetId ?? null,
        approvalReference: ctx.approvalReference ?? null,
        limitation: ctx.limitation ?? null,
      },
    },
    ctx.responseCode,
    ctx.responseSummary,
  );
}

async function logAudit(
  ctx: AuditContext,
  responseCode?: number,
  responseSummary?: string,
): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO platform_audit_log
         (agent_role, platform, action, resource, request_payload, response_code, response_summary, cost_estimate)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        ctx.agentRole,
        ctx.platform,
        ctx.action,
        ctx.resource ?? null,
        ctx.requestPayload ? JSON.stringify(ctx.requestPayload) : null,
        responseCode ?? null,
        responseSummary ?? null,
        ctx.costEstimate ?? null,
      ],
    );
  } catch (err) {
    // Audit logging should never break the main flow
    console.warn('[PlatformAudit] Failed to log:', (err as Error).message);
  }
}
