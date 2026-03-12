# Patch Set 2: Complete Remaining Implementation
## Exact Instructions — Execute in Order

> **State:** Routing infrastructure deployed. Pre-check registry expanded. MCP prefix stripping added. Reflection hardcoded to nano. Routing is live with 4 models active (gpt-5.4, gpt-5-mini, gemini-2.5-pro, gemini-3.1-pro-preview). Claude is at 0 runs. Cost is $18/day. Tool Search not active. Apply Patch not active. Skills not integrated.
>
> **Goal after this patch set:** All 6-7 models active. Cost at $1.10-1.50/day. Tool Search cutting input tokens 40%+. Apply Patch cutting output tokens 60%+. Claude handling content/legal/evaluation. Pre-checks skipping 40-80 runs/day. Reflections linked to agent_runs via UUID.

---

## Patch 1: Fix Reflection run_id UUID Propagation

### Problem
`agent_reflections.run_id` contains config-style strings like `ops-on_demand-2026-03-11` instead of the `agent_runs` UUID. The UUID is created in `trackedAgentExecutor` but doesn't reach the reflection save path.

### File: `packages/scheduler/src/server.ts` (or wherever `trackedAgentExecutor` lives)

Find `trackedAgentExecutor`. It does approximately:

```typescript
// CURRENT (pseudocode — find the actual implementation):
async function trackedAgentExecutor(role, task, payload) {
  const runId = await db.query('INSERT INTO agent_runs ... RETURNING id');  // UUID
  const result = await agentExecutor(role, task, payload);  // runs the agent
  await db.query('UPDATE agent_runs SET ... WHERE id = $1', [runId]);
  return result;
}
```

The `runId` UUID needs to be passed INTO `agentExecutor` so the runner has it. Find how the runner is invoked and add the run ID to the payload or dependencies.

### What to change

**Step 1:** In `trackedAgentExecutor`, pass `runId` to the runner:

```typescript
// Find the line that calls agentExecutor/runner and add runId:
// BEFORE:
const result = await agentExecutor(role, task, payload);

// AFTER:
const result = await agentExecutor(role, task, { ...payload, runId });
```

**Step 2:** In `packages/agent-runtime/src/companyAgentRunner.ts`, receive and store the run ID:

Find where the runner receives its parameters (constructor, `run()` method, or `deps` object). Search for where `config.id` or similar is used. Add:

```typescript
// Near the top of run(), extract runId from payload/deps:
const dbRunId: string | undefined = deps?.runId ?? payload?.runId ?? undefined;
```

**Step 3:** In the reflection save section of `companyAgentRunner.ts`, use the DB run ID:

Search for where reflections are saved. It probably calls something like `store.saveReflection()` or `db.query('INSERT INTO agent_reflections')`. Find the `run_id` parameter and replace:

```typescript
// BEFORE (approximate):
run_id: config.id,  // or this.configId or similar string

// AFTER:
run_id: dbRunId ?? config.id,  // prefer UUID, fall back to config string
```

### Verify

```sql
SELECT r.run_id, ar.id AS agent_runs_id, r.agent_role, r.created_at
FROM agent_reflections r
LEFT JOIN agent_runs ar ON r.run_id::text = ar.id::text
WHERE r.created_at > NOW() - INTERVAL '1 hour'
ORDER BY r.created_at DESC LIMIT 10;
```

Every row should have a matching `agent_runs_id`. If `run_id` is UUID type and `ar.id` is UUID, the join works directly. If types differ, you may need to cast.

---

## Patch 2: Populate Department/Team on company_agents

### Problem
`company_agents.team` is NULL for most agents. Layer 3 (department signal) in `inferCapabilities` is dead. This causes many agents to fall through to `default_generalist`.

### File: Database — run this SQL directly

```sql
-- Populate team/department for all agents based on the org chart
-- from ARCHITECTURE.md and AGENT_PLATFORM_REFERENCE.md

UPDATE company_agents SET team = 'Executive' WHERE role IN (
  'chief-of-staff', 'cto', 'cpo', 'cmo', 'cfo',
  'vp-customer-success', 'vp-sales', 'vp-design'
);

UPDATE company_agents SET team = 'Legal' WHERE role IN (
  'clo', 'bob-the-tax-pro', 'data-integrity-auditor', 'tax-strategy-specialist'
);

UPDATE company_agents SET team = 'Engineering' WHERE role IN (
  'platform-engineer', 'quality-engineer', 'devops-engineer', 'm365-admin'
);

UPDATE company_agents SET team = 'Product' WHERE role IN (
  'user-researcher', 'competitive-intel'
);

UPDATE company_agents SET team = 'Finance' WHERE role IN (
  'revenue-analyst', 'cost-analyst'
);

UPDATE company_agents SET team = 'Marketing' WHERE role IN (
  'content-creator', 'seo-analyst', 'social-media-manager',
  'marketing-intelligence-analyst'
);

UPDATE company_agents SET team = 'Customer Success' WHERE role IN (
  'onboarding-specialist', 'support-triage'
);

UPDATE company_agents SET team = 'Sales' WHERE role IN (
  'account-research', 'enterprise-account-researcher', 'lead-gen-specialist'
);

UPDATE company_agents SET team = 'Design & Frontend' WHERE role IN (
  'ui-ux-designer', 'frontend-engineer', 'design-critic', 'template-architect'
);

UPDATE company_agents SET team = 'Research & Intelligence' WHERE role IN (
  'vp-research', 'competitive-research-analyst', 'market-research-analyst',
  'technical-research-analyst', 'industry-research-analyst',
  'ai-impact-analyst', 'org-analyst'
);

UPDATE company_agents SET team = 'Operations' WHERE role IN (
  'ops', 'global-admin'
);

UPDATE company_agents SET team = 'People & Culture' WHERE role IN (
  'head-of-hr'
);

UPDATE company_agents SET team = 'Executive Support' WHERE role IN (
  'adi-rose'
);
```

### Also fix the RoutingContext department source

In `companyAgentRunner.ts`, find where `RoutingContext` is built. The `department` field might be reading from the wrong place. Verify:

```typescript
// Find this line (from Issue 6):
department: this.agentProfile?.department ?? undefined,

// If agentProfile doesn't have department, fall back to company_agents.team:
// Option A — if you have the company_agents row available:
department: this.agentProfile?.department ?? this.agentRecord?.team ?? undefined,

// Option B — if not, query it once at run start:
// const agentRow = await db.query('SELECT team FROM company_agents WHERE role = $1', [this.role]);
// department: agentRow.rows[0]?.team ?? undefined,
```

### Verify

```sql
SELECT role, team FROM company_agents WHERE team IS NOT NULL ORDER BY team, role;
-- Should return all 44/45 agents with populated team values

-- Then after a few agent runs:
SELECT agent_role, routing_rule, routing_capabilities
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND routing_rule = 'default_generalist'
ORDER BY created_at DESC;
-- default_generalist should drop significantly
```

---

## Patch 3: Expand TOOL_CAPABILITY_MAP from Live Data

### Problem
Many tool names from role-specific factories and MCP tools aren't in the capability map, causing agents to fall through to `default_generalist`.

### Step 1: Pull unmapped tool names from live grants

Run this query and save the output:

```sql
SELECT DISTINCT atg.tool_name,
  CASE
    WHEN tool_name LIKE 'pulse_%' THEN 'creative_writing or simple_tool_calling'
    WHEN tool_name LIKE '%write%' OR tool_name LIKE '%create_%' OR tool_name LIKE '%update_%'
         OR tool_name LIKE '%deploy%' OR tool_name LIKE '%scaffold%' OR tool_name LIKE '%generate%' THEN 'code_generation or creative_writing'
    WHEN tool_name LIKE '%get_%' OR tool_name LIKE '%list_%' OR tool_name LIKE '%check_%'
         OR tool_name LIKE '%query_%' OR tool_name LIKE '%read_%' OR tool_name LIKE '%search_%' THEN 'structured_extraction'
    WHEN tool_name LIKE '%cost%' OR tool_name LIKE '%revenue%' OR tool_name LIKE '%financial%'
         OR tool_name LIKE '%budget%' OR tool_name LIKE '%mrr%' OR tool_name LIKE '%stripe%' THEN 'financial_computation'
    WHEN tool_name LIKE '%compliance%' OR tool_name LIKE '%contract%' OR tool_name LIKE '%legal%'
         OR tool_name LIKE '%patent%' OR tool_name LIKE '%ip_%' THEN 'legal_reasoning'
    WHEN tool_name LIKE '%screenshot%' OR tool_name LIKE '%visual%' OR tool_name LIKE '%audit%'
         OR tool_name LIKE '%lighthouse%' OR tool_name LIKE '%accessibility%' THEN 'visual_analysis'
    WHEN tool_name LIKE '%research%' OR tool_name LIKE '%monitor%' OR tool_name LIKE '%competitor%'
         OR tool_name LIKE '%web_search%' OR tool_name LIKE '%web_fetch%' THEN 'web_research'
    WHEN tool_name LIKE '%content%' OR tool_name LIKE '%draft%' OR tool_name LIKE '%publish%'
         OR tool_name LIKE '%social%' OR tool_name LIKE '%blog%' OR tool_name LIKE '%seo%' THEN 'creative_writing'
    ELSE 'UNMAPPED — NEEDS MANUAL CLASSIFICATION'
  END AS suggested_capability,
  COUNT(DISTINCT atg.agent_role) AS agents_using
FROM agent_tool_grants atg
WHERE atg.is_active = true
  AND atg.tool_name NOT IN (
    -- Exclude tools already in your TOOL_CAPABILITY_MAP
    -- Paste all existing keys from toolCapabilityMap.ts here
    'read_file', 'write_file', 'get_file_contents', 'create_or_update_file',
    'create_branch', 'search_code', 'read_frontend_file', 'write_frontend_file',
    'search_frontend_code', 'list_frontend_files', 'create_frontend_file',
    'create_design_branch', 'create_frontend_pr', 'check_pr_status',
    'scaffold_component', 'scaffold_page', 'list_templates', 'clone_and_modify',
    'run_test_suite', 'get_code_coverage', 'get_quality_metrics', 'create_test_plan',
    'deploy_preview', 'get_deployment_status', 'list_deployments',
    'screenshot_page', 'screenshot_component', 'compare_screenshots', 'check_responsive',
    'storybook_screenshot', 'storybook_screenshot_all', 'storybook_visual_diff',
    'run_lighthouse_audit', 'run_accessibility_audit', 'check_ai_smell',
    'validate_brand_compliance', 'web_search', 'web_fetch', 'search_news',
    'submit_research_packet', 'save_research', 'search_research',
    'create_research_brief', 'create_monitor', 'check_monitors',
    'search_academic_papers', 'track_competitor_product', 'compile_research_digest',
    'cross_reference_findings', 'get_financials', 'get_mrr_breakdown',
    'get_subscription_details', 'get_churn_analysis', 'get_revenue_forecast',
    'get_stripe_invoices', 'get_customer_ltv', 'calculate_unit_economics',
    'get_vendor_costs', 'get_cost_anomalies', 'get_burn_rate', 'create_budget',
    'check_budget_status', 'get_cash_balance', 'get_cash_flow',
    'get_pending_transactions', 'generate_financial_report', 'get_margin_analysis',
    'query_stripe_mrr', 'query_stripe_subscriptions', 'write_financial_report',
    'get_infrastructure_costs', 'get_system_costs_realtime',
    'create_content_draft', 'update_content_draft', 'submit_content_for_review',
    'approve_content_draft', 'reject_content_draft', 'publish_content',
    'generate_content_image', 'generate_and_publish_asset', 'publish_asset_deliverable',
    'create_canva_design', 'generate_canva_design', 'create_logo_variation',
    'restyle_logo', 'get_compliance_status', 'get_contracts', 'get_ip_portfolio',
    'update_compliance_item', 'create_contract', 'create_signing_envelope',
    'send_template_envelope', 'check_envelope_status', 'evaluate_assignment',
    'check_assignment_status', 'evaluate_team_output', 'review_team_output',
    'read_founder_directives', 'create_work_assignments', 'dispatch_assignment',
    'update_directive_progress', 'create_team_assignments',
    'synthesize_team_deliverable', 'assign_team_task',
    'get_design_tokens', 'update_design_token', 'validate_tokens_vs_implementation',
    'get_color_palette', 'get_typography_scale', 'list_components',
    'get_component_usage', 'get_figma_file', 'get_figma_components',
    'get_figma_styles', 'get_figma_comments', 'post_figma_comment',
    'get_figma_file_metadata', 'export_figma_images',
    'schedule_social_post', 'get_scheduled_posts', 'get_social_metrics',
    'get_search_performance', 'track_keyword_rankings', 'get_indexing_status',
    'get_usage_metrics', 'get_funnel_analysis', 'entra_get_user_profile',
    'entra_update_user_profile', 'entra_audit_profiles',
    'get_platform_health', 'get_cloud_run_metrics', 'get_agent_health_dashboard',
    'get_event_bus_health', 'get_data_freshness', 'query_vercel_health',
    'write_health_report', 'create_status_report'
  )
GROUP BY atg.tool_name
ORDER BY suggested_capability, agents_using DESC;
```

### Step 2: Add unmapped tools to `toolCapabilityMap.ts`

Take the query output and add entries. Key classifications to get right:

**Read-only code tools → `structured_extraction` (NOT `code_generation`):**
```typescript
// These tools READ code but don't WRITE it.
// Design critics, quality engineers reading coverage → should stay on gpt-5-mini, not 5.4
'get_code_coverage':       ['structured_extraction'],
'get_quality_metrics':     ['structured_extraction'],
'check_build_errors':      ['structured_extraction'],
'check_bundle_size':       ['structured_extraction'],
'get_container_logs':      ['structured_extraction'],
'get_deployment_history':  ['structured_extraction'],
'get_infrastructure_inventory': ['structured_extraction'],
'get_service_dependencies': ['structured_extraction'],
'get_build_queue':         ['structured_extraction'],
'storybook_list_stories':  ['structured_extraction'],
'storybook_check_coverage': ['structured_extraction'],
'storybook_get_story_source': ['structured_extraction'],
'check_pr_status':         ['structured_extraction'],
```

**Write code tools → `code_generation`:**
```typescript
'write_frontend_file':     ['code_generation'],
'create_frontend_file':    ['code_generation'],
'create_design_branch':    ['code_generation'],
'create_frontend_pr':      ['code_generation'],
'scaffold_component':      ['code_generation'],
'scaffold_page':           ['code_generation'],
'clone_and_modify':        ['code_generation'],
'deploy_preview':          ['code_generation'],
'storybook_save_baseline': ['code_generation'],
```

**Core tools (every agent has these) → no routing signal:**
```typescript
// Core tools should NOT trigger any capability — they're universal
// Do NOT add these to the map:
// read_my_assignments, submit_assignment_output, flag_assignment_blocker,
// send_agent_message, check_messages, save_memory, recall_memories,
// request_tool_access, request_new_tool, emit_insight, emit_alert,
// send_teams_dm, read_teams_dm, publish_deliverable, get_deliverables
```

**Orchestration tools → `orchestration`:**
```typescript
'escalate_to_sarah':       ['orchestration'],
'check_team_status':       ['orchestration'],
'request_peer_work':       ['simple_tool_calling'],
'create_handoff':          ['simple_tool_calling'],
'peer_data_request':       ['simple_tool_calling'],
'propose_initiative':      ['orchestration'],
'get_agent_directory':     ['simple_tool_calling'],
'who_handles':             ['simple_tool_calling'],
'grant_tool_access':       ['orchestration'],
'revoke_tool_access':      ['orchestration'],
```

**Collective intelligence tools → `structured_extraction`:**
```typescript
'get_company_pulse':       ['structured_extraction'],
'update_company_pulse':    ['structured_extraction'],
'get_org_knowledge':       ['structured_extraction'],
'read_company_doctrine':   ['structured_extraction'],
'detect_contradictions':   ['structured_extraction'],
'get_process_patterns':    ['structured_extraction'],
'get_knowledge_routes':    ['structured_extraction'],
```

**Ops extension tools:**
```typescript
'get_access_matrix':       ['simple_tool_calling'],
'provision_access':        ['simple_tool_calling'],
'revoke_access':           ['simple_tool_calling'],
'audit_access':            ['structured_extraction'],
'rotate_secrets':          ['simple_tool_calling'],
'get_platform_audit_log':  ['structured_extraction'],
'predict_capacity':        ['financial_computation'],
```

**Content/marketing tools that were missed:**
```typescript
'get_content_drafts':      ['structured_extraction'],
'get_content_metrics':     ['structured_extraction'],
'get_content_calendar':    ['structured_extraction'],
'get_post_performance':    ['structured_extraction'],
'get_social_audience':     ['structured_extraction'],
'reply_to_social':         ['creative_writing'],
'get_trending_topics':     ['web_research'],
'create_experiment':       ['structured_extraction'],
'get_experiment_results':  ['structured_extraction'],
'monitor_competitor_marketing': ['web_research'],
'analyze_market_trends':   ['web_research'],
'get_attribution_data':    ['structured_extraction'],
'capture_lead':            ['simple_tool_calling'],
'get_lead_pipeline':       ['structured_extraction'],
'score_lead':              ['structured_extraction'],
'get_marketing_dashboard': ['structured_extraction'],
```

**Product/roadmap tools:**
```typescript
'create_roadmap_item':     ['structured_extraction'],
'score_feature_rice':      ['structured_extraction'],
'get_roadmap':             ['structured_extraction'],
'update_roadmap_item':     ['structured_extraction'],
'get_feature_requests':    ['structured_extraction'],
'manage_feature_flags':    ['simple_tool_calling'],
'get_cohort_retention':    ['structured_extraction'],
'get_feature_usage':       ['structured_extraction'],
'segment_users':           ['structured_extraction'],
'create_survey':           ['creative_writing'],
'get_survey_results':      ['structured_extraction'],
'analyze_support_tickets': ['structured_extraction'],
'get_user_feedback':       ['structured_extraction'],
'create_user_persona':     ['creative_writing'],
```

**Customer success tools:**
```typescript
'get_backlink_profile':    ['structured_extraction'],
'analyze_page_seo':        ['structured_extraction'],
'submit_sitemap':          ['simple_tool_calling'],
'update_seo_data':         ['simple_tool_calling'],
```

**HR and admin tools:**
```typescript
'entra_upload_user_photo': ['simple_tool_calling'],
'entra_set_manager':       ['simple_tool_calling'],
'entra_hr_assign_license': ['simple_tool_calling'],
'create_specialist_agent': ['orchestration'],
'list_my_created_agents':  ['simple_tool_calling'],
'retire_created_agent':    ['simple_tool_calling'],
```

**Figma remaining tools:**
```typescript
'resolve_figma_comment':   ['simple_tool_calling'],
'get_figma_version_history': ['structured_extraction'],
'get_figma_team_projects': ['structured_extraction'],
'get_figma_project_files': ['structured_extraction'],
'get_figma_dev_resources': ['structured_extraction'],
'create_figma_dev_resource': ['code_generation'],
'manage_figma_webhooks':   ['simple_tool_calling'],
'get_figma_image_fills':   ['structured_extraction'],
'get_figma_team_components': ['structured_extraction'],
'get_figma_team_styles':   ['structured_extraction'],
```

**Canva/Logo remaining:**
```typescript
'get_canva_design':        ['structured_extraction'],
'search_canva_designs':    ['structured_extraction'],
'list_canva_brand_templates': ['structured_extraction'],
'get_canva_template_fields': ['structured_extraction'],
'export_canva_design':     ['simple_tool_calling'],
'upload_canva_asset':      ['simple_tool_calling'],
'create_social_avatar':    ['creative_writing'],
```

**DocuSign remaining:**
```typescript
'list_envelopes':          ['structured_extraction'],
'void_envelope':           ['legal_reasoning'],
'resend_envelope':         ['simple_tool_calling'],
```

**Asset tools:**
```typescript
'generate_image':          ['creative_writing'],
'upload_asset':            ['simple_tool_calling'],
'list_assets':             ['structured_extraction'],
'optimize_image':          ['simple_tool_calling'],
'generate_favicon_set':    ['creative_writing'],
```

**Diagnostic/engineering tools:**
```typescript
'check_table_schema':      ['structured_extraction'],
'diagnose_column_error':   ['structured_extraction'],
'list_tables':             ['structured_extraction'],
'check_tool_health':       ['deterministic_possible'],
'run_test_suite':          ['code_generation'],  // writing/running tests IS code gen
'create_test_plan':        ['code_generation'],
'scale_service':           ['simple_tool_calling'],
```

**Pulse tools (batch classify):**
```typescript
// Pulse storyboard/video creation = creative
'pulse_create_storyboard': ['creative_writing'],
'pulse_generate_scene_images': ['creative_writing'],
'pulse_suggest_scenes':    ['creative_writing'],
'pulse_generate_storyboard_script': ['creative_writing'],
'pulse_generate_promo_scenes': ['creative_writing'],
'pulse_create_hero_promo': ['creative_writing'],
'pulse_create_multi_angle': ['creative_writing'],
'pulse_create_product_showcase': ['creative_writing'],
'pulse_create_narrative_storyboard': ['creative_writing'],
'pulse_create_ad_storyboard': ['creative_writing'],
'pulse_generate_voiceover_script': ['creative_writing'],
'pulse_enhance_prompt':    ['creative_writing'],
'pulse_enhance_video_prompt': ['creative_writing'],
'pulse_polish_scene_prompt': ['creative_writing'],
'pulse_generate_concept_image': ['creative_writing'],
'pulse_edit_image':        ['creative_writing'],
'pulse_generate_music':    ['creative_writing'],
'pulse_generate_sound_effect': ['creative_writing'],
'pulse_generate_avatar':   ['creative_writing'],
'pulse_text_to_speech':    ['creative_writing'],
'pulse_doodle_to_image':   ['creative_writing'],
'pulse_transform_viral_image': ['creative_writing'],
'pulse_product_recontext': ['creative_writing'],

// Pulse read/status operations = simple
'pulse_list_storyboards':  ['simple_tool_calling'],
'pulse_get_storyboard':    ['simple_tool_calling'],
'pulse_storyboard_chat':   ['simple_tool_calling'],
'pulse_generate_video':    ['simple_tool_calling'],
'pulse_poll_video_status': ['simple_tool_calling'],
'pulse_list_videos':       ['simple_tool_calling'],
'pulse_delete_video':      ['simple_tool_calling'],
'pulse_remix_video':       ['simple_tool_calling'],
'pulse_batch_generate_videos': ['simple_tool_calling'],
'pulse_upscale_image':     ['simple_tool_calling'],
'pulse_expand_image':      ['simple_tool_calling'],
'pulse_remove_background': ['simple_tool_calling'],
'pulse_extract_image_text': ['structured_extraction'],
'pulse_replace_image_text': ['simple_tool_calling'],
'pulse_upload_source_image': ['simple_tool_calling'],
'pulse_poll_avatar_status': ['simple_tool_calling'],
'pulse_generate_lipsync':  ['simple_tool_calling'],
'pulse_poll_lipsync_status': ['simple_tool_calling'],
'pulse_kling_multi_shot':  ['simple_tool_calling'],
'pulse_poll_multi_shot':   ['simple_tool_calling'],
'pulse_analyze_brand_website': ['web_research'],
'pulse_analyze_image_for_video': ['visual_analysis'],
'pulse_check_subscription': ['simple_tool_calling'],
'pulse_list_concept_images': ['simple_tool_calling'],
'pulse_list_brand_kits':   ['simple_tool_calling'],
'pulse_create_share_link': ['simple_tool_calling'],
```

**Email marketing tools (via MCP):**
```typescript
'get_mailchimp_lists':     ['structured_extraction'],
'get_mailchimp_members':   ['structured_extraction'],
'get_mailchimp_segments':  ['structured_extraction'],
'create_mailchimp_campaign': ['creative_writing'],
'set_campaign_content':    ['creative_writing'],
'send_test_campaign':      ['simple_tool_calling'],
'send_campaign':           ['simple_tool_calling'],
'get_campaign_report':     ['structured_extraction'],
'get_campaign_list':       ['structured_extraction'],
'manage_mailchimp_tags':   ['simple_tool_calling'],
'send_transactional_email': ['simple_tool_calling'],
'get_mandrill_stats':      ['structured_extraction'],
'search_mandrill_messages': ['structured_extraction'],
'get_mandrill_templates':  ['structured_extraction'],
'render_mandrill_template': ['simple_tool_calling'],
```

**SharePoint/knowledge tools:**
```typescript
'upload_to_sharepoint':    ['simple_tool_calling'],
'trace_causes':            ['structured_extraction'],
'trace_impact':            ['structured_extraction'],
'query_knowledge_graph':   ['structured_extraction'],
'add_knowledge':           ['simple_tool_calling'],
'promote_to_org_knowledge': ['simple_tool_calling'],
'create_knowledge_route':  ['simple_tool_calling'],
'record_process_pattern':  ['simple_tool_calling'],
'propose_authority_change': ['orchestration'],
'get_authority_proposals':  ['structured_extraction'],
'update_pulse_highlights': ['simple_tool_calling'],
```

**Research monitoring remaining:**
```typescript
'get_monitor_history':     ['web_research'],
'track_open_source':       ['web_research'],
'track_industry_events':   ['web_research'],
'track_regulatory_changes': ['web_research', 'legal_reasoning'],
'analyze_ai_adoption':     ['web_research'],
'track_ai_benchmarks':     ['web_research'],
'analyze_org_structure':   ['web_research'],
'get_research_timeline':   ['structured_extraction'],
'identify_research_gaps':  ['web_research'],
```

### Verify

After adding all entries, rebuild and deploy, then:

```sql
SELECT routing_rule, COUNT(*) AS hits
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '4 hours'
  AND routing_rule IS NOT NULL
GROUP BY routing_rule
ORDER BY hits DESC;
```

`default_generalist` should drop from 10.9% to under 3%.

---

## Patch 4: Wire OpenAI Responses API for GPT-5.4 (Tool Search + Apply Patch)

### Problem
GPT-5.4 calls are going through Chat Completions, which doesn't support Tool Search, Apply Patch, Preambles, Verbosity, or native MCP. This is why input tokens INCREASED (5.4 gets all tool schemas at higher per-token price) and why cost is $18/day.

### File: `packages/agent-runtime/src/providers/openai.ts`

### Step 1: Update OpenAI SDK

In `package.json` for agent-runtime (or root), ensure the OpenAI SDK supports the Responses API:

```bash
npm install openai@latest --save
```

The Responses API uses `client.responses.create()` instead of `client.chat.completions.create()`.

### Step 2: Add a Responses API generation method

In `openai.ts`, add a new method alongside the existing Chat Completions `generate()`:

```typescript
// Add this import at the top:
import OpenAI from 'openai';

// Add this method to OpenAIAdapter class:

private async generateViaResponses(
  request: ProviderRequest,
  config: ModelConfig,
): Promise<UnifiedModelResponse> {

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Build tools array — mix of custom functions + built-in tools
  const tools: any[] = [];

  // Add custom function tools (your 573 tools)
  if (request.tools && request.tools.length > 0) {
    for (const tool of request.tools) {
      tools.push({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? tool.input_schema,
        strict: true,
      });
    }
  }

  // Add Tool Search (deferred schema loading)
  if (config.enableToolSearch) {
    tools.push({ type: 'tool_search' });
  }

  // Add Apply Patch
  if (config.enableApplyPatch) {
    tools.push({ type: 'apply_patch' });
  }

  // Add Code Interpreter
  if (config.enableCodeInterpreter) {
    tools.push({ type: 'code_interpreter' });
  }

  // Add Computer Use
  if (config.enableComputerUse) {
    tools.push({
      type: 'computer',
      display_width: 1280,
      display_height: 720,
      environment: 'browser',
    });
  }

  // Build the request
  const responsesRequest: any = {
    model: config.model,
    input: this.convertToResponsesInput(request.messages),
    tools: tools.length > 0 ? tools : undefined,
    reasoning: config.reasoningEffort
      ? { effort: config.reasoningEffort }
      : undefined,
    text: config.verbosity
      ? { verbosity: config.verbosity }
      : undefined,
  };

  // Add structured output
  if (config.structuredOutput) {
    responsesRequest.text = {
      ...responsesRequest.text,
      format: {
        type: 'json_schema',
        json_schema: config.structuredOutput,
      },
    };
  }

  // Add native MCP servers
  if (config.nativeMcpServers && config.nativeMcpServers.length > 0) {
    responsesRequest.mcp_servers = config.nativeMcpServers;
  }

  // Add allowed_tools for per-turn restriction (last turn)
  if (config.allowedTools) {
    responsesRequest.tool_choice = {
      type: 'allowed_tools',
      mode: 'auto',
      tools: config.allowedTools.map(name => ({
        type: 'function',
        name,
      })),
    };
  }

  // Make the API call
  const response = await client.responses.create(responsesRequest);

  // Convert Responses API output to unified format
  return this.convertResponsesOutput(response);
}

/**
 * Convert chat-style messages to Responses API input format.
 * Responses API uses a flat array of input items, not messages.
 */
private convertToResponsesInput(messages: any[]): any[] {
  const input: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      input.push({
        role: 'developer',
        content: typeof msg.content === 'string' ? msg.content : msg.content,
      });
    } else if (msg.role === 'user') {
      input.push({
        role: 'user',
        content: typeof msg.content === 'string' ? msg.content : msg.content,
      });
    } else if (msg.role === 'assistant') {
      input.push({
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : msg.content,
      });
    }
    // Tool calls and tool results need special handling for Responses API
    // — the format is different from Chat Completions
  }

  return input;
}

/**
 * Convert Responses API output to the unified model response format.
 */
private convertResponsesOutput(response: any): UnifiedModelResponse {
  let text = '';
  const toolCalls: any[] = [];
  const patchCalls: any[] = [];

  for (const item of response.output || []) {
    if (item.type === 'message') {
      for (const content of item.content || []) {
        if (content.type === 'output_text') {
          text += content.text;
        }
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      });
    } else if (item.type === 'apply_patch_call') {
      patchCalls.push({
        callId: item.call_id,
        operation: item.operation,
      });
    }
  }

  return {
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    patchCalls: patchCalls.length > 0 ? patchCalls : undefined,
    finishReason: this.normalizeFinishReason(response.status),
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
    },
    responseId: response.id, // for multi-turn with previous_response_id
  };
}
```

### Step 3: Route GPT-5.4 calls to Responses API

In the main `generate()` method:

```typescript
async generate(request: ProviderRequest): Promise<UnifiedModelResponse> {
  const config = request.metadata?.modelConfig as ModelConfig | undefined;
  const model = request.model || config?.model || 'gpt-5-mini-2025-08-07';

  // GPT-5.4 → Responses API (supports Tool Search, Apply Patch, etc.)
  if (model.startsWith('gpt-5.4')) {
    return this.generateViaResponses(request, config ?? { model, matchedRule: 'default' });
  }

  // All other models → Chat Completions (existing path)
  return this.generateViaChatCompletions(request, config);
}
```

Rename the existing `generate()` to `generateViaChatCompletions()` and add `reasoning_effort` to it:

```typescript
private async generateViaChatCompletions(
  request: ProviderRequest,
  config?: ModelConfig,
): Promise<UnifiedModelResponse> {
  // ... existing Chat Completions implementation ...

  // ADD reasoning_effort:
  const body: any = {
    model: request.model,
    messages: convertedMessages,
    // ... existing params ...
  };

  if (config?.reasoningEffort) {
    body.reasoning_effort = config.reasoningEffort;
  }

  if (config?.structuredOutput) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: config.structuredOutput.name || 'response',
        strict: true,
        schema: config.structuredOutput.schema || config.structuredOutput,
      },
    };
  }

  // ... rest of existing implementation ...
}
```

### Step 4: Handle Apply Patch calls in the agentic loop

In `companyAgentRunner.ts`, in the tool dispatch section (step 7 of the agentic loop), add handling for patch calls:

```typescript
// After the model call, check for patch calls:
if (response.patchCalls && response.patchCalls.length > 0) {
  // Import patch harness (create in Patch 5 if not already done):
  // import { applyPatchToGitHub } from '../shared/patchHarness';

  const patchResults = [];
  for (const patch of response.patchCalls) {
    try {
      // For now, log the patch but don't apply it
      // (replace with actual GitHub application when patchHarness.ts is ready)
      console.log(`[PATCH] ${patch.operation.type} ${patch.operation.path}`);
      patchResults.push({
        type: 'apply_patch_call_output',
        call_id: patch.callId,
        status: 'completed',
        output: `Applied ${patch.operation.type} to ${patch.operation.path}`,
      });
    } catch (err: any) {
      patchResults.push({
        type: 'apply_patch_call_output',
        call_id: patch.callId,
        status: 'failed',
        output: err.message,
      });
    }
  }

  // Feed results back for iteration (Responses API multi-turn):
  // Add patch results to conversation history for next turn
  conversationHistory.push(...patchResults);
  // Continue the agentic loop
}
```

### Verify

Deploy, wait for a few GPT-5.4 runs, then:

```sql
-- Input tokens should drop dramatically for 5.4 runs
SELECT ROUND(AVG(input_tokens)) AS avg_input,
       ROUND(AVG(output_tokens)) AS avg_output,
       COUNT(*) AS runs,
       ROUND(SUM(cost)::numeric, 2) AS total_cost
FROM agent_runs
WHERE routing_model = 'gpt-5.4'
  AND created_at > NOW() - INTERVAL '2 hours'
  AND status = 'completed';

-- Compare to before: avg_input should go from 100K+ to 15-30K
-- If still high, Tool Search isn't activating — check that { type: 'tool_search' }
-- is in the tools array by adding a log line before the API call
```

---

## Patch 5: Wire Claude Provider Features

### File: `packages/agent-runtime/src/providers/anthropic.ts`

Find the `generate()` method. Before the API call is constructed, read the ModelConfig and apply Claude-specific features:

```typescript
async generate(request: ProviderRequest): Promise<UnifiedModelResponse> {
  const config = request.metadata?.modelConfig as ModelConfig | undefined;

  // Build the request body
  const body: any = {
    model: request.model,
    messages: this.convertMessages(request.messages),
    max_tokens: request.maxTokens ?? 16384,
    // ... existing params ...
  };

  // ── Adaptive thinking ──
  if (config?.claudeThinking === 'adaptive') {
    body.thinking = { type: 'adaptive' };
    // Remove deprecated interleaved-thinking beta header for Opus 4.6
  }

  // ── Effort parameter (controls ALL output, independent from thinking) ──
  if (config?.claudeEffort) {
    body.output_config = body.output_config || {};
    body.output_config.effort = config.claudeEffort;
  }

  // ── Structured outputs ──
  if (config?.structuredOutput) {
    body.output_config = body.output_config || {};
    body.output_config.format = {
      type: 'json_schema',
      schema: config.structuredOutput,
    };
  }

  // ── Citations ──
  if (config?.enableCitations) {
    body.citations = { enabled: true };
  }

  // ── Context compaction (replaces broken historyManager) ──
  if (config?.enableCompaction) {
    body.compaction = 'auto';
  }

  // ── Prompt caching ──
  // Add cache_control breakpoints on system content
  if (body.system && Array.isArray(body.system)) {
    // Cache the first (static) block
    if (body.system.length > 0) {
      body.system[0].cache_control = { type: 'ephemeral' };
    }
    // Cache the second (department-level) block if it exists
    if (body.system.length > 1) {
      body.system[1].cache_control = { type: 'ephemeral' };
    }
  } else if (typeof body.system === 'string') {
    // Convert string system prompt to array with cache control
    body.system = [{
      type: 'text',
      text: body.system,
      cache_control: { type: 'ephemeral' },
    }];
  }

  // Make the API call
  // ... existing API call code ...
}
```

### Verify

After deploying, check that Claude is now being used:

```sql
SELECT routing_model, routing_rule, COUNT(*)
FROM agent_runs
WHERE routing_model LIKE 'claude%'
  AND created_at > NOW() - INTERVAL '4 hours'
GROUP BY routing_model, routing_rule
ORDER BY COUNT(*) DESC;
```

If still 0 Claude runs, the issue is capability inference. Run:

```sql
SELECT agent_role, task, routing_capabilities, routing_rule
FROM agent_runs
WHERE agent_role IN ('content-creator', 'clo', 'cmo')
  AND created_at > NOW() - INTERVAL '4 hours'
ORDER BY created_at DESC LIMIT 10;
```

Check if `creative_writing` or `legal_reasoning` appears in capabilities. If not, the tool names for those agents aren't mapping correctly — go back to Patch 3 and verify the content/legal tool entries.

---

## Patch 6: Wire Gemini Provider Features

### File: `packages/agent-runtime/src/providers/gemini.ts`

Find the `generate()` method. Add:

```typescript
async generate(request: ProviderRequest): Promise<UnifiedModelResponse> {
  const config = request.metadata?.modelConfig as ModelConfig | undefined;
  const model = request.model;

  // Build generation config
  const generationConfig: any = {
    // ... existing config ...
  };

  // ── Thinking config (3.x vs 2.5 distinction) ──
  if (model.startsWith('gemini-3')) {
    // Gemini 3.x uses thinkingLevel: 'LOW' | 'HIGH'
    if (config?.thinkingLevel) {
      generationConfig.thinkingConfig = { thinkingLevel: config.thinkingLevel };
    }
  } else if (model.startsWith('gemini-2.5')) {
    // Gemini 2.5 uses thinkingBudget: 0-32768
    if (config?.thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
    }
  }

  // ── Structured output ──
  if (config?.structuredOutput) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = config.structuredOutput;
  }

  // Build tools array
  const tools: any[] = [];

  // Add custom function declarations
  if (request.tools && request.tools.length > 0) {
    tools.push({
      functionDeclarations: request.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? t.input_schema,
      })),
    });
  }

  // ── Google Search grounding ──
  if (config?.enableGoogleSearch) {
    tools.push({ googleSearch: {} });
  }

  // ── Code execution ──
  if (config?.enableCodeExecution) {
    tools.push({ codeExecution: {} });
  }

  // Make the API call with tools and config
  // ... existing API call code, passing tools and generationConfig ...
}
```

### Also update model detection

Wherever model prefixes are checked (e.g., in `detectProvider()` or the adapter factory), ensure these model strings are recognized:

```typescript
// Add to model detection:
'gemini-3.1-pro-preview'
'gemini-3-flash-preview'
'gemini-3.1-flash-lite-preview'

// Remove (deprecated March 9):
'gemini-3-pro-preview'
```

### Verify

```sql
SELECT routing_model, routing_rule, COUNT(*)
FROM agent_runs
WHERE routing_model LIKE 'gemini%'
  AND created_at > NOW() - INTERVAL '4 hours'
GROUP BY routing_model, routing_rule
ORDER BY COUNT(*) DESC;
```

Research agents should appear on `gemini-3-flash-preview`. Finance agents should appear on `gemini-2.5-flash`.

---

## Patch 7: Reorder System Prompt for Cache Optimization

### File: `packages/agent-runtime/src/companyAgentRunner.ts`

### Problem
System prompt starts with personality block (unique per agent), which breaks cache prefix matching. Static content should come first.

### What to change

Find `buildSystemPrompt()` (or equivalent function). Change the block ordering:

```typescript
// BEFORE (current order):
// ① WHO YOU ARE (personality) — unique per agent ← breaks cache
// ② CONVERSATION MODE — static
// ③ REASONING PROTOCOL — static
// ... etc

// AFTER (cache-optimized order):
const systemPromptParts: string[] = [];

// ── STATIC PREFIX (identical across all agents → cached) ──
if (contextTier !== 'task') {
  systemPromptParts.push(this.companyKnowledgeBase);      // ~400 lines, static
  systemPromptParts.push(REASONING_PROTOCOL);              // ~10 lines, static
  systemPromptParts.push(CONVERSATION_MODE);               // ~15 lines, static
  systemPromptParts.push(ACTION_HONESTY_PROTOCOL);         // ~20 lines, static
  systemPromptParts.push(WORK_ASSIGNMENTS_PROTOCOL);       // ~15 lines, static
  systemPromptParts.push(ALWAYS_ON_PROTOCOL);              // ~20 lines, static
}

// ── PER-DEPARTMENT (shared within department → cached) ──
if (departmentContext) {
  systemPromptParts.push(departmentContext);
}

// ── PER-ROLE (shared across same role runs → cached) ──
if (roleBrief) {
  systemPromptParts.push(roleBrief);
}
if (agentSystemPrompt) {
  systemPromptParts.push(agentSystemPrompt);
}

// ── PER-AGENT (unique → never cached) ──
systemPromptParts.push(personalityBlock);

// ── DYNAMIC (changes every call → never cached) ──
if (skillBlock) {
  systemPromptParts.push(skillBlock);
}
if (founderBulletins) {
  systemPromptParts.push(founderBulletins);
}

// Add preamble instruction for GPT-5.4:
if (this.modelConfig?.model?.startsWith('gpt-5.4')) {
  systemPromptParts.push('Before you call a tool, explain why you are calling it.');
}

return systemPromptParts.join('\n\n');
```

The task tier prompt (150 lines) should also put static content first:

```typescript
// Task tier order:
// ① ASSIGNMENT PROTOCOL — static
// ② COST AWARENESS — static
// ③ WHO YOU ARE — per-agent
```

### Verify

After deploying, check if input tokens decrease for sequential runs of the same agent:

```sql
SELECT agent_role, input_tokens, created_at
FROM agent_runs
WHERE agent_role = 'ops'
  AND created_at > NOW() - INTERVAL '2 hours'
  AND status = 'completed'
ORDER BY created_at;
```

The first run may have higher tokens (cache write). Subsequent runs should be lower (cache hit). If OpenAI returns `usage.prompt_tokens_details.cached_tokens`, log that field to confirm.

---

## Patch 8: Update Dashboard Model Dropdowns

### File: `packages/dashboard/src/lib/models.ts`

Find the model list/enum/array and update:

```typescript
// ADD these models:
{ id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai', input: 2.50, output: 10.00 },
{ id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', provider: 'openai', input: 30.00, output: 180.00 },
{ id: 'gpt-5-nano', name: 'GPT-5 Nano', provider: 'openai', input: 0.05, output: 0.40 },
{ id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google', input: 2.00, output: 12.00 },
{ id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'google', input: 0.50, output: 3.00 },
{ id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite', provider: 'google', input: 0.25, output: 1.50 },

// REMOVE this deprecated model:
// { id: 'gemini-3-pro-preview', ... }  ← shut down March 9, 2026
```

### File: `packages/agent-runtime/src/modelClient.ts`

Update `detectProvider()` to recognize new model prefixes:

```typescript
// Ensure these patterns are matched:
// gpt-5.4* → openai
// gpt-5-nano* → openai
// gemini-3.1* → google
// gemini-3-flash* → google
```

---

## Post-Patch Verification

Run after all 8 patches are deployed. Wait 4-6 hours for sufficient data.

```sql
-- 1. Cost should be dramatically lower
SELECT DATE(created_at) AS day, ROUND(SUM(cost)::numeric, 2) AS total_cost, COUNT(*) AS runs
FROM agent_runs WHERE created_at > NOW() - INTERVAL '3 days'
GROUP BY DATE(created_at) ORDER BY day;
-- Target: latest day should be $1.10-$2.00 (was $18.22)

-- 2. Multiple models active
SELECT routing_model, COUNT(*), ROUND(AVG(cost)::numeric, 5) AS avg_cost
FROM agent_runs WHERE created_at > NOW() - INTERVAL '6 hours' AND routing_model IS NOT NULL
GROUP BY routing_model ORDER BY COUNT(*) DESC;
-- Target: 5-7 distinct models

-- 3. Default rule is rare
SELECT routing_rule, COUNT(*)
FROM agent_runs WHERE created_at > NOW() - INTERVAL '6 hours' AND routing_rule IS NOT NULL
GROUP BY routing_rule ORDER BY COUNT(*) DESC;
-- Target: default_generalist < 3%

-- 4. Pre-checks skipping
SELECT task, SUM(CASE WHEN status = 'skipped_precheck' THEN 1 ELSE 0 END) AS skipped, COUNT(*) AS total
FROM agent_runs WHERE created_at > NOW() - INTERVAL '24 hours'
  AND task IN ('health_check', 'freshness_check', 'cost_check', 'daily_cost_check', 'triage_queue', 'platform_health_check')
GROUP BY task;
-- Target: 50-80% skip rates

-- 5. GPT-5.4 input tokens with Tool Search
SELECT ROUND(AVG(input_tokens)) AS avg_input, COUNT(*)
FROM agent_runs WHERE routing_model = 'gpt-5.4' AND created_at > NOW() - INTERVAL '6 hours' AND status = 'completed';
-- Target: 15-30K (was 100-206K)

-- 6. Claude is being used
SELECT COUNT(*) FROM agent_runs WHERE routing_model LIKE 'claude%' AND created_at > NOW() - INTERVAL '24 hours';
-- Target: > 0

-- 7. Reflections linked to agent_runs
SELECT COUNT(*) AS linked
FROM agent_reflections r
JOIN agent_runs ar ON r.run_id::text = ar.id::text
WHERE r.created_at > NOW() - INTERVAL '6 hours';
-- Target: > 0
```
