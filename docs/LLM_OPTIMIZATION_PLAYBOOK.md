# LLM Optimization Ship-and-Launch Playbook
## Sequential GitHub Issues for Copilot Execution

> **Pattern:** Each issue is self-contained. Complete Issue N before starting Issue N+1.
> **Execution:** Create each as a GitHub Issue labeled `copilot`, `llm-optimization`. Branch: `feature/agent-llm-optimization`.
> **Model:** Default `gpt-5-mini-2025-08-07` until Issue 6 flips routing on.
> **Test after each issue:** Deploy to staging, run 10 agent cycles, verify no regressions in `agent_runs`.

---

## Issue 1 of 17: Database Migration — Add Routing Observability Columns

**Branch:** `feature/agent-llm-optimization`
**Files:** 1 new

### Step 1: Create migration file

Create `db/migrations/139_add_routing_columns.sql`:

```sql
-- Migration 139: Add routing observability columns to agent_runs
-- These columns track which model routing rule matched, what capabilities
-- were inferred, and which model was selected for each agent run.
-- No backfill needed — new runs will populate these going forward.

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routing_rule TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routing_capabilities TEXT[];
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routing_model TEXT;

-- Add 'skipped_precheck' to the status check if using an enum or check constraint.
-- If status is a plain TEXT column, no change needed.
-- If there's a CHECK constraint, update it:
-- ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
-- ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check
--   CHECK (status IN ('running', 'completed', 'failed', 'aborted', 'skipped_precheck'));

-- Index for routing analysis queries
CREATE INDEX IF NOT EXISTS idx_agent_runs_routing_model ON agent_runs (routing_model)
  WHERE routing_model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_routing_rule ON agent_runs (routing_rule)
  WHERE routing_rule IS NOT NULL;

COMMENT ON COLUMN agent_runs.routing_rule IS 'Name of the routing rule that matched (e.g., standard_code_gen, web_research, deterministic_skip)';
COMMENT ON COLUMN agent_runs.routing_capabilities IS 'Capability tags inferred for this run (e.g., {code_generation, high_complexity, needs_apply_patch})';
COMMENT ON COLUMN agent_runs.routing_model IS 'Model ID selected by the router (e.g., gpt-5.4, claude-sonnet-4-6, gpt-5-nano)';
```

### Step 2: Run the migration

```bash
# Connect to Cloud SQL and run:
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f db/migrations/139_add_routing_columns.sql
```

### Acceptance criteria
- [ ] `agent_runs` table has `routing_rule`, `routing_capabilities`, `routing_model` columns
- [ ] Indexes exist on both columns
- [ ] Existing rows have NULL for all three columns (no backfill)
- [ ] New `INSERT INTO agent_runs` statements still work without specifying these columns

---

## Issue 2 of 17: Create Capability Type Definitions and Tool-to-Capability Map

**Branch:** `feature/agent-llm-optimization`
**Files:** 3 new
**Depends on:** Issue 1

### Step 1: Create `packages/agent-runtime/src/routing/capabilities.ts`

```typescript
/**
 * Capability tags describe what an LLM call needs to accomplish.
 * The router infers capabilities from task type, tools, department,
 * skills, and assignment instructions — never from agent role names.
 *
 * Add new capabilities here when new task patterns emerge.
 */

export type Capability =
  // ── What the model needs to produce ──
  | 'code_generation'        // Writing/editing production code
  | 'creative_writing'       // Long-form content, brand-voice, proposals
  | 'legal_reasoning'        // Regulation analysis, contract review, compliance
  | 'financial_computation'  // Math-heavy analysis, trend computation
  | 'web_research'           // Real-time web search with grounded citations
  | 'visual_analysis'        // Analyzing screenshots, images, UI layouts
  | 'nuanced_evaluation'     // Judging quality, accept/reject decisions
  | 'structured_extraction'  // Entity extraction, classification, formatting
  | 'simple_tool_calling'    // Executing known tool sequences, scheduling
  | 'orchestration'          // Decomposing directives, dispatching agents

  // ── Complexity modifiers ──
  | 'high_complexity'        // Multi-step reasoning, architecture decisions
  | 'low_complexity'         // Routine checks, simple lookups, status
  | 'batch_eligible'         // Not time-sensitive, can defer to batch API

  // ── Feature requirements ──
  | 'needs_citations'        // Must trace claims to source documents
  | 'needs_code_execution'   // Needs in-model Python (Pandas/NumPy)
  | 'needs_apply_patch'      // Code editing via diffs preferred over full rewrite
  | 'needs_tool_search'      // Synonym for many_tools, explicit
  | 'needs_computer_use'     // Visual interaction with live UIs
  | 'needs_compaction'       // Long multi-turn conversation management
  | 'needs_mcp_direct'       // Can use native MCP instead of bridge
  | 'many_tools'             // Agent has 40+ tools — needs Tool Search
  | 'deterministic_possible' // Might not need an LLM at all
  ;
```

### Step 2: Create `packages/agent-runtime/src/routing/toolCapabilityMap.ts`

```typescript
import type { Capability } from './capabilities';

/**
 * Maps tool names → capabilities they indicate.
 * This is the ONLY place tool names appear in routing logic.
 *
 * When an agent has a tool listed here, the corresponding capabilities
 * are added to the inferred capability set for routing.
 *
 * To add a new tool: add one line here. Routing adapts automatically
 * for every agent that has that tool granted.
 */
export const TOOL_CAPABILITY_MAP: Record<string, Capability[]> = {

  // ━━━ Code generation / editing ━━━
  'read_file':               ['code_generation'],
  'write_file':              ['code_generation'],
  'get_file_contents':       ['code_generation'],
  'create_or_update_file':   ['code_generation'],
  'create_branch':           ['code_generation'],
  'search_code':             ['code_generation'],
  'read_frontend_file':      ['code_generation'],
  'write_frontend_file':     ['code_generation'],
  'search_frontend_code':    ['code_generation'],
  'list_frontend_files':     ['code_generation'],
  'create_frontend_file':    ['code_generation'],
  'create_design_branch':    ['code_generation'],
  'create_frontend_pr':      ['code_generation'],
  'check_pr_status':         ['code_generation'],
  'scaffold_component':      ['code_generation'],
  'scaffold_page':           ['code_generation'],
  'list_templates':          ['code_generation'],
  'clone_and_modify':        ['code_generation'],
  'run_test_suite':          ['code_generation'],
  'get_code_coverage':       ['code_generation'],
  'get_quality_metrics':     ['code_generation'],
  'create_test_plan':        ['code_generation'],
  'deploy_preview':          ['code_generation'],
  'get_deployment_status':   ['code_generation'],
  'list_deployments':        ['code_generation'],

  // ━━━ Visual analysis ━━━
  'screenshot_page':         ['visual_analysis'],
  'screenshot_component':    ['visual_analysis'],
  'compare_screenshots':     ['visual_analysis'],
  'check_responsive':        ['visual_analysis'],
  'storybook_screenshot':    ['visual_analysis'],
  'storybook_screenshot_all': ['visual_analysis'],
  'storybook_visual_diff':   ['visual_analysis'],
  'run_lighthouse_audit':    ['visual_analysis'],
  'run_accessibility_audit': ['visual_analysis'],
  'check_ai_smell':          ['visual_analysis'],
  'validate_brand_compliance': ['visual_analysis'],

  // ━━━ Web research ━━━
  'web_search':              ['web_research'],
  'web_fetch':               ['web_research'],
  'search_news':             ['web_research'],
  'submit_research_packet':  ['web_research'],
  'save_research':           ['web_research'],
  'search_research':         ['web_research'],
  'create_research_brief':   ['web_research'],
  'create_monitor':          ['web_research'],
  'check_monitors':          ['web_research'],
  'search_academic_papers':  ['web_research'],
  'track_competitor_product': ['web_research'],
  'compile_research_digest': ['web_research'],
  'cross_reference_findings': ['web_research'],

  // ━━━ Financial computation ━━━
  'get_financials':          ['financial_computation'],
  'get_mrr_breakdown':       ['financial_computation'],
  'get_subscription_details': ['financial_computation'],
  'get_churn_analysis':      ['financial_computation'],
  'get_revenue_forecast':    ['financial_computation', 'needs_code_execution'],
  'get_stripe_invoices':     ['financial_computation'],
  'get_customer_ltv':        ['financial_computation', 'needs_code_execution'],
  'calculate_unit_economics': ['financial_computation', 'needs_code_execution'],
  'get_vendor_costs':        ['financial_computation'],
  'get_cost_anomalies':      ['financial_computation'],
  'get_burn_rate':           ['financial_computation', 'needs_code_execution'],
  'create_budget':           ['financial_computation'],
  'check_budget_status':     ['financial_computation'],
  'get_cash_balance':        ['financial_computation'],
  'get_cash_flow':           ['financial_computation'],
  'get_pending_transactions': ['financial_computation'],
  'generate_financial_report': ['financial_computation'],
  'get_margin_analysis':     ['financial_computation', 'needs_code_execution'],
  'query_stripe_mrr':        ['financial_computation'],
  'query_stripe_subscriptions': ['financial_computation'],
  'write_financial_report':  ['financial_computation'],
  'get_infrastructure_costs': ['financial_computation'],
  'get_system_costs_realtime': ['financial_computation'],

  // ━━━ Creative writing / content ━━━
  'create_content_draft':    ['creative_writing'],
  'update_content_draft':    ['creative_writing'],
  'submit_content_for_review': ['creative_writing'],
  'approve_content_draft':   ['creative_writing'],
  'reject_content_draft':    ['creative_writing'],
  'publish_content':         ['creative_writing'],
  'generate_content_image':  ['creative_writing'],
  'generate_and_publish_asset': ['creative_writing'],
  'publish_asset_deliverable': ['creative_writing'],
  'create_canva_design':     ['creative_writing'],
  'generate_canva_design':   ['creative_writing'],
  'create_logo_variation':   ['creative_writing'],
  'restyle_logo':            ['creative_writing'],

  // ━━━ Legal reasoning ━━━
  'get_compliance_status':   ['legal_reasoning', 'needs_citations'],
  'get_contracts':           ['legal_reasoning', 'needs_citations'],
  'get_ip_portfolio':        ['legal_reasoning'],
  'update_compliance_item':  ['legal_reasoning'],
  'create_contract':         ['legal_reasoning', 'needs_citations'],
  'create_signing_envelope': ['legal_reasoning'],
  'send_template_envelope':  ['legal_reasoning'],
  'check_envelope_status':   ['legal_reasoning'],

  // ━━━ Evaluation / orchestration ━━━
  'evaluate_assignment':           ['nuanced_evaluation'],
  'check_assignment_status':       ['nuanced_evaluation'],
  'evaluate_team_output':          ['nuanced_evaluation'],
  'review_team_output':            ['nuanced_evaluation'],
  'read_founder_directives':       ['orchestration'],
  'create_work_assignments':       ['orchestration'],
  'dispatch_assignment':           ['orchestration'],
  'update_directive_progress':     ['orchestration'],
  'create_team_assignments':       ['orchestration'],
  'synthesize_team_deliverable':   ['orchestration'],
  'assign_team_task':              ['orchestration'],

  // ━━━ Design system (non-code, non-visual) ━━━
  'get_design_tokens':       ['structured_extraction'],
  'update_design_token':     ['code_generation'],
  'validate_tokens_vs_implementation': ['visual_analysis'],
  'get_color_palette':       ['structured_extraction'],
  'get_typography_scale':    ['structured_extraction'],
  'list_components':         ['structured_extraction'],
  'get_component_usage':     ['structured_extraction'],

  // ━━━ Figma (read = extraction, write = creative) ━━━
  'get_figma_file':          ['structured_extraction'],
  'get_figma_components':    ['structured_extraction'],
  'get_figma_styles':        ['structured_extraction'],
  'get_figma_comments':      ['structured_extraction'],
  'post_figma_comment':      ['creative_writing'],
  'get_figma_file_metadata': ['structured_extraction'],
  'export_figma_images':     ['visual_analysis'],

  // ━━━ Simple tool calling / scheduling ━━━
  'schedule_social_post':    ['simple_tool_calling'],
  'get_scheduled_posts':     ['simple_tool_calling'],
  'get_social_metrics':      ['simple_tool_calling'],
  'get_search_performance':  ['simple_tool_calling'],
  'track_keyword_rankings':  ['simple_tool_calling'],
  'get_indexing_status':     ['simple_tool_calling'],
  'get_usage_metrics':       ['simple_tool_calling'],
  'get_funnel_analysis':     ['simple_tool_calling'],

  // ━━━ HR / admin (simple operations) ━━━
  'entra_get_user_profile':  ['simple_tool_calling'],
  'entra_update_user_profile': ['simple_tool_calling'],
  'entra_audit_profiles':    ['simple_tool_calling'],

  // ━━━ Ops monitoring ━━━
  'get_platform_health':     ['deterministic_possible'],
  'get_cloud_run_metrics':   ['deterministic_possible'],
  'get_agent_health_dashboard': ['deterministic_possible'],
  'get_event_bus_health':    ['deterministic_possible'],
  'get_data_freshness':      ['deterministic_possible'],
  'query_vercel_health':     ['deterministic_possible'],
  'write_health_report':     ['simple_tool_calling'],
  'create_status_report':    ['simple_tool_calling'],
};

/**
 * MCP server → capability requirements.
 * Used by inferMcpServers() to determine which MCP servers
 * an agent actually needs for a given task.
 */
export const MCP_SERVER_CAPABILITIES: Record<string, Capability[]> = {
  // Glyphor MCP servers
  'mcp_GlyphorData':           [],  // lightweight reads, always include
  'mcp_GlyphorMarketing':      ['creative_writing', 'web_research'],
  'mcp_GlyphorEngineering':    ['code_generation'],
  'mcp_GlyphorDesign':         ['visual_analysis', 'code_generation'],
  'mcp_GlyphorFinance':        ['financial_computation'],
  'mcp_GlyphorLegal':          ['legal_reasoning'],
  'mcp_GlyphorHR':             [],  // include when department is People & Culture
  'mcp_GlyphorEmailMarketing': ['creative_writing'],

  // Agent365 MCP servers
  'mcp_MailTools':             [],  // include when agent has email tools or needs comms
  'mcp_CalendarTools':         [],  // include when scheduling-related
  'mcp_ODSPRemoteServer':      [],  // include when document operations needed
  'mcp_TeamsServer':           [],  // include when Teams messaging needed
  'mcp_WordServer':            ['creative_writing'],  // document creation
  'mcp_M365Copilot':           [],  // rarely needed — only on explicit request
  'mcp_UserProfile':           [],  // rarely needed
  'mcp_SharePointLists':       [],  // rarely needed
};

/**
 * Minimum A365 servers included for all agents (email + calendar basics).
 * Additional servers added based on capabilities.
 */
export const BASE_A365_SERVERS = ['mcp_MailTools', 'mcp_CalendarTools'];

/**
 * A365 servers that should ONLY be included when specific capabilities match.
 * Not included by default.
 */
export const OPTIONAL_A365_SERVERS: Record<string, Capability[]> = {
  'mcp_ODSPRemoteServer':  ['creative_writing', 'web_research', 'legal_reasoning'],
  'mcp_TeamsServer':        ['orchestration'],
  'mcp_WordServer':         ['creative_writing', 'legal_reasoning'],
  'mcp_M365Copilot':        [],   // never auto-included
  'mcp_UserProfile':        [],   // never auto-included
  'mcp_SharePointLists':    [],   // never auto-included
};
```

### Step 3: Create `packages/agent-runtime/src/routing/index.ts`

```typescript
export type { Capability } from './capabilities';
export { TOOL_CAPABILITY_MAP, MCP_SERVER_CAPABILITIES, BASE_A365_SERVERS, OPTIONAL_A365_SERVERS } from './toolCapabilityMap';
export { inferCapabilities, inferMcpServers, type RoutingContext } from './inferCapabilities';
export { resolveModel, routeModel, type ModelConfig } from './resolveModel';
```

### Acceptance criteria
- [ ] `packages/agent-runtime/src/routing/` directory exists with 3 files
- [ ] `Capability` type exported
- [ ] `TOOL_CAPABILITY_MAP` covers all tool names from `AGENT_PLATFORM_REFERENCE.md` Part 2
- [ ] `MCP_SERVER_CAPABILITIES` maps all 8 Glyphor + 8 A365 servers
- [ ] TypeScript compiles with no errors: `npx tsc --noEmit` in agent-runtime

---

## Issue 3 of 17: Create Capability Inference Engine

**Branch:** `feature/agent-llm-optimization`
**Files:** 1 new
**Depends on:** Issue 2

### Step 1: Create `packages/agent-runtime/src/routing/inferCapabilities.ts`

```typescript
import type { Capability } from './capabilities';
import {
  TOOL_CAPABILITY_MAP,
  MCP_SERVER_CAPABILITIES,
  BASE_A365_SERVERS,
  OPTIONAL_A365_SERVERS,
} from './toolCapabilityMap';

/**
 * Everything the router needs to infer capabilities.
 * All fields come from data already available in the runner
 * at the point between context tier resolution and model call.
 */
export interface RoutingContext {
  task: string;
  contextTier: string;
  toolNames: string[];
  department?: string;
  skillSlugs?: string[];
  assignmentInstructions?: string;
  toolCount: number;
  trustScore?: number;
}

/**
 * Infer capabilities from 4 signal layers.
 * No agent role names appear anywhere in this function.
 */
export function inferCapabilities(ctx: RoutingContext): Set<Capability> {
  const caps = new Set<Capability>();
  const toolSet = new Set(ctx.toolNames);

  // ━━━ LAYER 1: Task type (universal, always applies) ━━━

  switch (ctx.task) {
    case 'orchestrate':
    case 'strategic_planning':
      caps.add('orchestration');
      caps.add('high_complexity');
      break;

    case 'on_demand':
      if (ctx.contextTier === 'light') {
        caps.add('low_complexity');
        caps.add('simple_tool_calling');
      }
      caps.add('needs_compaction');
      break;

    case 'reflection':
    case 'kg_update':
    case 'constitutional_eval':
      caps.add('structured_extraction');
      caps.add('low_complexity');
      caps.add('batch_eligible');
      return caps; // early return — intelligence layer tasks don't need further inference

    case 'health_check':
    case 'freshness_check':
    case 'cost_check':
    case 'platform_health_check':
    case 'triage_queue':
      caps.add('deterministic_possible');
      caps.add('low_complexity');
      break;

    case 'morning_briefing':
    case 'eod_summary':
    case 'morning_status':
    case 'evening_status':
      caps.add('high_complexity');
      break;

    // proactive, work_loop, and other tasks — don't pre-assign complexity;
    // let tools/department/instructions determine it
  }

  // ━━━ LAYER 2: Tool signals (what tools tell us about the work) ━━━

  for (const toolName of ctx.toolNames) {
    const toolCaps = TOOL_CAPABILITY_MAP[toolName];
    if (toolCaps) {
      for (const cap of toolCaps) {
        caps.add(cap);
      }
    }
  }

  // Many tools → needs Tool Search
  if (ctx.toolCount >= 40) {
    caps.add('many_tools');
  }

  // ━━━ LAYER 3: Department signal ━━━

  if (ctx.department) {
    const dept = ctx.department.toLowerCase();

    if ((dept.includes('engineering') || dept.includes('design'))
        && (ctx.task === 'work_loop' || ctx.task === 'proactive')
        && !caps.has('code_generation')) {
      caps.add('code_generation');
    }

    if (dept.includes('research') && !caps.has('web_research')) {
      caps.add('web_research');
    }

    if (dept.includes('finance') && !caps.has('financial_computation')) {
      caps.add('financial_computation');
    }

    if (dept.includes('legal') && !caps.has('legal_reasoning')) {
      caps.add('legal_reasoning');
    }

    if (dept.includes('marketing') && ctx.task === 'work_loop' && !caps.has('creative_writing')) {
      // Marketing work_loop assignments are often content creation
      caps.add('creative_writing');
    }
  }

  // ━━━ LAYER 4: Assignment instruction analysis ━━━

  if (ctx.assignmentInstructions && (ctx.task === 'work_loop' || ctx.task === 'proactive')) {
    const instr = ctx.assignmentInstructions.toLowerCase();

    // Code generation signals
    if (/\b(implement|refactor|create component|write test|build|deploy|fix bug|pull request|branch|commit|scaffold|template|react|tailwind|typescript|css)\b/.test(instr)) {
      caps.add('code_generation');
    }

    // Code EDITING signals (prefer Apply Patch over full rewrite)
    if (/\b(refactor|rename|fix bug|update|migrate|edit|change|modify|patch|move|extract)\b/.test(instr)) {
      caps.add('needs_apply_patch');
    }

    // Creative writing signals
    if (/\b(draft|write|blog post|article|copy|brand voice|content|headline|tagline|proposal|press release|case study|email campaign)\b/.test(instr)) {
      caps.add('creative_writing');
    }

    // Research signals
    if (/\b(research|investigate|analyze competitor|market analysis|find out|look up|gather intelligence|landscape|benchmark)\b/.test(instr)) {
      caps.add('web_research');
    }

    // Financial signals
    if (/\b(calculate|forecast|burn rate|revenue|cost analysis|margin|unit economics|financial model|budget|mrr|arr|ltv|cac)\b/.test(instr)) {
      caps.add('financial_computation');
      caps.add('needs_code_execution');
    }

    // Legal signals
    if (/\b(compliance|regulation|gdpr|ccpa|eu ai act|contract|license|ip|patent|legal review|data privacy|soc 2)\b/.test(instr)) {
      caps.add('legal_reasoning');
      caps.add('needs_citations');
    }

    // Evaluation signals
    if (/\b(review|evaluate|assess quality|score|grade|accept or reject|critique|audit|inspect)\b/.test(instr)) {
      caps.add('nuanced_evaluation');
    }

    // High complexity signals
    if (/\b(architecture|migration|redesign|overhaul|strategy|roadmap|multi-step|complex|plan|decompose)\b/.test(instr)) {
      caps.add('high_complexity');
    }
  }

  // ━━━ TRUST SCORE ADJUSTMENT ━━━

  if (ctx.trustScore !== undefined && ctx.trustScore < 0.5) {
    // Low-trust agents get bumped to high complexity (more reasoning = more oversight)
    caps.add('high_complexity');
  }

  // ━━━ DEFAULT ━━━

  if (caps.size === 0 || (caps.size === 1 && (caps.has('low_complexity') || caps.has('deterministic_possible')))) {
    caps.add('simple_tool_calling');
  }

  return caps;
}

/**
 * Determine which MCP servers this task actually needs.
 * Returns server names to include in the agent's tool loading.
 *
 * This replaces the current behavior of loading ALL_M365_SERVERS
 * and all Glyphor MCP servers for every agent on every call.
 */
export function inferMcpServers(
  capabilities: Set<Capability>,
  department?: string,
): { glyphorServers: string[]; a365Servers: string[] } {

  // ── Glyphor MCP servers ──
  const glyphorServers: string[] = ['mcp_GlyphorData']; // always include data

  for (const [server, requiredCaps] of Object.entries(MCP_SERVER_CAPABILITIES)) {
    if (server.startsWith('mcp_Glyphor') && server !== 'mcp_GlyphorData') {
      // Include if ANY required capability matches
      if (requiredCaps.length === 0) {
        // Special case: HR server included when department matches
        if (server === 'mcp_GlyphorHR' && department?.toLowerCase().includes('people')) {
          glyphorServers.push(server);
        }
      } else if (requiredCaps.some(cap => capabilities.has(cap))) {
        glyphorServers.push(server);
      }
    }
  }

  // ── Agent365 MCP servers ──
  const a365Servers: string[] = [...BASE_A365_SERVERS]; // mail + calendar always

  for (const [server, requiredCaps] of Object.entries(OPTIONAL_A365_SERVERS)) {
    if (requiredCaps.length > 0 && requiredCaps.some(cap => capabilities.has(cap))) {
      a365Servers.push(server);
    }
  }

  return { glyphorServers, a365Servers };
}
```

### Acceptance criteria
- [ ] `inferCapabilities()` returns a Set of capabilities for any given RoutingContext
- [ ] `inferMcpServers()` returns filtered server lists (not all servers)
- [ ] No agent role names appear anywhere in the file
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Test: calling `inferCapabilities({ task: 'work_loop', contextTier: 'task', toolNames: ['write_frontend_file', 'scaffold_component'], department: 'Design & Frontend', toolCount: 41 })` returns a Set containing `code_generation` and `many_tools`
- [ ] Test: calling `inferMcpServers(new Set(['code_generation']))` returns `glyphorServers` containing `mcp_GlyphorEngineering` and NOT containing `mcp_GlyphorFinance` or `mcp_GlyphorLegal`

---

## Issue 4 of 17: Create Model Resolver (Capability → Model + Features)

**Branch:** `feature/agent-llm-optimization`
**Files:** 1 new
**Depends on:** Issue 3

### Step 1: Create `packages/agent-runtime/src/routing/resolveModel.ts`

```typescript
import type { Capability } from './capabilities';
import { inferCapabilities, inferMcpServers, type RoutingContext } from './inferCapabilities';

export interface ModelConfig {
  model: string;
  matchedRule: string;

  // ── OpenAI (Chat Completions + Responses API) ──
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  verbosity?: 'low' | 'medium' | 'high';
  enableApplyPatch?: boolean;
  enableToolSearch?: boolean;
  enableCodeInterpreter?: boolean;
  enableComputerUse?: boolean;
  enablePreambles?: boolean;

  // ── Gemini ──
  thinkingBudget?: number;
  thinkingLevel?: 'LOW' | 'HIGH';
  enableCodeExecution?: boolean;
  enableGoogleSearch?: boolean;

  // ── Anthropic (Claude) ──
  claudeEffort?: 'low' | 'medium' | 'high' | 'max';
  claudeThinking?: 'adaptive' | 'disabled';
  enableCitations?: boolean;
  enableCompaction?: boolean;

  // ── Cross-provider ──
  enableVision?: boolean;
  structuredOutput?: Record<string, unknown>;
  batchEligible?: boolean;

  // ── MCP filtering ──
  glyphorMcpServers?: string[];
  a365McpServers?: string[];
  nativeMcpServers?: Array<{ type: 'url'; url: string; name: string }>;
}

interface RoutingRule {
  name: string;
  match: (caps: Set<Capability>) => boolean;
  config: Omit<ModelConfig, 'matchedRule'>;
}

const DEFAULT_MODEL = 'gpt-5-mini-2025-08-07';

/**
 * Priority-ordered routing rules. First match wins.
 * Rules describe WHAT combination of capabilities triggers WHICH model + features.
 * No agent role names appear here.
 */
const ROUTING_RULES: RoutingRule[] = [

  // ━━━ DETERMINISTIC (no LLM) ━━━
  {
    name: 'deterministic_skip',
    match: (c) => c.has('deterministic_possible') && !c.has('high_complexity'),
    config: { model: '__deterministic__' },
  },

  // ━━━ BATCH-ELIGIBLE BULK WORK ━━━
  {
    name: 'batch_extraction',
    match: (c) => c.has('batch_eligible') && c.has('structured_extraction'),
    config: {
      model: 'gpt-5-nano',
      reasoningEffort: 'low',
      batchEligible: true,
      verbosity: 'low',
    },
  },

  // ━━━ ORCHESTRATION ━━━
  {
    name: 'orchestration',
    match: (c) => c.has('orchestration'),
    config: {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      enableToolSearch: true,
      enablePreambles: true,
    },
  },

  // ━━━ CODE EDITING (Apply Patch) ━━━
  {
    name: 'code_editing_with_patch',
    match: (c) => c.has('code_generation') && c.has('needs_apply_patch'),
    config: {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      enableApplyPatch: true,
      enablePreambles: true,
      verbosity: 'low',
    },
  },

  // ━━━ COMPLEX CODE GENERATION ━━━
  {
    name: 'complex_code_gen',
    match: (c) => c.has('code_generation') && c.has('high_complexity'),
    config: {
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      enableApplyPatch: true,
      enablePreambles: true,
    },
  },

  // ━━━ STANDARD CODE GENERATION ━━━
  {
    name: 'standard_code_gen',
    match: (c) => c.has('code_generation') && c.has('many_tools'),
    config: {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      enableToolSearch: true,
      enableApplyPatch: true,
      enablePreambles: true,
    },
  },
  {
    name: 'code_gen',
    match: (c) => c.has('code_generation'),
    config: {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      enableApplyPatch: true,
      enablePreambles: true,
    },
  },

  // ━━━ VISUAL ANALYSIS ━━━
  {
    name: 'visual_analysis',
    match: (c) => c.has('visual_analysis') && !c.has('code_generation'),
    config: {
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      enableVision: true,
      enablePreambles: true,
    },
  },

  // ━━━ WEB RESEARCH (Gemini native Google Search) ━━━
  {
    name: 'web_research',
    match: (c) => c.has('web_research') && !c.has('code_generation') && !c.has('creative_writing'),
    config: {
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'HIGH',
      enableGoogleSearch: true,
    },
  },

  // ━━━ FINANCIAL COMPUTATION (Gemini code execution) ━━━
  {
    name: 'financial_with_code_exec',
    match: (c) => c.has('financial_computation') && c.has('needs_code_execution'),
    config: {
      model: 'gemini-2.5-flash',
      thinkingBudget: 4096,
      enableCodeExecution: true,
    },
  },
  {
    name: 'financial_standard',
    match: (c) => c.has('financial_computation'),
    config: {
      model: DEFAULT_MODEL,
      reasoningEffort: 'medium',
    },
  },

  // ━━━ LEGAL REASONING (Claude + citations) ━━━
  {
    name: 'legal_with_citations',
    match: (c) => c.has('legal_reasoning') && c.has('needs_citations'),
    config: {
      model: 'claude-sonnet-4-6',
      claudeThinking: 'adaptive',
      claudeEffort: 'high',
      enableCitations: true,
    },
  },
  {
    name: 'legal_standard',
    match: (c) => c.has('legal_reasoning'),
    config: {
      model: 'claude-sonnet-4-6',
      claudeThinking: 'adaptive',
      claudeEffort: 'medium',
    },
  },

  // ━━━ CREATIVE WRITING (Claude) ━━━
  {
    name: 'creative_writing',
    match: (c) => c.has('creative_writing') && !c.has('code_generation'),
    config: {
      model: 'claude-sonnet-4-6',
      claudeThinking: 'adaptive',
      claudeEffort: 'high',
    },
  },

  // ━━━ NUANCED EVALUATION (Claude adaptive) ━━━
  {
    name: 'nuanced_evaluation',
    match: (c) => c.has('nuanced_evaluation') && !c.has('code_generation'),
    config: {
      model: 'claude-sonnet-4-6',
      claudeThinking: 'adaptive',
      claudeEffort: 'high',
    },
  },

  // ━━━ MANY TOOLS without code gen ━━━
  {
    name: 'many_tools_non_code',
    match: (c) => c.has('many_tools'),
    config: {
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      enableToolSearch: true,
      enablePreambles: true,
    },
  },

  // ━━━ SIMPLE + LOW COMPLEXITY ━━━
  {
    name: 'simple_low_complexity',
    match: (c) => c.has('simple_tool_calling') && c.has('low_complexity'),
    config: {
      model: 'gpt-5-nano',
      reasoningEffort: 'minimal',
      verbosity: 'low',
    },
  },

  // ━━━ SIMPLE TOOL CALLING ━━━
  {
    name: 'simple_tools',
    match: (c) => c.has('simple_tool_calling'),
    config: {
      model: DEFAULT_MODEL,
      reasoningEffort: 'medium',
    },
  },

  // ━━━ HIGH COMPLEXITY FALLBACK ━━━
  {
    name: 'high_complexity_fallback',
    match: (c) => c.has('high_complexity'),
    config: {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      enablePreambles: true,
    },
  },

  // ━━━ LOW COMPLEXITY FALLBACK ━━━
  {
    name: 'low_complexity_fallback',
    match: (c) => c.has('low_complexity'),
    config: {
      model: DEFAULT_MODEL,
      reasoningEffort: 'low',
    },
  },
];

const DEFAULT_CONFIG: Omit<ModelConfig, 'matchedRule'> = {
  model: DEFAULT_MODEL,
  reasoningEffort: 'medium',
};

/**
 * Resolve a set of capabilities to a model configuration.
 * Returns the first matching rule's config, or the default.
 */
export function resolveModel(capabilities: Set<Capability>): ModelConfig {
  for (const rule of ROUTING_RULES) {
    if (rule.match(capabilities)) {
      return { ...rule.config, matchedRule: rule.name };
    }
  }
  return { ...DEFAULT_CONFIG, matchedRule: 'default' };
}

/**
 * Convenience: infer capabilities + resolve model + infer MCP servers in one call.
 * This is what runners call.
 */
export function routeModel(ctx: RoutingContext): ModelConfig {
  const capabilities = inferCapabilities(ctx);
  const config = resolveModel(capabilities);
  const mcpServers = inferMcpServers(capabilities, ctx.department);

  return {
    ...config,
    glyphorMcpServers: mcpServers.glyphorServers,
    a365McpServers: mcpServers.a365Servers,
  };
}
```

### Acceptance criteria
- [ ] `resolveModel()` returns a `ModelConfig` with `matchedRule` for any Set of capabilities
- [ ] `routeModel()` combines inference + resolution + MCP filtering
- [ ] Rules are priority-ordered: deterministic first, batch second, orchestration third, etc.
- [ ] No agent role names appear anywhere
- [ ] Test: `routeModel({ task: 'work_loop', contextTier: 'task', toolNames: ['write_frontend_file'], department: 'Design & Frontend', toolCount: 41 })` returns `{ model: 'gpt-5.4', matchedRule: 'standard_code_gen', enableToolSearch: true, enableApplyPatch: true, ... }`
- [ ] Test: `routeModel({ task: 'health_check', contextTier: 'standard', toolNames: ['get_platform_health'], toolCount: 30 })` returns `{ model: '__deterministic__', matchedRule: 'deterministic_skip' }`
- [ ] Test: `routeModel({ task: 'work_loop', contextTier: 'task', toolNames: ['web_search', 'submit_research_packet'], department: 'Research & Intelligence', toolCount: 22 })` returns `{ model: 'gemini-3-flash-preview', matchedRule: 'web_research', enableGoogleSearch: true }`

---

## Issue 5 of 17: Create Deterministic Pre-Check Functions

**Branch:** `feature/agent-llm-optimization`
**Files:** 1 new
**Depends on:** Issue 1

### Step 1: Create `packages/agent-runtime/src/cronPreCheck.ts`

```typescript
import type { Pool } from 'pg';

export interface PreCheckResult {
  shouldCallLLM: boolean;
  reason: string;
  context?: string;
}

/**
 * Ops health check pre-check.
 * Queries data_sync_status for failures and agent_runs for failure spikes.
 * If everything is healthy, skip the LLM call entirely.
 */
export async function opsHealthPreCheck(db: Pool): Promise<PreCheckResult> {
  const [syncResult, failResult] = await Promise.all([
    db.query(`
      SELECT id, last_error, consecutive_failures
      FROM data_sync_status
      WHERE status = 'failed' OR consecutive_failures > 0
    `),
    db.query(`
      SELECT agent_role, COUNT(*) as fail_count
      FROM agent_runs
      WHERE status IN ('failed', 'aborted')
        AND created_at > NOW() - INTERVAL '2 hours'
      GROUP BY agent_role
      HAVING COUNT(*) > 2
    `),
  ]);

  if (syncResult.rowCount === 0 && failResult.rowCount === 0) {
    return { shouldCallLLM: false, reason: 'All systems healthy — 0 sync failures, 0 agent failure spikes' };
  }

  const context: string[] = [];
  if (syncResult.rowCount! > 0) {
    context.push(`Stale syncs: ${syncResult.rows.map((r: any) => `${r.id} (${r.consecutive_failures} consecutive failures, last error: ${r.last_error || 'unknown'})`).join('; ')}`);
  }
  if (failResult.rowCount! > 0) {
    context.push(`Agent failure spikes: ${failResult.rows.map((r: any) => `${r.agent_role}: ${r.fail_count} failures in last 2h`).join('; ')}`);
  }

  return {
    shouldCallLLM: true,
    reason: `${syncResult.rowCount} sync issues, ${failResult.rowCount} agent failure spikes`,
    context: context.join('\n'),
  };
}

/**
 * Ops freshness check pre-check.
 * Checks if any data sync is overdue based on its expected interval.
 */
export async function opsFreshnessPreCheck(db: Pool): Promise<PreCheckResult> {
  const result = await db.query(`
    SELECT id, last_success_at,
      EXTRACT(EPOCH FROM (NOW() - last_success_at)) / 3600 AS hours_since_success
    FROM data_sync_status
    WHERE last_success_at < NOW() - INTERVAL '25 hours'
      OR status = 'failed'
  `);

  if (result.rowCount === 0) {
    return { shouldCallLLM: false, reason: 'All data syncs fresh — no overdue syncs' };
  }

  return {
    shouldCallLLM: true,
    reason: `${result.rowCount} overdue data syncs`,
    context: `Overdue syncs:\n${result.rows.map((r: any) => `- ${r.id}: last success ${Math.round(r.hours_since_success)}h ago`).join('\n')}`,
  };
}

/**
 * Ops cost check pre-check.
 * Compares today's total cost against 7-day daily average.
 * Only calls LLM if deviation exceeds 30%.
 */
export async function opsCostPreCheck(db: Pool): Promise<PreCheckResult> {
  const result = await db.query(`
    WITH today AS (
      SELECT COALESCE(SUM(cost), 0) AS total
      FROM agent_runs
      WHERE created_at > CURRENT_DATE
    ),
    avg7d AS (
      SELECT COALESCE(AVG(daily_cost), 0) AS avg_cost FROM (
        SELECT DATE(created_at) AS d, SUM(cost) AS daily_cost
        FROM agent_runs
        WHERE created_at > CURRENT_DATE - INTERVAL '7 days'
          AND created_at < CURRENT_DATE
        GROUP BY DATE(created_at)
      ) sub
    )
    SELECT today.total, avg7d.avg_cost,
      CASE WHEN avg7d.avg_cost > 0
        THEN ((today.total - avg7d.avg_cost) / avg7d.avg_cost * 100)
        ELSE 0
      END AS deviation_pct
    FROM today, avg7d
  `);

  const row = result.rows[0];
  const deviation = Math.abs(parseFloat(row.deviation_pct) || 0);

  if (deviation < 30) {
    return {
      shouldCallLLM: false,
      reason: `Cost normal — today $${parseFloat(row.total).toFixed(2)} vs 7d avg $${parseFloat(row.avg_cost).toFixed(2)} (${deviation.toFixed(0)}% deviation)`,
    };
  }

  return {
    shouldCallLLM: true,
    reason: `Cost anomaly detected: ${deviation.toFixed(0)}% deviation`,
    context: `Today's cost: $${parseFloat(row.total).toFixed(2)}\n7-day daily average: $${parseFloat(row.avg_cost).toFixed(2)}\nDeviation: ${deviation.toFixed(0)}%`,
  };
}

/**
 * Support triage pre-check.
 * Skips if zero pending messages for the support-triage agent.
 */
export async function supportTriagePreCheck(db: Pool): Promise<PreCheckResult> {
  const result = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM agent_messages
    WHERE to_agent = 'support-triage'
      AND status = 'pending'
  `);

  const count = parseInt(result.rows[0].cnt, 10);
  if (count === 0) {
    return { shouldCallLLM: false, reason: 'No pending support messages to triage' };
  }

  return {
    shouldCallLLM: true,
    reason: `${count} pending support messages`,
    context: `You have ${count} pending support messages to triage.`,
  };
}

/**
 * CTO health check pre-check.
 * Skips if last completed health check was within 4 hours and found no issues.
 */
export async function ctoHealthPreCheck(db: Pool): Promise<PreCheckResult> {
  const result = await db.query(`
    SELECT id, created_at, output
    FROM agent_runs
    WHERE agent_role = 'cto'
      AND task = 'platform_health_check'
      AND status = 'completed'
      AND created_at > NOW() - INTERVAL '4 hours'
    ORDER BY created_at DESC
    LIMIT 1
  `);

  if (result.rowCount! > 0) {
    const lastOutput = (result.rows[0].output || '').toLowerCase();
    // If the last check found no issues, skip
    if (lastOutput.includes('healthy') || lastOutput.includes('no issues') || lastOutput.includes('all clear')) {
      return {
        shouldCallLLM: false,
        reason: `Last health check ${Math.round((Date.now() - new Date(result.rows[0].created_at).getTime()) / 60000)}min ago was clean`,
      };
    }
  }

  return { shouldCallLLM: true, reason: 'No recent clean health check — running full check' };
}

/**
 * CFO afternoon cost check pre-check.
 * Skips if no new financials data since the morning check.
 */
export async function cfoAfternoonPreCheck(db: Pool): Promise<PreCheckResult> {
  const result = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM financials
    WHERE created_at > CURRENT_DATE + INTERVAL '12 hours'
  `);

  const count = parseInt(result.rows[0].cnt, 10);
  if (count === 0) {
    return { shouldCallLLM: false, reason: 'No new financial data since morning check' };
  }

  return {
    shouldCallLLM: true,
    reason: `${count} new financial records since morning`,
    context: `${count} new records in financials table since noon today.`,
  };
}

/**
 * Registry of pre-check functions keyed by task name.
 * The work loop and heartbeat look up pre-checks from this map.
 */
export const PRE_CHECK_REGISTRY: Record<string, (db: Pool) => Promise<PreCheckResult>> = {
  'health_check':           opsHealthPreCheck,
  'freshness_check':        opsFreshnessPreCheck,
  'cost_check':             opsCostPreCheck,
  'triage_queue':           supportTriagePreCheck,
  'platform_health_check':  ctoHealthPreCheck,
  // CFO afternoon is task 'daily_cost_check' but only in the afternoon slot —
  // the runner can check the hour to decide whether to use cfoAfternoonPreCheck
};
```

### Acceptance criteria
- [ ] All 6 pre-check functions query real tables from the schema
- [ ] Each returns `{ shouldCallLLM: false }` when nothing is wrong
- [ ] Each returns `{ shouldCallLLM: true, context: '...' }` with diagnostic info when issues found
- [ ] `PRE_CHECK_REGISTRY` maps task names to pre-check functions
- [ ] TypeScript compiles: `npx tsc --noEmit`

---

## Issue 6 of 17: Wire Routing into Base Runner (Observation Mode)

**Branch:** `feature/agent-llm-optimization`
**Files:** 2 modified
**Depends on:** Issues 2, 3, 4, 5

This issue wires the routing infrastructure into the execution pipeline but **does NOT change model selection yet**. All runs still use gpt-5-mini. The router runs in observation mode — it infers capabilities, resolves what the model WOULD be, and logs the result to `agent_runs`. This lets you verify routing accuracy before flipping it on.

### Step 1: Modify `packages/agent-runtime/src/companyAgentRunner.ts`

Find the section after context tier resolution and before the first model call (approximately after `buildSystemPrompt()` and tool assembly). Add:

```typescript
// ━━━ ADD THESE IMPORTS at top of file ━━━
import { routeModel, type ModelConfig, type RoutingContext } from './routing';
import { PRE_CHECK_REGISTRY } from './cronPreCheck';

// ━━━ ADD AFTER context tier resolution + tool assembly ━━━
// (after this.contextTier is set, after this.tools Map is populated)

// Build routing context from data already available
const routingCtx: RoutingContext = {
  task: this.task,
  contextTier: this.contextTier,
  toolNames: Array.from(this.tools.keys()),
  department: this.agentProfile?.department ?? undefined,
  skillSlugs: this.skillContext?.skills?.map((s: any) => s.slug) ?? undefined,
  assignmentInstructions: this.currentAssignment?.task_description ?? undefined,
  toolCount: this.tools.size,
  // trustScore: await this.trustScorer?.getTrustScore(this.role),  // enable in Issue 15
};

// Route model (OBSERVATION MODE — log but don't apply)
const modelConfig = routeModel(routingCtx);

// Store for logging in trackedAgentExecutor
this.routingRule = modelConfig.matchedRule;
this.routingCapabilities = routingCtx.toolNames.length > 0
  ? Array.from(new Set([...Object.keys(modelConfig).filter(k => modelConfig[k as keyof ModelConfig] === true)]))
  : [];
this.routingModel = modelConfig.model;

// ═══ OBSERVATION MODE: Do NOT apply model selection yet ═══
// When ready to flip on (Issue 10), uncomment these lines:
// if (modelConfig.model !== '__deterministic__') {
//   this.model = modelConfig.model;
// }
// this.modelConfig = modelConfig;
```

### Step 2: Modify `packages/scheduler/src/server.ts` (or wherever `trackedAgentExecutor` lives)

Find `trackedAgentExecutor` and add the routing columns to the post-run UPDATE:

```typescript
// In the UPDATE agent_runs query after execution completes, add:
// (find the existing UPDATE statement and add these columns)

routing_rule = $N,
routing_capabilities = $M,
routing_model = $O,

// With values from the runner:
runner.routingRule,    // string
runner.routingCapabilities, // string[] (or null)
runner.routingModel,   // string
```

The exact integration depends on how `trackedAgentExecutor` passes data from the runner to the DB update. If `AgentExecutionResult` is returned from the runner, add these fields to that interface:

```typescript
// In the AgentExecutionResult type (packages/agent-runtime/src/types.ts or wherever defined):
export interface AgentExecutionResult {
  // ... existing fields ...
  routingRule?: string;
  routingCapabilities?: string[];
  routingModel?: string;
}
```

### Acceptance criteria
- [ ] Every agent run now logs `routing_rule`, `routing_capabilities`, `routing_model` to `agent_runs`
- [ ] Actual model used is still `gpt-5-mini-2025-08-07` for all runs (observation mode)
- [ ] Query: `SELECT routing_rule, routing_model, COUNT(*) FROM agent_runs WHERE routing_rule IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC` shows distribution
- [ ] No performance regression — routing inference adds <5ms per run
- [ ] Deploy and let run for 24 hours before proceeding to Issue 7

---

## Issue 7 of 17: Create Structured Output Schemas

**Branch:** `feature/agent-llm-optimization`
**Files:** 3 new
**Depends on:** Issue 6

### Step 1: Create `packages/agent-runtime/src/schemas/reflectionSchema.ts`

```typescript
/**
 * JSON Schema for agent post-run reflections.
 * Used with OpenAI structured outputs (response_format.json_schema)
 * and Anthropic structured outputs (output_config.format.json_schema).
 *
 * Guarantees 100% schema compliance via constrained decoding.
 * Eliminates JSON parse failures in reflection processing.
 */
export const REFLECTION_SCHEMA = {
  name: 'agent_reflection',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string' as const,
        description: 'One to two sentence summary of what happened in this run',
      },
      qualityScore: {
        type: 'integer' as const,
        description: 'Self-assessed quality score from 0 (failed) to 100 (perfect)',
      },
      whatWentWell: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'List of things that went well during this run',
      },
      whatCouldImprove: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'List of things that could be improved',
      },
      promptSuggestions: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Suggestions for improving the agent system prompt',
      },
      knowledgeGaps: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Knowledge areas where the agent lacked information',
      },
      memories: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            content: { type: 'string' as const },
            type: { type: 'string' as const, enum: ['observation', 'learning', 'preference', 'fact'] },
            importance: { type: 'string' as const, enum: ['low', 'medium', 'high'] },
          },
          required: ['content', 'type', 'importance'],
          additionalProperties: false,
        },
      },
      peerFeedback: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            toAgent: { type: 'string' as const, description: 'Role ID of the agent receiving feedback' },
            feedback: { type: 'string' as const },
            sentiment: { type: 'string' as const, enum: ['positive', 'neutral', 'negative'] },
          },
          required: ['toAgent', 'feedback', 'sentiment'],
          additionalProperties: false,
        },
      },
      graphOperations: {
        type: 'object' as const,
        properties: {
          nodes: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                title: { type: 'string' as const },
                nodeType: { type: 'string' as const, enum: ['event', 'fact', 'observation', 'pattern', 'decision', 'metric', 'entity', 'goal', 'risk', 'action', 'hypothesis'] },
                content: { type: 'string' as const },
                confidence: { type: 'number' as const },
              },
              required: ['title', 'nodeType', 'content'],
              additionalProperties: false,
            },
          },
          edges: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                sourceTitle: { type: 'string' as const },
                targetTitle: { type: 'string' as const },
                edgeType: { type: 'string' as const, enum: ['causes', 'precedes', 'relates_to', 'part_of', 'depends_on', 'created_by', 'assigned_to', 'measured_by', 'mitigates', 'enables'] },
                strength: { type: 'number' as const },
              },
              required: ['sourceTitle', 'targetTitle', 'edgeType'],
              additionalProperties: false,
            },
          },
        },
        required: ['nodes', 'edges'],
        additionalProperties: false,
      },
    },
    required: ['summary', 'qualityScore', 'whatWentWell', 'whatCouldImprove', 'memories', 'graphOperations'],
    additionalProperties: false,
  },
} as const;
```

### Step 2: Create `packages/agent-runtime/src/schemas/assignmentOutputSchema.ts`

```typescript
/**
 * JSON Schema for agent assignment output submissions.
 * Enforced when agents call submit_assignment_output.
 */
export const ASSIGNMENT_OUTPUT_SCHEMA = {
  name: 'assignment_output',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string' as const,
        enum: ['completed', 'partial', 'blocked'],
      },
      deliverable: {
        type: 'string' as const,
        description: 'The actual work output — the thing Sarah asked for',
      },
      keyFindings: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Key findings or results from the work',
      },
      blockers: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Any blockers encountered (empty if none)',
      },
      recommendations: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Recommendations for follow-up work',
      },
      toolsUsed: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Names of tools actually called during this task',
      },
      confidenceScore: {
        type: 'integer' as const,
        description: 'How confident the agent is in the output quality (0-100)',
      },
    },
    required: ['status', 'deliverable', 'confidenceScore'],
    additionalProperties: false,
  },
} as const;
```

### Step 3: Create `packages/agent-runtime/src/schemas/evaluationSchema.ts`

```typescript
/**
 * JSON Schema for Sarah's assignment evaluations.
 * Used when chief-of-staff evaluates submitted agent work.
 */
export const EVALUATION_SCHEMA = {
  name: 'assignment_evaluation',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      verdict: {
        type: 'string' as const,
        enum: ['accept', 'iterate', 'reassign', 'escalate'],
      },
      qualityScore: {
        type: 'integer' as const,
        description: 'Quality score for the submitted work (0-100)',
      },
      feedback: {
        type: 'string' as const,
        description: 'Detailed feedback on the submission',
      },
      revisionInstructions: {
        type: 'string' as const,
        description: 'Specific instructions for revision (only when verdict is iterate)',
      },
      reassignTo: {
        type: 'string' as const,
        description: 'Role ID to reassign to (only when verdict is reassign)',
      },
      escalationReason: {
        type: 'string' as const,
        description: 'Why this needs founder attention (only when verdict is escalate)',
      },
    },
    required: ['verdict', 'qualityScore', 'feedback'],
    additionalProperties: false,
  },
} as const;
```

### Acceptance criteria
- [ ] All 3 schema files compile with TypeScript
- [ ] Schemas are valid JSON Schema (test by passing to a JSON Schema validator)
- [ ] `REFLECTION_SCHEMA` covers all fields currently extracted from reflection responses
- [ ] `additionalProperties: false` and `strict: true` on all schemas

---

## Issues 8-17: Remaining Implementation

> **Note:** Issues 8-17 follow the same pattern. Each is a self-contained GitHub Issue with exact file paths, code, and acceptance criteria. Due to length, they are summarized below with enough detail for Copilot execution. Create full issue bodies following the pattern from Issues 1-7.

### Issue 8: Update OpenAI Provider — Reasoning Effort + Model Detection

**Files:** `packages/agent-runtime/src/providers/openai.ts`

**Instructions:**
1. Add `gpt-5.4` and `gpt-5-nano` to `detectProvider()` model prefix matching
2. Read `request.metadata?.modelConfig?.reasoningEffort` and add to Chat Completions request body as `reasoning_effort` parameter
3. Read `request.metadata?.modelConfig?.verbosity` and add structured outputs support
4. For now, keep ALL calls on Chat Completions (Responses API migration is Issue 12)

**Acceptance:** reasoning_effort appears in OpenAI API calls. Verify via API response `usage.output_tokens_details.reasoning_tokens` — should be lower for `low`/`minimal` efforts.

---

### Issue 9: Update Anthropic Provider — Effort + Adaptive Thinking + Citations + Compaction

**Files:** `packages/agent-runtime/src/providers/anthropic.ts`

**Instructions:**
1. Add `output_config: { effort: modelConfig.claudeEffort }` when claudeEffort is set
2. Add `thinking: { type: 'adaptive' }` when claudeThinking is 'adaptive'
3. Add `citations: { enabled: true }` when enableCitations is true
4. Add `compaction: 'auto'` when enableCompaction is true (replaces broken historyManager compression)
5. Add `output_config: { format: { type: 'json_schema', schema: ... } }` for structured outputs
6. Add explicit `cache_control: { type: 'ephemeral' }` breakpoints on system prompt content blocks

**Acceptance:** Claude calls include effort parameter. Citations appear in responses for legal/research tasks.

---

### Issue 10: Update Gemini Provider — Thinking Levels + Google Search + Code Execution

**Files:** `packages/agent-runtime/src/providers/gemini.ts`

**Instructions:**
1. Distinguish `gemini-3*` models (use `thinkingLevel: LOW|HIGH`) from `gemini-2.5*` (use `thinkingBudget`)
2. When `enableGoogleSearch`, push `{ googleSearch: {} }` into tools
3. When `enableCodeExecution`, push `{ codeExecution: {} }` into tools
4. Add `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview` to model detection
5. Remove `gemini-3-pro-preview` (deprecated March 9)
6. Add `response_mime_type: 'application/json'` + `response_schema` for structured outputs

**Acceptance:** Research agents calling Gemini get `googleSearch` tool. Finance agents get `codeExecution` tool.

---

### Issue 11: Flip Routing On — Apply Model Selection

**Files:** `packages/agent-runtime/src/companyAgentRunner.ts`

**Instructions:**
1. Uncomment the model application lines from Issue 6
2. When `modelConfig.model === '__deterministic__'`, check `PRE_CHECK_REGISTRY[this.task]` — if exists, run it. If `shouldCallLLM === false`, return early with the reason. If true, fall back to `gpt-5-mini` with `reasoningEffort: 'low'` and inject `preCheck.context` into the message
3. Apply `modelConfig.model` as `this.model`
4. Pass full `modelConfig` to model calls via metadata

**Acceptance:** `agent_runs.routing_model` matches the ACTUAL model used (not observation). Deterministic skips show `status = 'skipped_precheck'`. Different models appear for different task types.

---

### Issue 12: OpenAI Responses API Path for GPT-5.4

**Files:** `packages/agent-runtime/src/providers/openai.ts`

**Instructions:**
1. Add `generateViaResponses()` method alongside existing `generate()` (Chat Completions)
2. Route: if model starts with `gpt-5.4`, use Responses API. Otherwise Chat Completions.
3. Responses API supports: `reasoning.effort`, `text.verbosity`, `tools: [{ type: 'apply_patch' }]`, `tools: [{ type: 'tool_search' }]`, `tools: [{ type: 'code_interpreter' }]`, `tool_choice.allowed_tools`
4. Handle `apply_patch_call` responses — route to patch harness (Issue 14)
5. Handle `previous_response_id` for multi-turn Responses API flows
6. Update OpenAI SDK to latest version supporting Responses API

**Acceptance:** GPT-5.4 calls use Responses API. Tool Search reduces input tokens by ~47%. Apply Patch tool appears for code_generation tasks.

---

### Issue 13: MCP Server Filtering in Tool Loading

**Files:** `packages/agents/src/shared/agent365Tools.ts`, `packages/agents/src/shared/glyphorMcpTools.ts`, `packages/agent-runtime/src/companyAgentRunner.ts`

**Instructions:**
1. Modify `createAgent365McpTools(agentRole?, serverFilter?)` — change default from `ALL_M365_SERVERS` to requiring explicit server list. If no list passed, return empty array.
2. Modify `createGlyphorMcpTools(agentRole?, serverFilter?)` — same change.
3. In `companyAgentRunner.ts`, after routing, pass `modelConfig.a365McpServers` to `createAgent365McpTools()` and `modelConfig.glyphorMcpServers` to `createGlyphorMcpTools()`.
4. For gpt-5.4 calls, optionally build `modelConfig.nativeMcpServers` for native MCP (Responses API) and skip the bridge entirely.

**Acceptance:** Research analysts no longer load 60+ A365 tools. Tool count per agent drops 40-60%. Input tokens per call decrease measurably.

---

### Issue 14: Create Patch Harness for Apply Patch

**Files:** `packages/agents/src/shared/patchHarness.ts`, `packages/agents/src/shared/v4aDiff.ts`

**Instructions:**
1. Implement V4A diff parser that can apply diffs to file content
2. Implement `applyPatchToGitHub()` that reads current file from GitHub, applies diff, commits only changed content
3. Wire into `toolExecutor.ts` — when gpt-5.4 emits `apply_patch_call`, route to patch harness instead of normal tool execution
4. Return success/failure status back to Responses API for iteration

**Acceptance:** CTO and design team code edits use diffs instead of full file rewrites. Output tokens per code edit drop 60-80%.

---

### Issue 15: Wire Intelligence Layer

**Files:** `packages/agent-runtime/src/companyAgentRunner.ts`, `packages/agent-runtime/src/toolExecutor.ts`, `packages/agent-runtime/src/routing/inferCapabilities.ts`

**Instructions:**
1. Wire `formalVerifier.verifyBudgetConstraint()` into `toolExecutor.ts` before financial mutation tools
2. Wire trust score into `RoutingContext` — fetch from `trustScorer.getTrustScore(role)` before routing
3. Wire constitutional evaluation on executive runs — after agentic loop, before reflection
4. If constitutional compliance < 0.6, apply negative trust delta

**Acceptance:** Financial mutations blocked when budget exceeded. Low-trust agents get higher reasoning effort. Constitutional evaluations logged for executives.

---

### Issue 16: Reorder System Prompt for Cache Optimization

**Files:** `packages/agent-runtime/src/companyAgentRunner.ts`

**Instructions:**
1. Reorder `buildSystemPrompt()` blocks: static content first (Company KB, protocols), per-department second, per-role third, per-agent last, dynamic content (bulletins) at the end
2. This maximizes prefix cache hits across all 3 providers (OpenAI auto-cache 75%, Anthropic explicit 90%, Gemini implicit 90%)

**Acceptance:** Cache hit rates increase. Verify via OpenAI response `usage.prompt_tokens_details.cached_tokens` and Anthropic response headers.

---

### Issue 17: Dashboard Model Dropdown Update

**Files:** `packages/dashboard/src/lib/models.ts`

**Instructions:**
1. Add: `gpt-5.4`, `gpt-5.4-pro`, `gpt-5-nano`, `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite-preview`
2. Remove: `gemini-3-pro-preview` (deprecated March 9, 2026)
3. Update pricing data for all new models
4. Add routing info display to Activity page (read from `agent_runs.routing_rule`, `routing_model`, `routing_capabilities`)

**Acceptance:** New models appear in agent Settings dropdowns. Deprecated models removed. Activity page shows routing data.

---

## Verification Queries (Run After All Issues Complete)

```sql
-- 1. Model distribution
SELECT routing_model, COUNT(*), ROUND(AVG(cost)::numeric, 4) AS avg_cost
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '24 hours' AND routing_model IS NOT NULL
GROUP BY routing_model ORDER BY COUNT(*) DESC;

-- 2. Deterministic skips
SELECT COUNT(*) AS skipped_runs
FROM agent_runs
WHERE status = 'skipped_precheck' AND created_at > NOW() - INTERVAL '24 hours';

-- 3. Rule distribution
SELECT routing_rule, COUNT(*)
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '24 hours' AND routing_rule IS NOT NULL
GROUP BY routing_rule ORDER BY COUNT(*) DESC;

-- 4. Code gen on gpt-5.4
SELECT routing_model, COUNT(*)
FROM agent_runs
WHERE 'code_generation' = ANY(routing_capabilities) AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY routing_model;

-- 5. Total daily cost comparison
SELECT DATE(created_at), SUM(cost), COUNT(*)
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at) ORDER BY 1;

-- 6. Average input tokens before/after (tool bloat reduction)
SELECT routing_model, ROUND(AVG(input_tokens)) AS avg_input
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '24 hours' AND routing_model IS NOT NULL
GROUP BY routing_model ORDER BY avg_input DESC;
```
