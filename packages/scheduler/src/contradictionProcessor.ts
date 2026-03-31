import type { AgentExecutionResult, CompanyAgentRole } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import { postTextToChannel, type GraphTeamsClient } from '@glyphor/integrations';
import { systemQuery } from '@glyphor/shared/db';

type AgentExecutorFn = (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
) => Promise<AgentExecutionResult | void>;

export interface ContradictionProcessorResult {
  processed: number;
  autoResolved: number;
  escalatedToChiefOfStaff: number;
  escalatedToHuman: number;
}

export class ContradictionProcessor {
  constructor(
    private readonly memory: CompanyMemoryStore,
    private readonly executor: AgentExecutorFn,
    private readonly graphClient: GraphTeamsClient | null = null,
  ) {}

  async processDetectedContradictions(): Promise<ContradictionProcessorResult> {
    const ci = this.memory.getCollectiveIntelligence();
    await ci.detectContradictions();
    const pending = await ci.listContradictions({ status: 'detected', page: 1, pageSize: 200 });

    let processed = 0;
    let autoResolved = 0;
    let escalatedToChiefOfStaff = 0;
    let escalatedToHuman = 0;
    const humanEscalations: Array<{ id: string; factKey: string; entityType: string; reason: string }> = [];

    for (const contradiction of pending.items) {
      processed += 1;
      const resolution = await ci.resolveContradiction(contradiction.id);

      if (resolution.outcome === 'auto_resolved') {
        autoResolved += 1;
        continue;
      }

      if (resolution.outcome !== 'escalated_to_chief_of_staff' || !resolution.summary) {
        continue;
      }

      escalatedToChiefOfStaff += 1;
      await this.enqueueChiefOfStaffReview(contradiction.id, resolution.summary);

      const cosDecision = await this.evaluateByChiefOfStaff(contradiction.id, resolution.summary);
      await ci.applyChiefOfStaffContradictionDecision(contradiction.id, cosDecision);

      if (cosDecision.action === 'escalate_to_human') {
        escalatedToHuman += 1;
        humanEscalations.push({
          id: contradiction.id,
          factKey: contradiction.fact_key,
          entityType: contradiction.entity_type,
          reason: cosDecision.reason,
        });
      }
    }

    if (humanEscalations.length > 0) {
      await this.notifyAdmins(humanEscalations);
    }

    return {
      processed,
      autoResolved,
      escalatedToChiefOfStaff,
      escalatedToHuman,
    };
  }

  private async enqueueChiefOfStaffReview(
    contradictionId: string,
    summary: Record<string, unknown>,
  ): Promise<void> {
    const message = [
      `Knowledge contradiction requires adjudication: ${contradictionId}`,
      '',
      'Return valid JSON with this schema only:',
      '{"action":"resolve"|"escalate_to_human","winnerFactId":"uuid if resolving","reason":"short rationale","payload":{}}',
      '',
      JSON.stringify(summary, null, 2),
    ].join('\n');

    await systemQuery(
      `INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        'system',
        'chief-of-staff',
        message,
        'escalation',
        'urgent',
        'pending',
        JSON.stringify({ contradictionId, summary, type: 'knowledge_contradiction' }),
      ],
    ).catch(() => {});

    await systemQuery(
      `INSERT INTO agent_wake_queue (agent_role, task, reason, context, status)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      ['chief-of-staff', 'on_demand', 'knowledge_contradiction_review', JSON.stringify({ contradictionId }), 'pending'],
    ).catch(() => {});
  }

  private async evaluateByChiefOfStaff(
    contradictionId: string,
    summary: Record<string, unknown>,
  ): Promise<{
    action: 'resolve' | 'escalate_to_human';
    winnerFactId?: string;
    reason: string;
    payload?: Record<string, unknown>;
  }> {
    const message = [
      'Adjudicate this knowledge contradiction for the organizational knowledge base.',
      'Use only the provided facts and provenance scores.',
      'If one fact is clearly more reliable, resolve it. If not, escalate to human.',
      'Respond with valid JSON only and no prose.',
      'Schema: {"action":"resolve"|"escalate_to_human","winnerFactId":"uuid if resolving","reason":"short rationale","payload":{"confidence":0-1,"recommendation":"..."}}',
      JSON.stringify({ contradictionId, ...summary }, null, 2),
    ].join('\n\n');

    try {
      const result = await this.executor('chief-of-staff', 'on_demand', { message, source: 'contradiction_processor' });
      const parsed = parseChiefOfStaffResponse(result?.output);
      if (parsed && (parsed.action === 'resolve' || parsed.action === 'escalate_to_human')) {
        return parsed;
      }
    } catch (err) {
      return {
        action: 'escalate_to_human',
        reason: `Chief of Staff evaluation failed: ${(err as Error).message}`,
        payload: { contradictionId },
      };
    }

    return {
      action: 'escalate_to_human',
      reason: 'Chief of Staff response could not be parsed as a valid contradiction decision.',
      payload: { contradictionId },
    };
  }

  private async notifyAdmins(
    escalations: Array<{ id: string; factKey: string; entityType: string; reason: string }>,
  ): Promise<void> {
    const lines = escalations.map((item) =>
      `- ${item.id} · ${item.entityType}/${item.factKey} · ${item.reason}`,
    );
    const text = [
      `Human contradiction review required for ${escalations.length} item(s).`,
      '',
      ...lines,
    ].join('\n');

    const alertPost = await postTextToChannel('alerts', text, this.graphClient, 'ops');
    if (alertPost.method === 'none') {
      await postTextToChannel('decisions', text, this.graphClient, 'ops').catch(() => {});
    }
  }
}

function parseChiefOfStaffResponse(output: string | null | undefined): {
  action: 'resolve' | 'escalate_to_human';
  winnerFactId?: string;
  reason: string;
  payload?: Record<string, unknown>;
} | null {
  if (!output) return null;
  const trimmed = output.trim();
  const direct = safeParseJson(trimmed);
  if (direct) return normalizeDecision(direct);

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = safeParseJson(fenced[1]);
    if (parsed) return normalizeDecision(parsed);
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const parsed = safeParseJson(trimmed.slice(firstBrace, lastBrace + 1));
    if (parsed) return normalizeDecision(parsed);
  }

  return null;
}

function safeParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeDecision(value: Record<string, unknown>): {
  action: 'resolve' | 'escalate_to_human';
  winnerFactId?: string;
  reason: string;
  payload?: Record<string, unknown>;
} | null {
  const action = value.action === 'resolve' || value.action === 'escalate_to_human'
    ? value.action
    : null;
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const winnerFactId = typeof value.winnerFactId === 'string' ? value.winnerFactId.trim() : undefined;
  const payload = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
    ? value.payload as Record<string, unknown>
    : undefined;

  if (!action || !reason) return null;
  return { action, winnerFactId, reason, payload };
}