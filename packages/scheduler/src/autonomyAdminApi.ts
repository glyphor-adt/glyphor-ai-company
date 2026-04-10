import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  demoteAgentAutonomy,
  evaluateAutonomyLevel,
  getAutonomyAgentDetail,
  getAutonomyCohortBenchmarks,
  listAutonomyOverview,
  processDailyAutonomyAdjustments,
  promoteAgentAutonomy,
  updateAgentAutonomyConfig,
  type DailyAutonomyAdjustment,
} from '@glyphor/shared';
import type { AgentNotifier } from './agentNotifier.js';
import { writeJson } from './httpJson.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body || '{}'));
    req.on('error', reject);
  });
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function asOptionalLevel(value: unknown, fieldName: string): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 4) {
    throw new Error(`${fieldName} must be an integer between 0 and 4`);
  }
  return parsed;
}

async function notifyAutonomyChanges(
  agentNotifier: AgentNotifier,
  changes: DailyAutonomyAdjustment[],
): Promise<void> {
  for (const change of changes) {
    const metrics = change.metrics;
    const direction = change.changeType === 'auto_promote' ? 'promoted' : 'demoted';
    const notifyBlock = [
      `<notify type="update" to="both" title="Autonomy ${direction}: ${change.agentId}">`,
      `${change.agentId} moved from level ${change.fromLevel} to level ${change.toLevel}.`,
      `Reason: ${change.reason}`,
      `Metrics: completion=${(metrics.avgCompletionRate * 100).toFixed(1)}%, composite=${(metrics.autonomyCompositeScore * 100).toFixed(1)}%, gate_pass=${(metrics.gatePassRate30d * 100).toFixed(1)}%, golden=${(metrics.goldenEvalPassRate30d * 100).toFixed(1)}%, confidence=${(metrics.avgConfidenceScore * 100).toFixed(1)}%, escalation=${(metrics.escalationRate * 100).toFixed(1)}%, contradictions=${(metrics.contradictionRate * 100).toFixed(1)}%, sla_breach=${(metrics.slaBreachRate * 100).toFixed(1)}%.`,
      `</notify>`,
    ].join('\n');

    await agentNotifier.processAgentOutput('ops', notifyBlock);
  }
}

export async function handleAutonomyAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
  agentNotifier: AgentNotifier,
): Promise<boolean> {
  if (!url.startsWith('/admin/autonomy')) return false;

  const params = new URLSearchParams(queryString);
  const send = (status: number, data: unknown) => writeJson(res, status, data, req);

  try {
    if (method === 'GET' && url === '/admin/autonomy') {
      const department = asOptionalString(params.get('department'));
      const level = asOptionalLevel(params.get('level'), 'level');
      const overview = await listAutonomyOverview({ department, level });
      send( 200, overview);
      return true;
    }

    if (method === 'GET' && url === '/admin/autonomy/cohort-benchmarks') {
      const benchmarks = await getAutonomyCohortBenchmarks();
      send( 200, benchmarks);
      return true;
    }

    if (method === 'POST' && url === '/admin/autonomy/evaluate-daily') {
      const changes = await processDailyAutonomyAdjustments();
      await notifyAutonomyChanges(agentNotifier, changes);
      send( 200, { success: true, changed: changes.length, changes });
      return true;
    }

    const agentMatch = url.match(/^\/admin\/autonomy\/([^/]+)$/);
    if (agentMatch && method === 'GET') {
      const agentId = decodeURIComponent(agentMatch[1]);
      const detail = await getAutonomyAgentDetail(agentId);
      send( 200, detail);
      return true;
    }

    if (agentMatch && method === 'PUT') {
      const agentId = decodeURIComponent(agentMatch[1]);
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const updated = await updateAgentAutonomyConfig(agentId, {
        maxAllowedLevel: asOptionalLevel(body.maxAllowedLevel ?? body.max_allowed_level, 'maxAllowedLevel'),
        autoPromote: asOptionalBoolean(body.autoPromote ?? body.auto_promote),
        autoDemote: asOptionalBoolean(body.autoDemote ?? body.auto_demote),
        updatedBy: asOptionalString(body.updatedBy ?? body.updated_by) ?? 'admin',
        reason: asOptionalString(body.reason),
      });
      const evaluation = await evaluateAutonomyLevel(agentId);
      send( 200, { config: updated, evaluation });
      return true;
    }

    const promoteMatch = url.match(/^\/admin\/autonomy\/([^/]+)\/promote$/);
    if (promoteMatch && method === 'POST') {
      const agentId = decodeURIComponent(promoteMatch[1]);
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const updated = await promoteAgentAutonomy(agentId, {
        targetLevel: asOptionalLevel(body.targetLevel ?? body.target_level, 'targetLevel'),
        changedBy: asOptionalString(body.changedBy ?? body.changed_by) ?? 'admin',
        reason: asOptionalString(body.reason),
      });
      const evaluation = await evaluateAutonomyLevel(agentId);
      send( 200, { config: updated, evaluation });
      return true;
    }

    const demoteMatch = url.match(/^\/admin\/autonomy\/([^/]+)\/demote$/);
    if (demoteMatch && method === 'POST') {
      const agentId = decodeURIComponent(demoteMatch[1]);
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const updated = await demoteAgentAutonomy(agentId, {
        targetLevel: asOptionalLevel(body.targetLevel ?? body.target_level, 'targetLevel'),
        changedBy: asOptionalString(body.changedBy ?? body.changed_by) ?? 'admin',
        reason: asOptionalString(body.reason),
      });
      const evaluation = await evaluateAutonomyLevel(agentId);
      send( 200, { config: updated, evaluation });
      return true;
    }

    return false;
  } catch (err) {
    send( 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}