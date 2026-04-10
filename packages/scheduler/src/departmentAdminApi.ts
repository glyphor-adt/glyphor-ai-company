import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  activateDepartment,
  getDepartmentDetail,
  getExpansionRecommendations,
  listActiveDepartments,
  listDepartmentsWithStatus,
  listDepartmentTemplates,
  pauseDepartment,
} from '@glyphor/shared';
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

async function getTenantId(params: URLSearchParams, body?: Record<string, unknown>): Promise<string> {
  const fromQuery = params.get('tenantId') ?? params.get('tenant_id');
  if (fromQuery && fromQuery.trim()) return fromQuery.trim();
  const rawBody = body?.tenantId ?? body?.tenant_id ?? body?.organizationId ?? body?.organization_id;
  if (typeof rawBody === 'string' && rawBody.trim()) return rawBody.trim();
  const result = await systemQuery<{ id: string }>(
    `SELECT id
     FROM tenants
     WHERE COALESCE(status, 'active') <> 'disabled'
     ORDER BY created_at ASC NULLS LAST, id ASC
     LIMIT 1`,
  );
  const tenantId = result[0]?.id;
  if (!tenantId) {
    throw new Error('No tenant available for department activation');
  }
  return tenantId;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function asStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item.trim()) output[key] = item.trim();
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function asStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }
  const normalized = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  if (normalized.length !== value.length) {
    throw new Error(`${fieldName} must contain only strings`);
  }
  return normalized;
}

export async function handleDepartmentAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (!url.startsWith('/admin/departments')) return false;

  const params = new URLSearchParams(queryString);
  const send = (status: number, data: unknown) => writeJson(res, status, data, req);

  try {
    if (method === 'GET' && url === '/admin/departments') {
      const tenantId = await getTenantId(params);
      const data = await listDepartmentsWithStatus(tenantId);
      send( 200, data);
      return true;
    }

    if (method === 'GET' && url === '/admin/departments/active') {
      const tenantId = await getTenantId(params);
      const data = await listActiveDepartments(tenantId);
      send( 200, data);
      return true;
    }

    if (method === 'GET' && url === '/admin/departments/recommendations') {
      const tenantId = await getTenantId(params);
      const data = await getExpansionRecommendations(tenantId);
      send( 200, data);
      return true;
    }

    const templatesMatch = url.match(/^\/admin\/departments\/([^/]+)\/templates$/);
    if (templatesMatch && method === 'GET') {
      const departmentId = decodeURIComponent(templatesMatch[1]);
      const data = await listDepartmentTemplates(departmentId);
      send( 200, data);
      return true;
    }

    const activateMatch = url.match(/^\/admin\/departments\/([^/]+)\/activate$/);
    if (activateMatch && method === 'POST') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const tenantId = await getTenantId(params, body);
      const departmentId = decodeURIComponent(activateMatch[1]);
      const result = await activateDepartment(tenantId, departmentId, {
        companyName: requireString(body.companyName ?? body.company_name, 'companyName'),
        departmentLead: requireString(body.departmentLead ?? body.department_lead, 'departmentLead'),
        customAgentNames: asStringMap(body.customAgentNames ?? body.custom_agent_names),
        selectedMcpDomains: asStringArray(body.selectedMcpDomains ?? body.selected_mcp_domains ?? [], 'selectedMcpDomains'),
        activatedByHumanId: typeof (body.activatedByHumanId ?? body.activated_by_human_id) === 'string'
          ? String(body.activatedByHumanId ?? body.activated_by_human_id).trim()
          : undefined,
      });
      send( 200, result);
      return true;
    }

    const pauseMatch = url.match(/^\/admin\/departments\/([^/]+)\/pause$/);
    if (pauseMatch && method === 'PUT') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const tenantId = await getTenantId(params, body);
      const departmentId = decodeURIComponent(pauseMatch[1]);
      const result = await pauseDepartment(
        tenantId,
        departmentId,
        typeof (body.updatedBy ?? body.updated_by) === 'string' ? String(body.updatedBy ?? body.updated_by).trim() : 'admin',
      );
      send( 200, result);
      return true;
    }

    const detailMatch = url.match(/^\/admin\/departments\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const tenantId = await getTenantId(params);
      const departmentId = decodeURIComponent(detailMatch[1]);
      const data = await getDepartmentDetail(tenantId, departmentId);
      send( 200, data);
      return true;
    }

    return false;
  } catch (err) {
    send( 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}