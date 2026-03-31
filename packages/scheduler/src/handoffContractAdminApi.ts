import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getContractById,
  listContracts,
  validateContractOutput,
  type HandoffContractStatus,
} from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function resolveAgentKey(agentKey: string): Promise<string | null> {
  const rows = await systemQuery<{ role: string }>(
    'SELECT role FROM company_agents WHERE id::text = $1 OR role = $1 LIMIT 1',
    [agentKey],
  );
  return rows[0]?.role ?? null;
}

export async function handleHandoffContractAdminApi(
  _req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;

  const params = new URLSearchParams(queryString);

  if (url === '/admin/contracts') {
    const page = Math.max(1, Number(params.get('page') ?? '1'));
    const pageSize = Math.min(200, Math.max(1, Number(params.get('pageSize') ?? '50')));
    const requestingAgentInput = params.get('requestingAgent');
    const receivingAgentInput = params.get('receivingAgent');
    const requestingAgent = requestingAgentInput ? await resolveAgentKey(requestingAgentInput) : null;
    const receivingAgent = receivingAgentInput ? await resolveAgentKey(receivingAgentInput) : null;
    const status = params.get('status') as HandoffContractStatus | null;

    const result = await listContracts(
      {
        status: status ?? undefined,
        requestingAgentId: requestingAgent ?? undefined,
        receivingAgentId: receivingAgent ?? undefined,
        startDate: params.get('startDate') ?? undefined,
        endDate: params.get('endDate') ?? undefined,
      },
      page,
      pageSize,
    );

    json(res, 200, {
      page,
      pageSize,
      total: result.total,
      contracts: result.contracts,
    });
    return true;
  }

  if (url === '/admin/contracts/pending') {
    const result = await listContracts({ status: 'issued' }, 1, 200);
    json(res, 200, { total: result.total, contracts: result.contracts });
    return true;
  }

  if (url === '/admin/contracts/sla-breaches') {
    const rows = await systemQuery(
      `SELECT *
       FROM agent_handoff_contracts
       WHERE sla_breached_at IS NOT NULL
       ORDER BY COALESCE(sla_breached_at, deadline) ASC`,
      [],
    );
    json(res, 200, rows);
    return true;
  }

  const agentMatch = url.match(/^\/admin\/agents\/([^/]+)\/contracts$/);
  if (agentMatch) {
    const agentKey = decodeURIComponent(agentMatch[1]);
    const canonicalAgent = await resolveAgentKey(agentKey);
    if (!canonicalAgent) {
      json(res, 404, { error: `Agent not found: ${agentKey}` });
      return true;
    }

    const rows = await systemQuery(
      `SELECT *
       FROM agent_handoff_contracts
       WHERE requesting_agent_id = $1 OR receiving_agent_id = $1
       ORDER BY issued_at DESC`,
      [canonicalAgent],
    );
    json(res, 200, { agentId: canonicalAgent, total: rows.length, contracts: rows });
    return true;
  }

  const detailMatch = url.match(/^\/admin\/contracts\/([^/]+)$/);
  if (!detailMatch) return false;

  const contractId = decodeURIComponent(detailMatch[1]);
  const contract = await getContractById(contractId);
  const validationResult = contract.outputPayload === undefined
    ? null
    : validateContractOutput(contract, contract.outputPayload);
  const auditTrail = await systemQuery(
    `SELECT event_type, details, created_at
     FROM agent_handoff_contract_audit_log
     WHERE contract_id = $1
     ORDER BY created_at DESC`,
    [contractId],
  );

  json(res, 200, {
    contract,
    validationResult,
    auditTrail,
  });
  return true;
}