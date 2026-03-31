import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModelClient } from '@glyphor/agent-runtime';
import { markdownToPdf } from '@glyphor/integrations';
import {
  getDecisionTraceById,
  getTierModel,
  queryDecisionTrace,
  updateDecisionTraceExplanation,
  type DecisionTraceEntry,
  type DecisionTraceQueryFilters,
} from '@glyphor/shared';
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

function parsePositiveInteger(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}

function buildExplainPrompt(trace: DecisionTraceEntry): string {
  return [
    'Explain why the agent made this decision in 2-3 concise sentences.',
    'Focus on the reasoning, tradeoffs, and controls applied. Do not mention that you are an AI.',
    JSON.stringify({
      agent_id: trace.agentId,
      task_id: trace.taskId,
      decision_type: trace.auditLog.action,
      audit_summary: trace.auditLog.summary,
      audit_description: trace.auditLog.description,
      confidence_at_decision: trace.confidenceAtDecision,
      react_iterations: trace.reactIterations,
      self_critique_output: trace.selfCritiqueOutput,
      value_analysis_result: trace.valueAnalysisResult,
      alternatives_rejected: trace.alternativesRejected,
      abac_decisions: trace.abacDecisions,
      final_decision_summary: trace.finalDecisionSummary,
      linked_contract: trace.contract,
    }, null, 2),
  ].join('\n\n');
}

function buildExportMarkdown(trace: DecisionTraceEntry, explanation: string): string {
  return [
    '# Decision Trace Export',
    '',
    `- Trace ID: ${trace.id}`,
    `- Audit Log ID: ${trace.auditLog.id}`,
    `- Agent ID: ${trace.agentId}`,
    `- Task ID: ${trace.taskId ?? 'n/a'}`,
    `- Decision Type: ${trace.auditLog.action}`,
    `- Confidence: ${trace.confidenceAtDecision ?? 'n/a'}`,
    `- Created At: ${trace.createdAt}`,
    '',
    '## Decision Summary',
    '',
    trace.finalDecisionSummary ?? trace.auditLog.summary ?? 'No summary recorded.',
    '',
    '## Natural Language Explanation',
    '',
    explanation,
    '',
    '## Structured Trace',
    '',
    '```json',
    JSON.stringify(trace, null, 2),
    '```',
  ].join('\n');
}

async function getDecisionExplanation(trace: DecisionTraceEntry, modelClient: ModelClient): Promise<string> {
  if (trace.nlExplanation && trace.nlExplanation.trim().length > 0) {
    return trace.nlExplanation;
  }

  const response = await modelClient.generate({
    model: getTierModel('default'),
    systemInstruction: 'You explain operational decision traces for auditors. Be precise, neutral, and concise.',
    contents: [{
      role: 'user',
      content: buildExplainPrompt(trace),
      timestamp: Date.now(),
    }],
    temperature: 0.1,
    maxTokens: 220,
    fallbackScope: 'same-provider',
    metadata: {
      agentRole: 'ops',
    },
  });

  const explanation = (response.text ?? '').trim();
  if (!explanation) {
    throw new Error(`Unable to generate explanation for decision trace ${trace.id}`);
  }
  await updateDecisionTraceExplanation(trace.id, explanation);
  return explanation;
}

async function loadDecisionOr404(traceId: string, res: ServerResponse): Promise<DecisionTraceEntry | null> {
  const trace = await getDecisionTraceById(traceId);
  if (!trace) {
    json(res, 404, { error: `Decision trace not found: ${traceId}` });
    return null;
  }
  return trace;
}

function buildFilters(params: URLSearchParams, overrides?: Partial<DecisionTraceQueryFilters>): DecisionTraceQueryFilters {
  const startDate = params.get('startDate') ?? undefined;
  const endDate = params.get('endDate') ?? undefined;
  return {
    agentId: params.get('agentId') ?? undefined,
    taskId: params.get('taskId') ?? undefined,
    decisionType: params.get('decisionType') ?? undefined,
    minConfidence: params.get('minConfidence') ? Number(params.get('minConfidence')) : undefined,
    maxConfidence: params.get('maxConfidence') ? Number(params.get('maxConfidence')) : undefined,
    dateRange: startDate || endDate
      ? {
        from: startDate,
        to: endDate,
      }
      : undefined,
    page: parsePositiveInteger(params.get('page'), 1, 100000),
    pageSize: parsePositiveInteger(params.get('pageSize'), 50, 200),
    ...overrides,
  };
}

export async function handleDecisionTraceAdminApi(
  _req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
  options: { modelClient: ModelClient },
): Promise<boolean> {
  if (method !== 'GET') return false;

  const params = new URLSearchParams(queryString);

  if (url === '/admin/decisions') {
    const filters = buildFilters(params);
    const result = await queryDecisionTrace(filters);
    json(res, 200, {
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      decisions: result.items,
    });
    return true;
  }

  const agentMatch = url.match(/^\/admin\/agents\/([^/]+)\/decisions$/);
  if (agentMatch) {
    const agentKey = decodeURIComponent(agentMatch[1]);
    const canonicalAgent = await resolveAgentKey(agentKey);
    if (!canonicalAgent) {
      json(res, 404, { error: `Agent not found: ${agentKey}` });
      return true;
    }

    const filters = buildFilters(params, { agentId: canonicalAgent });
    const result = await queryDecisionTrace(filters);
    json(res, 200, {
      agentId: canonicalAgent,
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      decisions: result.items,
    });
    return true;
  }

  const taskMatch = url.match(/^\/admin\/tasks\/([^/]+)\/decisions$/);
  if (taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    const filters = buildFilters(params, { taskId });
    const result = await queryDecisionTrace(filters);
    json(res, 200, {
      taskId,
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      decisions: result.items,
    });
    return true;
  }

  const explainMatch = url.match(/^\/admin\/decisions\/([^/]+)\/explain$/);
  if (explainMatch) {
    const traceId = decodeURIComponent(explainMatch[1]);
    const trace = await loadDecisionOr404(traceId, res);
    if (!trace) return true;

    const explanation = await getDecisionExplanation(trace, options.modelClient);
    json(res, 200, {
      id: trace.id,
      auditLogId: trace.auditLog.id,
      explanation,
      cached: Boolean(trace.nlExplanation && trace.nlExplanation.trim().length > 0),
    });
    return true;
  }

  const exportMatch = url.match(/^\/admin\/decisions\/([^/]+)\/export$/);
  if (exportMatch) {
    const traceId = decodeURIComponent(exportMatch[1]);
    const trace = await loadDecisionOr404(traceId, res);
    if (!trace) return true;

    const format = (params.get('format') ?? 'json').toLowerCase();
    if (format !== 'json' && format !== 'pdf') {
      json(res, 400, { error: `Unsupported export format: ${format}` });
      return true;
    }

    if (format === 'json') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="decision-trace-${trace.id}.json"`);
      res.end(JSON.stringify(trace, null, 2));
      return true;
    }

    const explanation = await getDecisionExplanation(trace, options.modelClient);
    const pdf = await markdownToPdf(buildExportMarkdown(trace, explanation), {
      title: `Decision Trace ${trace.id}`,
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="decision-trace-${trace.id}.pdf"`);
    res.end(pdf);
    return true;
  }

  const detailMatch = url.match(/^\/admin\/decisions\/([^/]+)$/);
  if (!detailMatch) return false;

  const traceId = decodeURIComponent(detailMatch[1]);
  const trace = await loadDecisionOr404(traceId, res);
  if (!trace) return true;

  json(res, 200, trace);
  return true;
}