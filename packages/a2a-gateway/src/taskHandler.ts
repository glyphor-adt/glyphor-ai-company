import { createHash } from 'node:crypto';

import { systemQuery, systemTransaction } from '@glyphor/shared/db';

type TrustLevel = 'untrusted' | 'basic' | 'trusted';
type TaskStatus = 'submitted' | 'working' | 'completed' | 'failed';

export interface AuthenticatedA2AClient {
  id: string;
  name: string;
  trustLevel: TrustLevel;
  rateLimitPerHour: number;
}

export interface A2ATaskRequest {
  title: string;
  description: string;
  targetAgent?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  metadata?: Record<string, unknown>;
}

export interface A2ATaskSnapshot {
  id: string;
  status: TaskStatus;
  directiveId: string | null;
  createdAt: string;
  completedAt: string | null;
  output: Record<string, unknown> | null;
}

const DEFAULT_PRIORITY = 'high';

export async function authenticateClient(authorizationHeader?: string): Promise<AuthenticatedA2AClient | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [client] = await systemQuery<{
    id: string;
    name: string;
    trust_level: TrustLevel;
    rate_limit_per_hour: number;
  }>(
    `SELECT id, name, trust_level, rate_limit_per_hour
     FROM a2a_clients
     WHERE api_key_hash = $1
       AND is_active = true
     LIMIT 1`,
    [tokenHash],
  );

  if (!client) return null;

  const [{ count }] = await systemQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM a2a_tasks
     WHERE client_id = $1
       AND created_at >= NOW() - INTERVAL '1 hour'`,
    [client.id],
  );
  if (Number(count ?? 0) >= client.rate_limit_per_hour) {
    throw new Error(`Rate limit exceeded for client ${client.name}`);
  }

  return {
    id: client.id,
    name: client.name,
    trustLevel: client.trust_level,
    rateLimitPerHour: client.rate_limit_per_hour,
  };
}

export async function createA2ATask(
  client: AuthenticatedA2AClient,
  request: A2ATaskRequest,
  schedulerUrl?: string,
): Promise<A2ATaskSnapshot> {
  const priority = request.priority ?? DEFAULT_PRIORITY;
  const targetAgents = request.targetAgent ? [request.targetAgent] : ['chief-of-staff'];
  const directiveDescription = [
    request.description.trim(),
    '',
    `External A2A client: ${client.name}`,
    `Trust level: ${client.trustLevel}`,
    request.targetAgent ? `Requested target agent: ${request.targetAgent}` : 'Requested target agent: chief-of-staff orchestration',
  ].join('\n');

  const task = await systemTransaction(async (db) => {
    const directiveResult = await db.query<{ id: string }>(
      `INSERT INTO founder_directives (title, description, priority, category, target_agents, created_by, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        request.title.trim(),
        directiveDescription,
        priority,
        'general',
        targetAgents,
        `a2a:${client.name}`,
        'external_a2a',
      ],
    );
    const directive = directiveResult.rows[0];

    const taskResult = await db.query<{ id: string; created_at: string }>(
      `INSERT INTO a2a_tasks (client_id, directive_id, status, input)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [
        client.id,
        directive.id,
        'submitted',
        JSON.stringify({
          title: request.title,
          description: request.description,
          targetAgent: request.targetAgent ?? null,
          metadata: request.metadata ?? {},
        }),
      ],
    );

    return {
      id: taskResult.rows[0].id,
      createdAt: taskResult.rows[0].created_at,
      directiveId: directive.id,
    };
  });

  if (schedulerUrl) {
    void triggerChiefOfStaffOrchestration(schedulerUrl, directive.id, request.title).catch((err) => {
      console.warn('[A2A] Failed to trigger scheduler run:', (err as Error).message);
    });
  }

  return {
    id: task.id,
    status: 'submitted',
    directiveId: directive.id,
      createdAt: task.createdAt,
    completedAt: null,
    output: null,
  };
}

export async function getA2ATaskSnapshot(taskId: string): Promise<A2ATaskSnapshot | null> {
  const [row] = await systemQuery<{
    id: string;
    status: TaskStatus;
    created_at: string;
    completed_at: string | null;
    directive_id: string | null;
    directive_status: string | null;
    completion_summary: string | null;
  }>(
    `SELECT
       t.id,
       t.status,
       t.created_at,
       t.completed_at,
       t.directive_id,
       fd.status AS directive_status,
       fd.completion_summary
     FROM a2a_tasks t
     LEFT JOIN founder_directives fd ON fd.id = t.directive_id
     WHERE t.id = $1
     LIMIT 1`,
    [taskId],
  );

  if (!row) return null;

  const assignments = row.directive_id
    ? await systemQuery<{ id: string; status: string; assigned_to: string; output: string | null; agent_output: string | null }>(
        `SELECT id, status, assigned_to, output, agent_output
         FROM work_assignments
         WHERE directive_id = $1
         ORDER BY created_at ASC`,
        [row.directive_id],
      )
    : [];

  const derivedStatus = deriveTaskStatus(row.directive_status, assignments.map((assignment) => assignment.status));
  const artifactText =
    row.completion_summary
    ?? assignments
      .map((assignment) => assignment.output ?? assignment.agent_output)
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?? null;

  const completedAt = derivedStatus === 'completed' || derivedStatus === 'failed'
    ? row.completed_at ?? new Date().toISOString()
    : null;

  await systemQuery(
    `UPDATE a2a_tasks
     SET status = $2,
         output = $3,
         completed_at = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [
      taskId,
      derivedStatus,
      artifactText
        ? JSON.stringify({
            artifactType: 'text',
            content: artifactText,
            assignments: assignments.map((assignment) => ({
              id: assignment.id,
              status: assignment.status,
              assignedTo: assignment.assigned_to,
            })),
          })
        : null,
      completedAt,
    ],
  );

  return {
    id: row.id,
    status: derivedStatus,
    directiveId: row.directive_id,
    createdAt: row.created_at,
    completedAt,
    output: artifactText
      ? {
          artifactType: 'text',
          content: artifactText,
          assignments: assignments.map((assignment) => ({
            id: assignment.id,
            status: assignment.status,
            assignedTo: assignment.assigned_to,
          })),
        }
      : null,
  };
}

function deriveTaskStatus(directiveStatus: string | null, assignmentStatuses: string[]): TaskStatus {
  if (directiveStatus === 'completed') return 'completed';
  if (assignmentStatuses.some((status) => status === 'failed' || status === 'blocked')) return 'failed';
  if (assignmentStatuses.some((status) => status === 'dispatched' || status === 'in_progress' || status === 'completed')) {
    return 'working';
  }
  return 'submitted';
}

async function triggerChiefOfStaffOrchestration(
  schedulerUrl: string,
  directiveId: string,
  title: string,
): Promise<void> {
  const response = await fetch(`${schedulerUrl.replace(/\/$/, '')}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentRole: 'chief-of-staff',
      task: 'orchestrate',
      message: `New external A2A directive received.\nDirective ID: ${directiveId}\nTitle: ${title}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Scheduler /run failed with ${response.status}`);
  }
}
