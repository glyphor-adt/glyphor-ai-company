/**
 * Support Triage (David Santos) — Tools
 * Reports to James Wilson (VP-CS). Support ticket triage and resolution.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createSupportTriageTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_support_tickets',
      description: 'Query recent support tickets/conversations from Intercom.',
      parameters: { status: { type: 'string', description: 'Filter: open, closed, snoozed, all', required: true }, priority: { type: 'string', description: 'Filter by priority: p0, p1, p2, p3' }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(Number(params.limit) || 20);
        if (params.status !== 'all') { query = query.eq('status', params.status); }
        if (params.priority) { query = query.eq('priority', params.priority); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'classify_ticket',
      description: 'Classify a support ticket by category and priority.',
      parameters: { ticketId: { type: 'string', description: 'Ticket/conversation ID', required: true }, category: { type: 'string', description: 'Category: billing, technical, account, feature_request, bug', required: true }, priority: { type: 'string', description: 'Priority: p0, p1, p2, p3', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { error } = await supabase.from('support_tickets').update({ category: params.category, priority: params.priority, classified_by: 'support-triage', classified_at: new Date().toISOString() }).eq('id', params.ticketId);
        if (error) return { success: false, error: error.message };
        return { success: true, message: `Ticket ${params.ticketId} classified as ${params.category}/${params.priority}.` };
      },
    },
    {
      name: 'respond_to_ticket',
      description: 'Draft a response to a support ticket. Saved as draft for review before sending.',
      parameters: { ticketId: { type: 'string', description: 'Ticket/conversation ID', required: true }, message: { type: 'string', description: 'Response message', required: true }, kbArticles: { type: 'string', description: 'Comma-separated KB article URLs to include' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('support_responses').insert({ ticket_id: params.ticketId, message: params.message, kb_articles: params.kbArticles || null, status: 'draft', author: 'support-triage', created_at: new Date().toISOString() });
        return { success: true, message: `Response draft saved for ticket ${params.ticketId}.` };
      },
    },
    {
      name: 'escalate_ticket',
      description: 'Escalate a ticket to a team member or executive for handling.',
      parameters: { ticketId: { type: 'string', description: 'Ticket/conversation ID', required: true }, escalateTo: { type: 'string', description: 'Agent role or team to escalate to', required: true }, reason: { type: 'string', description: 'Reason for escalation', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('support_tickets').update({ status: 'escalated', escalated_to: params.escalateTo, escalation_reason: params.reason, escalated_at: new Date().toISOString() }).eq('id', params.ticketId);
        return { success: true, message: `Ticket ${params.ticketId} escalated to ${params.escalateTo}.` };
      },
    },
    {
      name: 'query_knowledge_base',
      description: 'Search the knowledge base for articles relevant to a support issue.',
      parameters: { query: { type: 'string', description: 'Search query', required: true }, limit: { type: 'number', description: 'Max results (default 5)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('knowledge_base').select('*').ilike('content', `%${params.query}%`).order('views', { ascending: false }).limit(Number(params.limit) || 5);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'batch_similar_tickets',
      description: 'Find and group similar tickets to identify systemic issues.',
      parameters: { category: { type: 'string', description: 'Category to batch', required: true }, period: { type: 'string', description: 'Time period: 7d, 30d' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('support_tickets').select('*').eq('category', params.category).order('created_at', { ascending: false }).limit(50);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({ agent_role: 'support-triage', activity_type: 'support_triage', summary: params.summary, details: params.details || null, created_at: new Date().toISOString() });
        return { success: true };
      },
    },
  ];
}
