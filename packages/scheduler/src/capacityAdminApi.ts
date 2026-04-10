import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  approveCommitment,
  getAgentCapacityConfig,
  getPendingCommitments,
  listCommitments,
  rejectCommitment,
  reverseCommitment,
  upsertAgentCapacityConfig,
  type CapacityTier,
  type CommitmentRegistryStatus,
} from '@glyphor/shared';
import { writeJson } from './httpJson.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body || '{}'));
    req.on('error', reject);
  });
}

function asStringArray(value: unknown, fieldName: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }
  const items = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (items.length !== value.length) {
    throw new Error(`${fieldName} must contain only strings`);
  }
  return items;
}

function asCapacityTier(value: unknown): CapacityTier {
  if (value === 'observe' || value === 'draft' || value === 'execute' || value === 'commit') {
    return value;
  }
  throw new Error('capacityTier must be observe, draft, execute, or commit');
}

function asCommitmentStatus(value: string | null): CommitmentRegistryStatus | undefined {
  if (!value) return undefined;
  if (value === 'pending_approval' || value === 'approved' || value === 'rejected' || value === 'executed' || value === 'reversed') {
    return value;
  }
  throw new Error('status must be pending_approval, approved, rejected, executed, or reversed');
}

export async function handleCapacityAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (!url.startsWith('/admin/')) return false;

  const params = new URLSearchParams(queryString);
  const send = (status: number, data: unknown) => writeJson(res, status, data, req);

  try {
    const agentCapacityMatch = url.match(/^\/admin\/agents\/([^/]+)\/capacity$/);
    if (agentCapacityMatch && method === 'GET') {
      const agentId = decodeURIComponent(agentCapacityMatch[1]);
      const config = await getAgentCapacityConfig(agentId);
      if (!config) {
        send( 404, { error: `Capacity config not found for ${agentId}` });
        return true;
      }
      send( 200, config);
      return true;
    }

    if (agentCapacityMatch && method === 'PUT') {
      const agentId = decodeURIComponent(agentCapacityMatch[1]);
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const updated = await upsertAgentCapacityConfig(agentId, {
        capacityTier: asCapacityTier(body.capacityTier ?? body.capacity_tier),
        requiresHumanApprovalFor: asStringArray(
          body.requiresHumanApprovalFor ?? body.requires_human_approval_for,
          'requiresHumanApprovalFor',
        ),
        overrideByRoles: asStringArray(body.overrideByRoles ?? body.override_by_roles, 'overrideByRoles'),
        updatedBy: typeof (body.updatedBy ?? body.updated_by) === 'string'
          ? String(body.updatedBy ?? body.updated_by).trim()
          : 'admin',
        metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? body.metadata as Record<string, unknown>
          : {},
      });
      send( 200, updated);
      return true;
    }

    if (method === 'GET' && url === '/admin/commitments') {
      const result = await listCommitments({
        agentId: params.get('agent') ?? undefined,
        status: asCommitmentStatus(params.get('status')),
        dateFrom: params.get('dateFrom') ?? params.get('from') ?? undefined,
        dateTo: params.get('dateTo') ?? params.get('to') ?? undefined,
        counterparty: params.get('counterparty') ?? undefined,
        page: Number(params.get('page') ?? '1'),
        pageSize: Number(params.get('pageSize') ?? '50'),
      });
      send( 200, result);
      return true;
    }

    if (method === 'GET' && url === '/admin/commitments/pending') {
      const result = await getPendingCommitments(
        Number(params.get('page') ?? '1'),
        Number(params.get('pageSize') ?? '100'),
      );
      send( 200, result);
      return true;
    }

    const approveMatch = url.match(/^\/admin\/commitments\/([^/]+)\/approve$/);
    if (approveMatch && method === 'POST') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const approverHumanId = typeof body.approverHumanId === 'string'
        ? body.approverHumanId.trim()
        : typeof body.approvedBy === 'string'
          ? body.approvedBy.trim()
          : '';
      if (!approverHumanId) {
        throw new Error('approverHumanId is required');
      }
      const updated = await approveCommitment(decodeURIComponent(approveMatch[1]), approverHumanId);
      send( 200, updated);
      return true;
    }

    const rejectMatch = url.match(/^\/admin\/commitments\/([^/]+)\/reject$/);
    if (rejectMatch && method === 'POST') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const approverHumanId = typeof body.approverHumanId === 'string' ? body.approverHumanId.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!approverHumanId || !reason) {
        throw new Error('approverHumanId and reason are required');
      }
      const updated = await rejectCommitment(decodeURIComponent(rejectMatch[1]), approverHumanId, reason);
      send( 200, updated);
      return true;
    }

    const reverseMatch = url.match(/^\/admin\/commitments\/([^/]+)\/reverse$/);
    if (reverseMatch && method === 'POST') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!reason) {
        throw new Error('reason is required');
      }
      const updated = await reverseCommitment(decodeURIComponent(reverseMatch[1]), reason);
      send( 200, updated);
      return true;
    }

    return false;
  } catch (err) {
    send( 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}