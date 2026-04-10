import type { IncomingMessage, ServerResponse } from 'node:http';
import { getAgentDisclosureConfig } from '@glyphor/agent-runtime';
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

async function resolveAgentKey(agentKey: string): Promise<string | null> {
  const rows = await systemQuery<{ role: string }>(
    'SELECT role FROM company_agents WHERE id::text = $1 OR role = $1 LIMIT 1',
    [agentKey],
  );
  return rows[0]?.role ?? null;
}

export async function handleDisclosureAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  const send = (status: number, data: unknown) => writeJson(res, status, data, req);
  const agentConfigMatch = url.match(/^\/admin\/agents\/([^/]+)\/disclosure$/);
  if (agentConfigMatch) {
    const agentKey = decodeURIComponent(agentConfigMatch[1]);
    const canonicalAgentId = await resolveAgentKey(agentKey);
    if (!canonicalAgentId) {
      send( 404, { error: `Agent not found: ${agentKey}` });
      return true;
    }

    if (method === 'GET') {
      const config = await getAgentDisclosureConfig(canonicalAgentId);
      send( 200, config);
      return true;
    }

    if (method === 'PUT') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const disclosureLevel = body.disclosureLevel ?? body.disclosure_level ?? 'internal_only';
      const emailSignatureTemplate = body.emailSignatureTemplate ?? body.email_signature_template ?? null;
      const displayNameSuffix = body.displayNameSuffix ?? body.display_name_suffix ?? null;
      const externalCommitmentGate = body.externalCommitmentGate ?? body.external_commitment_gate ?? true;

      const [row] = await systemQuery(
        `INSERT INTO agent_disclosure_config
           (agent_id, disclosure_level, email_signature_template, display_name_suffix, external_commitment_gate, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (agent_id) DO UPDATE
         SET disclosure_level = EXCLUDED.disclosure_level,
             email_signature_template = EXCLUDED.email_signature_template,
             display_name_suffix = EXCLUDED.display_name_suffix,
             external_commitment_gate = EXCLUDED.external_commitment_gate,
             updated_at = NOW()
         RETURNING agent_id, disclosure_level, email_signature_template, display_name_suffix, external_commitment_gate, updated_at`,
        [
          canonicalAgentId,
          disclosureLevel,
          emailSignatureTemplate,
          displayNameSuffix,
          externalCommitmentGate,
        ],
      );

      send( 200, {
        agentId: row.agent_id,
        disclosureLevel: row.disclosure_level,
        emailSignatureTemplate: row.email_signature_template,
        displayNameSuffix: row.display_name_suffix,
        externalCommitmentGate: row.external_commitment_gate,
        updatedAt: row.updated_at,
      });
      return true;
    }

    send( 405, { error: `Unsupported method for ${url}: ${method}` });
    return true;
  }

  if (!(method === 'GET' && url === '/admin/disclosure/audit')) {
    return false;
  }

  const params = new URLSearchParams(queryString);
  const page = Math.max(1, Number(params.get('page') ?? '1'));
  const pageSize = Math.min(200, Math.max(1, Number(params.get('pageSize') ?? '50')));
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const values: unknown[] = [];

  const agentId = params.get('agentId');
  if (agentId) {
    const canonicalAgentId = await resolveAgentKey(agentId);
    if (canonicalAgentId) {
      values.push(canonicalAgentId);
      conditions.push(`agent_id = $${values.length}`);
    }
  }

  const startDate = params.get('startDate');
  if (startDate) {
    values.push(startDate);
    conditions.push(`created_at >= $${values.length}`);
  }

  const endDate = params.get('endDate');
  if (endDate) {
    values.push(endDate);
    conditions.push(`created_at <= $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRows = await systemQuery<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM disclosure_audit_log ${where}`,
    values,
  );

  values.push(pageSize, offset);
  const entries = await systemQuery(
    `SELECT * FROM disclosure_audit_log ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  send( 200, {
    page,
    pageSize,
    total: countRows[0]?.count ?? 0,
    entries,
  });
  return true;
}