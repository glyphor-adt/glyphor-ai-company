/**
 * Support Triage (David Santos) — Tools
 * Reports to James Turner (VP-CS). Support ticket triage and resolution.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createSupportTriageTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_support_tickets',
      description: 'Query recent support tickets/conversations from Intercom.',
      parameters: { status: { type: 'string', description: 'Filter: open, closed, snoozed, all', required: true }, priority: { type: 'string', description: 'Filter by priority: p0, p1, p2, p3' }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        if (params.status !== 'all') { conditions.push(`status=$${values.length + 1}`); values.push(params.status); }
        if (params.priority) { conditions.push(`priority=$${values.length + 1}`); values.push(params.priority); }
        const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
        const data = await systemQuery(`SELECT * FROM support_tickets${where} ORDER BY created_at DESC LIMIT $${values.length + 1}`, [...values, Number(params.limit) || 20]);
        return { success: true, data };
      },
    },
    {
      name: 'classify_ticket',
      description: 'Classify a support ticket by category and priority.',
      parameters: { ticketId: { type: 'string', description: 'Ticket/conversation ID', required: true }, category: { type: 'string', description: 'Category: billing, technical, account, feature_request, bug', required: true }, priority: { type: 'string', description: 'Priority: p0, p1, p2, p3', required: true } },
      async execute(params) {
        try {
          await systemQuery('UPDATE support_tickets SET category=$1, priority=$2, classified_by=$3, classified_at=$4 WHERE id=$5', [params.category, params.priority, 'support-triage', new Date().toISOString(), params.ticketId]);
          return { success: true, message: `Ticket ${params.ticketId} classified as ${params.category}/${params.priority}.` };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    {
      name: 'respond_to_ticket',
      description: 'Draft a response to a support ticket. Saved as draft for review before sending.',
      parameters: { ticketId: { type: 'string', description: 'Ticket/conversation ID', required: true }, message: { type: 'string', description: 'Response message', required: true }, kbArticles: { type: 'string', description: 'Comma-separated KB article URLs to include' } },
      async execute(params) {
        await systemQuery('INSERT INTO support_responses (ticket_id, message, kb_articles, status, author, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [params.ticketId, params.message, params.kbArticles || null, 'draft', 'support-triage', new Date().toISOString()]);
        return { success: true, message: `Response draft saved for ticket ${params.ticketId}.` };
      },
    },
    {
      name: 'escalate_ticket',
      description: 'Escalate a ticket to a team member or executive for handling.',
      parameters: { ticketId: { type: 'string', description: 'Ticket/conversation ID', required: true }, escalateTo: { type: 'string', description: 'Agent role or team to escalate to', required: true }, reason: { type: 'string', description: 'Reason for escalation', required: true } },
      async execute(params) {
        await systemQuery('UPDATE support_tickets SET status=$1, escalated_to=$2, escalation_reason=$3, escalated_at=$4 WHERE id=$5', ['escalated', params.escalateTo, params.reason, new Date().toISOString(), params.ticketId]);
        return { success: true, message: `Ticket ${params.ticketId} escalated to ${params.escalateTo}.` };
      },
    },
    {
      name: 'query_knowledge_base',
      description: 'Search the knowledge base for articles relevant to a support issue.',
      parameters: { query: { type: 'string', description: 'Search query', required: true }, limit: { type: 'number', description: 'Max results (default 5)' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM knowledge_base WHERE content ILIKE $1 ORDER BY views DESC LIMIT $2', [`%${params.query}%`, Number(params.limit) || 5]);
        return { success: true, data };
      },
    },
    {
      name: 'batch_similar_tickets',
      description: 'Find and group similar tickets to identify systemic issues.',
      parameters: { category: { type: 'string', description: 'Category to batch', required: true }, period: { type: 'string', description: 'Time period: 7d, 30d' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM support_tickets WHERE category=$1 ORDER BY created_at DESC LIMIT 50', [params.category]);
        return { success: true, data };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        await systemQuery('INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)', ['support-triage', 'support_triage', params.summary, params.details || null, new Date().toISOString()]);
        return { success: true };
      },
    },
  ];
}
