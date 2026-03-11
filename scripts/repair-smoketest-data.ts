import { systemQuery } from '@glyphor/shared/db';

const SHARED_BASELINE = [
  'save_memory',
  'recall_memories',
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'send_agent_message',
  'check_messages',
] as const;

const SPECIALIST_ROLES = [
  'enterprise-account-researcher',
  'data-integrity-auditor',
  'tax-strategy-specialist',
  'lead-gen-specialist',
] as const;

const EXPECTED_GRANTS: Record<string, string[]> = {
  'vp-customer-success': [
    ...SHARED_BASELINE,
    'call_meeting', 'send_email', 'read_inbox', 'reply_to_email',
    'create_decision', 'log_activity',
  ],
  'revenue-analyst': [
    ...SHARED_BASELINE,
    'query_stripe_revenue', 'calculate_ltv_cac', 'forecast_revenue', 'log_activity',
    'get_mrr_breakdown', 'get_cash_balance',
  ],
  'cost-analyst': [
    ...SHARED_BASELINE,
    'query_gcp_billing', 'identify_waste', 'project_costs', 'log_activity',
    'get_gcp_costs', 'get_burn_rate', 'get_cash_balance',
  ],
  'onboarding-specialist': [
    ...SHARED_BASELINE,
    'query_onboarding_funnel', 'query_activation_rate', 'log_activity',
  ],
  'support-triage': [
    ...SHARED_BASELINE,
    'query_support_tickets', 'classify_ticket', 'escalate_ticket', 'log_activity',
  ],
  'account-research': [
    ...SHARED_BASELINE,
    'search_company_info', 'analyze_tech_stack', 'compile_dossier', 'log_activity',
  ],
  'enterprise-account-researcher': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'request_new_tool',
    'send_email', 'read_inbox',
    'web_search', 'web_fetch',
  ],
  'technical-research-analyst': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'web_search', 'web_fetch', 'submit_research_packet',
  ],
  'industry-research-analyst': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'web_search', 'web_fetch', 'submit_research_packet',
  ],
  'org-analyst': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'web_search', 'web_fetch', 'submit_research_packet',
  ],
  'data-integrity-auditor': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'send_email', 'read_inbox', 'query_knowledge_graph',
  ],
  'tax-strategy-specialist': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'send_email', 'read_inbox', 'query_knowledge_graph',
  ],
  'lead-gen-specialist': [
    ...SHARED_BASELINE,
    'call_meeting', 'emit_insight', 'emit_alert', 'send_email', 'web_search', 'web_fetch',
  ],
};

async function ensureSpecialists() {
  await systemQuery(
    `INSERT INTO company_agents (role, display_name, model, status)
     VALUES
       ('enterprise-account-researcher', 'Enterprise Account Researcher', 'gemini-3-flash-preview', 'active'),
       ('data-integrity-auditor', 'Data Integrity Auditor', 'gemini-3-flash-preview', 'active'),
       ('tax-strategy-specialist', 'Tax Strategy Specialist', 'gemini-3-flash-preview', 'active'),
       ('lead-gen-specialist', 'Lead Gen Specialist', 'gemini-3-flash-preview', 'active')
     ON CONFLICT (role) DO NOTHING`,
    [],
  );

  await systemQuery(
    `INSERT INTO agent_briefs (agent_id, system_prompt)
     VALUES
       ('enterprise-account-researcher', 'You are Enterprise Account Researcher. Build high-confidence account dossiers using verifiable data and concise recommendations for sales strategy.'),
       ('data-integrity-auditor', 'You are Data Integrity Auditor. Audit cross-system data quality, identify inconsistencies, and provide concrete remediation actions with evidence.'),
       ('tax-strategy-specialist', 'You are Tax Strategy Specialist. Provide compliant, practical tax strategy analysis with explicit assumptions and risk-aware recommendations.'),
       ('lead-gen-specialist', 'You are Lead Gen Specialist. Identify, qualify, and prioritize high-value prospects with clear next actions for outreach.')
     ON CONFLICT (agent_id) DO NOTHING`,
    [],
  );

  await systemQuery(
    `INSERT INTO agent_profiles (agent_id, avatar_url, personality_summary)
     VALUES
       ('enterprise-account-researcher', '/avatars/enterprise-account-researcher.png', 'Methodical researcher who builds comprehensive account dossiers.'),
       ('data-integrity-auditor', '/avatars/data-integrity-auditor.png', 'Detail-oriented auditor who ensures data accuracy across systems.'),
       ('tax-strategy-specialist', '/avatars/tax-strategy-specialist.png', 'Strategic tax planner focused on compliance and minimization.'),
       ('lead-gen-specialist', '/avatars/lead-gen-specialist.png', 'Driven specialist who identifies and qualifies high-value prospects.')
     ON CONFLICT (agent_id) DO NOTHING`,
    [],
  );

  console.log(`Specialist upsert done for ${SPECIALIST_ROLES.length} roles.`);
}

async function ensureGrants() {
  let inserted = 0;

  for (const [role, tools] of Object.entries(EXPECTED_GRANTS)) {
    for (const tool of tools) {
      const rows = await systemQuery<{ n: number }>(
        `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, is_active)
         VALUES ($1, $2, 'smoketest-repair', true)
         ON CONFLICT (agent_role, tool_name)
         DO UPDATE SET
           is_active = true,
           granted_by = 'smoketest-repair'
         RETURNING 1 AS n`,
        [role, tool],
      );
      inserted += rows.length;
    }
  }

  console.log(`Grant upsert completed. Rows inserted/updated: ${inserted}`);
}

async function main() {
  await ensureSpecialists();
  await ensureGrants();
  console.log('Repair complete.');
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
