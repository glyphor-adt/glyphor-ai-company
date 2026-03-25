import { systemQuery } from '@glyphor/shared/db';

interface RejectionEvent {
  approvalId: string;
  rejectedBy: string;
  originatingAgent: string;
  rootCauseAgent: string;
  reason: string;
  taskType: string;
}

function normalizeRole(value: string | null | undefined, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return trimmed || fallback;
}

function deriveSkillFromRejection(event: RejectionEvent): string {
  const reason = event.reason.toLowerCase();
  if (reason.includes('agent') || reason.includes('spawn') || reason.includes('creat')) {
    return 'scope_boundaries';
  }
  if (reason.includes('brief') || reason.includes('context') || reason.includes('storyboard')) {
    return 'dispatch_quality';
  }
  if (reason.includes('tool') || reason.includes('nexus') || reason.includes('route')) {
    return 'escalation_routing';
  }
  return 'orchestration_quality';
}

async function writeNegativeEvidence(agentRole: string, skill: string, description: string, weight: number): Promise<void> {
  await systemQuery(
    `INSERT INTO agent_world_model_evidence
       (agent_role, evidence_type, skill, description, weight, created_at)
     VALUES ($1, 'negative', $2, $3, $4, NOW())`,
    [agentRole, skill, description, weight],
  );
}

export async function handleFounderRejection(event: RejectionEvent): Promise<void> {
  const rootCauseAgent = normalizeRole(event.rootCauseAgent, event.originatingAgent);
  const originatingAgent = normalizeRole(event.originatingAgent, rootCauseAgent);
  const reason = (event.reason || 'No rejection reason provided').trim();

  await writeNegativeEvidence(
    rootCauseAgent,
    deriveSkillFromRejection(event),
    `Founder rejection: ${reason}. Task type: ${event.taskType}. Triggered by: ${originatingAgent}.`,
    -1.0,
  );

  if (rootCauseAgent !== 'chief-of-staff') {
    await writeNegativeEvidence(
      'chief-of-staff',
      'orchestration_quality',
      `Founder rejection linked to ${rootCauseAgent}: ${reason}`,
      -0.5,
    );
  }

  await systemQuery(
    `INSERT INTO fleet_findings
       (agent_id, severity, finding_type, title, description, evidence_data, created_at)
     VALUES ($1, 'P2', 'founder_rejection', $2, $3, $4::jsonb, NOW())`,
    [
      rootCauseAgent,
      `Founder rejected: ${event.taskType}`,
      reason,
      JSON.stringify(event),
    ],
  );
}

export async function handleIllegalAgentCreationRequest(
  requestingAgentRole: string,
  requestedAgentName: string,
  context: string,
): Promise<void> {
  const requester = normalizeRole(requestingAgentRole, 'unknown');

  await writeNegativeEvidence(
    requester,
    'scope_boundaries',
    `Attempted to create new agent "${requestedAgentName}" — outside role scope. Context: ${context}`,
    -1.0,
  );

  await writeNegativeEvidence(
    'chief-of-staff',
    'escalation_routing',
    `Failed to intercept agent creation request from ${requester}. Requested agent: "${requestedAgentName}".`,
    -0.75,
  );
}

export async function handleMisroutedToolGap(
  requestingAgentRole: string,
  toolName: string,
): Promise<void> {
  const requester = normalizeRole(requestingAgentRole, 'unknown');

  await writeNegativeEvidence(
    'chief-of-staff',
    'escalation_routing',
    `Tool gap "${toolName}" from ${requester} reached founders instead of Nexus.`,
    -0.75,
  );

  await systemQuery(
    `INSERT INTO fleet_findings (agent_id, severity, finding_type, title, description, evidence_data, created_at)
     VALUES ($1, 'P2', 'tool_gap', $2, $3, $4::jsonb, NOW())`,
    [
      'platform-intel',
      `Tool gap routed to Nexus: ${toolName}`,
      `Auto-routed tool gap for ${requester}.`,
      JSON.stringify({ requestingAgentRole: requester, toolName, source: 'auto-route' }),
    ],
  );
}
