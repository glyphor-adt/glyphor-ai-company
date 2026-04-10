import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  checkAgentPermission,
  ensureAgentRoleRecord,
  isClassificationLevel,
  resolveClassificationLevel,
  testAgentPermissionByRole,
} from '@glyphor/agent-runtime';
import type { AbacPermission, DataClassificationLevel } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { writeJson } from './httpJson.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body || '{}'));
    req.on('error', reject);
  });
}

function normalizeText(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parsePermission(value: unknown): AbacPermission {
  if (value === 'allow' || value === 'deny') return value;
  throw new Error('permission must be allow or deny');
}

function parseClassification(value: unknown): DataClassificationLevel {
  if (isClassificationLevel(value)) return value;
  throw new Error('classification_level must be public, internal, confidential, or restricted');
}

async function resolveAgentRoleId(body: Record<string, unknown>): Promise<string> {
  if (typeof body.agent_role_id === 'string' && body.agent_role_id.trim().length > 0) {
    return body.agent_role_id.trim();
  }
  if (typeof body.agentRole === 'string' && body.agentRole.trim().length > 0) {
    return ensureAgentRoleRecord(body.agentRole.trim());
  }
  if (typeof body.agent_role === 'string' && body.agent_role.trim().length > 0) {
    return ensureAgentRoleRecord(body.agent_role.trim());
  }
  throw new Error('agentRole or agent_role_id is required');
}

export async function handleAbacAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (!url.startsWith('/admin/abac/')) return false;

  const path = url.slice('/admin/abac/'.length);
  const params = new URLSearchParams(queryString);
  const send = (status: number, data: unknown) => writeJson(res, status, data, req);

  try {
    if (method === 'GET' && path === 'policies') {
      const role = params.get('role');
      const domain = params.get('domain');
      const conditions: string[] = [];
      const values: unknown[] = [];

      if (role) {
        values.push(role);
        conditions.push(`ar.name = $${values.length}`);
      }
      if (domain) {
        values.push(normalizeText(domain, 'domain'));
        conditions.push(`p.mcp_domain = $${values.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await systemQuery(
        `SELECT p.id, ar.id AS agent_role_id, ar.name AS agent_role, ar.description AS role_description,
                p.mcp_domain, p.resource_type, p.classification_level, p.permission, p.priority,
                p.created_at, p.updated_at
         FROM abac_policies p
         JOIN agent_roles ar ON ar.id = p.agent_role_id
         ${where}
         ORDER BY ar.name ASC, p.mcp_domain ASC, p.priority DESC, p.created_at DESC`,
        values,
      );
      send( 200, rows);
      return true;
    }

    if (method === 'POST' && path === 'policies') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const agentRoleId = await resolveAgentRoleId(body);
      const mcpDomain = normalizeText(body.mcpDomain ?? body.mcp_domain, 'mcpDomain');
      const resourceType = body.resourceType == null && body.resource_type == null
        ? null
        : normalizeText(body.resourceType ?? body.resource_type, 'resourceType');
      const classificationLevel = parseClassification(body.classificationLevel ?? body.classification_level);
      const permission = parsePermission(body.permission);
      const priority = Number(body.priority ?? 0);

      const [created] = await systemQuery(
        `INSERT INTO abac_policies
           (agent_role_id, mcp_domain, resource_type, classification_level, permission, priority, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [agentRoleId, mcpDomain, resourceType, classificationLevel, permission, Number.isFinite(priority) ? priority : 0, new Date().toISOString(), new Date().toISOString()],
      );
      send( 201, created);
      return true;
    }

    const policyMatch = path.match(/^policies\/([^/?]+)$/);
    if (policyMatch && method === 'PUT') {
      const policyId = decodeURIComponent(policyMatch[1]);
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const updates: string[] = [];
      const values: unknown[] = [];

      if ('agentRole' in body || 'agent_role' in body || 'agent_role_id' in body) {
        values.push(await resolveAgentRoleId(body));
        updates.push(`agent_role_id = $${values.length}`);
      }
      if ('mcpDomain' in body || 'mcp_domain' in body) {
        values.push(normalizeText(body.mcpDomain ?? body.mcp_domain, 'mcpDomain'));
        updates.push(`mcp_domain = $${values.length}`);
      }
      if ('resourceType' in body || 'resource_type' in body) {
        const resourceType = body.resourceType ?? body.resource_type;
        values.push(resourceType == null ? null : normalizeText(resourceType, 'resourceType'));
        updates.push(`resource_type = $${values.length}`);
      }
      if ('classificationLevel' in body || 'classification_level' in body) {
        values.push(parseClassification(body.classificationLevel ?? body.classification_level));
        updates.push(`classification_level = $${values.length}`);
      }
      if ('permission' in body) {
        values.push(parsePermission(body.permission));
        updates.push(`permission = $${values.length}`);
      }
      if ('priority' in body) {
        const priority = Number(body.priority);
        values.push(Number.isFinite(priority) ? priority : 0);
        updates.push(`priority = $${values.length}`);
      }

      values.push(new Date().toISOString());
      updates.push(`updated_at = $${values.length}`);
      values.push(policyId);

      if (updates.length === 1) {
        send( 400, { error: 'No policy fields provided for update' });
        return true;
      }

      const [updated] = await systemQuery(
        `UPDATE abac_policies
         SET ${updates.join(', ')}
         WHERE id = $${values.length}
         RETURNING *`,
        values,
      );
      if (!updated) {
        send( 404, { error: 'Policy not found' });
      } else {
        send( 200, updated);
      }
      return true;
    }

    if (policyMatch && method === 'DELETE') {
      const policyId = decodeURIComponent(policyMatch[1]);
      await systemQuery('DELETE FROM abac_policies WHERE id = $1', [policyId]);
      send( 200, { success: true, id: policyId });
      return true;
    }

    if (method === 'POST' && path === 'test') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const agentRole = typeof body.agentRole === 'string'
        ? body.agentRole.trim()
        : typeof body.agent_role === 'string'
          ? body.agent_role.trim()
          : '';
      if (!agentRole) {
        send( 400, { error: 'agentRole is required' });
        return true;
      }

      const mcpDomain = normalizeText(body.mcpDomain ?? body.mcp_domain, 'mcpDomain');
      const resourceType = normalizeText(body.resourceType ?? body.resource_type, 'resourceType');
      const classification = 'classificationLevel' in body || 'classification_level' in body
        ? { classificationLevel: parseClassification(body.classificationLevel ?? body.classification_level), reason: 'Provided explicitly by caller' }
        : await resolveClassificationLevel(mcpDomain, resourceType);

      const result = await testAgentPermissionByRole(agentRole, mcpDomain, resourceType, classification.classificationLevel);
      send( 200, {
        mcpDomain,
        resourceType,
        classificationLevel: classification.classificationLevel,
        classificationReason: classification.reason,
        ...result,
      });
      return true;
    }

    if (method === 'GET' && path === 'audit') {
      const page = Math.max(1, Number(params.get('page') ?? '1'));
      const pageSize = Math.min(200, Math.max(1, Number(params.get('pageSize') ?? '50')));
      const offset = (page - 1) * pageSize;

      const conditions: string[] = [];
      const values: unknown[] = [];
      const filterMap: Array<[string, string]> = [
        ['agent_role', 'agentRole'],
        ['mcp_domain', 'domain'],
        ['resource_type', 'resourceType'],
        ['decision', 'decision'],
      ];

      for (const [column, key] of filterMap) {
        const value = params.get(key);
        if (!value) continue;
        values.push(key === 'decision' ? value : normalizeText(value, key));
        conditions.push(`${column} = $${values.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countRows = await systemQuery<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM abac_audit_log ${where}`,
        values,
      );

      values.push(pageSize, offset);
      const rows = await systemQuery(
        `SELECT * FROM abac_audit_log ${where}
         ORDER BY timestamp DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );

      send( 200, {
        page,
        pageSize,
        total: countRows[0]?.count ?? 0,
        entries: rows,
      });
      return true;
    }

    send( 404, { error: `Unknown ABAC admin endpoint: ${path}` });
    return true;
  } catch (err) {
    send( 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}