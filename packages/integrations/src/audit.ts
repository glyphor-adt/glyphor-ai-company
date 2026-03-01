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

async function logAudit(
  ctx: AuditContext,
  responseCode?: number,
  responseSummary?: string,
): Promise<void> {
  try {
    await systemQuery(
      'INSERT INTO platform_audit_log (agent_role, platform, action, resource, response_code, response_summary, cost_estimate) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [ctx.agentRole, ctx.platform, ctx.action, ctx.resource ?? null, responseCode ?? null, responseSummary ?? null, ctx.costEstimate ?? null],
    );
  } catch (err) {
    // Audit logging should never break the main flow
    console.warn('[PlatformAudit] Failed to log:', (err as Error).message);
  }
}
