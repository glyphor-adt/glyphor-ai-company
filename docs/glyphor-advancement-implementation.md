# Glyphor Platform Advancement — Implementation Guide

> Mapped to ARCHITECTURE.md as of 2026-03-12. Every recommendation references existing files, tables, packages, and patterns.

---

## Priority 1: Cross-Model Consensus for Agent Runs (Surgical Deployment)

**Goal:** Cross-model consensus currently lives only in Ora chat (user-initiated, user pays for it). The agent run loop has `reasoningEngine.ts` with a `cross_model` pass type available but it's not wired into the heartbeat cycle. The question isn't whether to add it — it's exactly which of the ~200+ daily agent runs actually benefit from it. Most don't.

### What exists today

- `reasoningEngine.ts` in `packages/agent-runtime/src/` — multi-pass verification with pass types: `self_critique`, `consistency_check`, `factual_verification`, `goal_alignment`, `cross_model`, `value_analysis`
- Verification models: `gpt-5.2-2025-12-11`, `claude-opus-4-6`, `gemini-3-flash-preview`
- `ReasoningResult` with `overallConfidence`, `passes[]`, `suggestions`
- Value gating already exists — outputs below confidence threshold can be blocked
- Redis cache at `reasoning:{hash}` for repeated queries
- Ora chat uses cross-model triangulation (Claude Opus primary, Gemini Pro + GPT validators, Claude Sonnet judge, Gemini Flash router) — this is a separate path and stays as-is
- Agent runs currently get NO cross-model verification in the heartbeat loop

### The verification tier policy

Not every task needs cross-model consensus. The system handles ~200+ runs daily across the heartbeat cycle. Firing cross-model on all of them would cost roughly 3x per verified run for negligible quality gain on routine work. The right ratio is approximately 15-20 runs per day qualifying for full cross-model — about 8-10% of total volume.

**Tier 0 — No verification (fast exit, cheapest)**

Skip the reasoning engine entirely. Pure execute-and-reflect.

Applies to:
- Heartbeat work loop P3-P6 (message reads, proactive work, nothing-to-do exits)
- `ops-health-check` (every 10 min), `ops-freshness-check` (every 30 min), `ops-cost-check` (hourly)
- `support-triage-recurring` (David Santos, every 2 hours — routing, not deciding)
- `social-media-morning` / `social-media-afternoon` (Kai Johnson — scheduling, not external-facing copy)
- `seo-analyst-daily`, `m365-admin-weekly-audit`, `m365-admin-user-audit`
- Any run where `turns <= 2` and no mutation tools were called (agent checked for work, found nothing meaningful)
- Inter-agent DM reads and meeting round contributions

**Tier 1 — Self-critique only (single-pass, default for most runs)**

The reasoning engine runs `self_critique` pass only — the agent's own model reviews its output against the original task. Catches obvious errors, costs ~$0.002 per run.

Applies to:
- All green-tier scheduled cron tasks (the bulk of daily runs)
- `cto-health-check`, `cfo-daily-costs`, `cfo-afternoon-costs`, `cpo-usage-analysis`
- `cmo-content-calendar` (planning, not publishing)
- Sub-team daily tasks: `platform-eng-daily`, `quality-eng-daily`, `devops-eng-daily`, `revenue-analyst-daily`, `cost-analyst-daily`, `content-creator-daily`, `account-research-daily`, `onboarding-daily`
- P2 work assignments that stay within green authority scope
- Research analyst individual outputs (Lena, Daniel, Kai, Amara, Riya, Marcus Chen) — their individual work gets verified when Sophia synthesizes

**Tier 2 — Full cross-model consensus (multi-provider verification)**

The reasoning engine runs `self_critique` + `cross_model` + `factual_verification`. A second model from a different provider evaluates the output. Costs ~$0.01-0.03 per run depending on output length.

Applies to:
- Red-tier decisions — non-negotiable, before they hit the decision queue
- Anything that exits the system: emails to clients via `mcp-email-server`, published content via `contentTools.ts` publish flow, external proposals from Rachel Kim / Nathan Cole / Ethan Morse
- Sarah's orchestration synthesis (Phase 4 SYNTHESIZE in `analysisEngine.ts`, `deepDiveEngine.ts`, `strategyLabEngine.ts`) — this is where individual research threads get merged and errors compound
- Strategic analyses, T+1 simulations, deep dives, Strategy Lab outputs, CoT analyses — all five engines in `packages/scheduler/src/`
- Financial projections containing specific numbers from Nadia (CFO), Anna Park (Revenue), Omar Hassan (Cost)
- All legal/compliance outputs from Victoria Chase (CLO), Bob Finley (Tax), Grace Hwang (Audit), Mariana Solis (Tax Strategy)
- Executive morning briefings (`cos-briefing-kristina`, `cos-briefing-andrew`) — but only when the briefing contains recommendations or flags anomalies, not routine status
- Sophia Lin's research packet synthesis via `merge_research_packet` — the QC/merge step, not the individual analyst runs

**Tier 2+ — Conditional escalation (self-critique that can upgrade to cross-model)**

For yellow-tier decisions and certain edge cases, start with self-critique and escalate based on signals.

Applies to:
- Yellow-tier decisions where the proposing agent has trust score ≥ 0.7 — start with self-critique, escalate only if confidence < 0.8
- Yellow-tier decisions where trust < 0.7 — go straight to full cross-model
- `cmo-afternoon-publishing` (Maya Brooks) — escalate if the output includes external-facing copy rather than just scheduling
- `vpcs-health-scoring` (James Turner) — escalate if churn risk flags are raised for high-value accounts
- `vps-pipeline-review` (Rachel Kim) — escalate if the output includes outreach recommendations

### What to build

**New file:** `packages/agent-runtime/src/verificationPolicy.ts`

This is simpler than a full "debate classifier" — it's a deterministic policy function, not a heuristic analyzer. About 30 lines of core logic.

```typescript
type VerificationTier = 'none' | 'self_critique' | 'cross_model' | 'conditional';

interface VerificationDecision {
  tier: VerificationTier;
  passes: string[];           // which reasoningEngine passes to run
  reason: string;             // human-readable explanation for audit log
}

function determineVerificationTier(context: {
  agentRole: string;
  taskSource: string;         // 'heartbeat' | 'cron' | 'wake' | 'on_demand' | 'a2a'
  workLoopPriority: string;   // 'P1' | 'P2' | ... | 'P6'
  authorityTier: string;      // 'green' | 'yellow' | 'red'
  trustScore: number;         // from agent_trust_scores
  turnsUsed: number;
  mutationToolsCalled: string[];  // from actionReceipts
  hasExternalOutput: boolean;     // email, publish, proposal tools in receipt
  engineSource?: string;      // 'analysis' | 'simulation' | 'deep_dive' | 'strategy_lab' | 'cot'
}): VerificationDecision
```

**Decision logic (pure conditionals, no LLM, no heuristics):**

```typescript
// Tier 0: No verification
if (workLoopPriority >= 'P3' && !hasExternalOutput) return { tier: 'none', passes: [], reason: 'low-priority internal work' };
if (turnsUsed <= 2 && mutationToolsCalled.length === 0) return { tier: 'none', passes: [], reason: 'no-op run' };
if (TIER_0_CRONS.includes(cronJobId)) return { tier: 'none', passes: [], reason: 'routine monitoring cron' };

// Tier 2: Always cross-model
if (authorityTier === 'red') return { tier: 'cross_model', passes: ['self_critique', 'cross_model', 'factual_verification'], reason: 'red-tier decision' };
if (hasExternalOutput) return { tier: 'cross_model', passes: ['self_critique', 'cross_model'], reason: 'external-facing output' };
if (engineSource) return { tier: 'cross_model', passes: ['self_critique', 'cross_model', 'factual_verification'], reason: `${engineSource} engine output` };
if (FINANCIAL_LEGAL_ROLES.includes(agentRole) && hasNumericClaims(output)) return { tier: 'cross_model', passes: ['self_critique', 'cross_model', 'factual_verification'], reason: 'financial/legal with numeric claims' };

// Tier 2+: Conditional
if (authorityTier === 'yellow' && trustScore < 0.7) return { tier: 'cross_model', passes: ['self_critique', 'cross_model'], reason: 'yellow-tier, low trust' };
if (authorityTier === 'yellow' && trustScore >= 0.7) return { tier: 'conditional', passes: ['self_critique'], reason: 'yellow-tier, high trust — escalate if low confidence' };

// Tier 1: Default
return { tier: 'self_critique', passes: ['self_critique'], reason: 'standard green-tier work' };
```

**Role and cron classification constants:**

```typescript
const TIER_0_CRONS = [
  'ops-health-check', 'ops-freshness-check', 'ops-cost-check',
  'ops-morning-status', 'ops-evening-status',
  'support-triage-recurring', 'social-media-morning', 'social-media-afternoon',
  'seo-analyst-daily', 'm365-admin-weekly-audit', 'm365-admin-user-audit',
];

const FINANCIAL_LEGAL_ROLES = [
  'cfo', 'clo', 'revenue-analyst', 'cost-analyst',
  'bob-the-tax-pro', 'tax-strategy-specialist', 'data-integrity-auditor',
];

const EXTERNAL_OUTPUT_TOOLS = [
  'send_email', 'reply_to_email',        // mcp-email-server
  'publish_content', 'schedule_publish',  // contentTools.ts
  'send_proposal',                        // sales tools
  'publish_deliverable',                  // deliverableTools.ts
];
```

**Integration point in `baseAgentRunner.ts`:**

Insert after the model call loop completes (between current step 8 and step 9):

```typescript
// Step 8.5: VERIFICATION POLICY (new)
const verificationDecision = determineVerificationTier({
  agentRole: this.role,
  taskSource: runContext.source,
  workLoopPriority: runContext.workLoopPriority,
  authorityTier: getAuthorityTier(this.role, proposedActions),
  trustScore: await trustScorer.getScore(this.role),
  turnsUsed: turnCount,
  mutationToolsCalled: actionReceipts.filter(r => r.success).map(r => r.toolName),
  hasExternalOutput: actionReceipts.some(r => EXTERNAL_OUTPUT_TOOLS.includes(r.toolName)),
  engineSource: runContext.engineSource,
});

if (verificationDecision.tier !== 'none') {
  const reasoningResult = await reasoningEngine.verify(agentOutput, {
    passes: verificationDecision.passes,
  });

  // Conditional tier: escalate if self-critique confidence is low
  if (verificationDecision.tier === 'conditional' && reasoningResult.overallConfidence < 0.8) {
    const fullResult = await reasoningEngine.verify(agentOutput, {
      passes: ['self_critique', 'cross_model'],
    });
    // Use fullResult instead
  }
}
```

**For engine outputs** (`analysisEngine.ts`, `simulationEngine.ts`, `deepDiveEngine.ts`, `strategyLabEngine.ts`, `cotEngine.ts`):

These engines run temporary agents for research threads and then synthesize. The individual research threads get Tier 1 (self-critique). The synthesis step gets Tier 2 (cross-model). Add the `engineSource` flag when the synthesis phase calls the model:

```typescript
// In analysisEngine.ts Phase 4 SYNTHESIZE:
const synthesisResult = await runner.run({
  ...synthesisConfig,
  engineSource: 'analysis',  // signals verificationPolicy to use Tier 2
});
```

Same pattern for all five engines.

**Logging:** Add `verification_tier` and `verification_reason` columns to `agent_runs`. Track on the Financials dashboard: verification tier distribution pie chart, cost breakdown by tier, and trending over time.

**Expected volume:** Out of ~200+ daily runs, approximately 150-160 get Tier 0 (no verification), 25-35 get Tier 1 (self-critique only, ~$0.002 each), and 15-20 get Tier 2 (cross-model, ~$0.01-0.03 each). Total daily verification cost: roughly $0.35-0.90 — a fraction of what blanket cross-model would cost (~$4-6/day).

### Database migration

```sql
ALTER TABLE agent_runs 
  ADD COLUMN verification_tier TEXT,         -- 'none', 'self_critique', 'cross_model', 'conditional'
  ADD COLUMN verification_reason TEXT,       -- human-readable reason from policy
  ADD COLUMN verification_passes TEXT[];     -- which passes were actually run
```

---

## Priority 2: A2A Protocol — External Agent Interoperability

**Goal:** Expose Glyphor agents as A2A-compatible services so external agent ecosystems can discover and delegate work to them. This is a distribution moat.

### What exists today

- 10 MCP servers already running (`mcp-data-server`, `mcp-marketing-server`, `mcp-engineering-server`, `mcp-design-server`, `mcp-finance-server`, `mcp-email-server`, `mcp-legal-server`, `mcp-hr-server`, `mcp-email-marketing-server`, `mcp-slack-server`)
- `glyphorMcpTools.ts` bridges agents to MCP servers via JSON-RPC 2.0
- `agent365Tools.ts` bridges Microsoft MCP tool schemas
- `dynamicToolExecutor.ts` can execute API-type tools at runtime
- Worker service (`glyphor-worker`) already handles async agent execution via Cloud Tasks queues

### What to build

**New package:** `packages/a2a-gateway/` — A2A protocol gateway as a Cloud Run service

A2A requires three things:

**1. Agent Cards (capability manifests)**

Each of your 44 agents needs an Agent Card — a JSON document describing what the agent can do, exposed at a well-known endpoint. This maps directly to your existing `company_agents` table + `role_rubrics` + `skills` + `agent_skills` tables.

**New file:** `packages/a2a-gateway/src/agentCards.ts`

```typescript
interface AgentCard {
  name: string;           // e.g. "Sarah Chen - Chief of Staff"
  description: string;    // from company_agents.personality_summary
  url: string;            // https://a2a.glyphor.ai/agents/{agent-id}
  skills: AgentSkill[];   // from skills + agent_skills join
  authentication: {
    schemes: string[];    // ["bearer"]
  };
  defaultInputModes: string[];   // ["text"]
  defaultOutputModes: string[];  // ["text"]
}
```

Generate cards dynamically from your existing DB tables — `company_agents` for identity, `skills` + `agent_skills` for capabilities, `role_rubrics` for quality standards. Serve at `GET /.well-known/agent.json` per the A2A spec.

**2. Task lifecycle endpoints**

A2A defines a task lifecycle: `submitted` → `working` → `completed` (or `failed`). This maps almost exactly to your existing `work_assignments` table statuses: `pending` → `in_progress` → `completed`.

**New file:** `packages/a2a-gateway/src/taskHandler.ts`

Route incoming A2A task requests through Sarah's orchestration loop:

```
External A2A client → POST /tasks/send
  → Validate auth (bearer token, rate limit)
  → Create founder_directive (type: 'external_a2a')
  → Sarah decomposes via existing orchestration loop
  → Poll work_assignments for status
  → Stream progress via SSE (tasks/sendSubscribe)
  → Return completed output as A2A artifact
```

**3. Discovery endpoint**

```
GET /.well-known/agent.json → returns top-level Agent Card for Glyphor
GET /agents → returns array of all 44 agent cards
GET /agents/{id} → returns specific agent card
POST /tasks/send → submit a task
GET /tasks/{id} → get task status
POST /tasks/sendSubscribe → SSE stream for task progress
```

**Integration with existing infrastructure:**

- Auth: Extend your existing JWT validation in `bot.ts` to support A2A bearer tokens. Create a new `a2a_api_keys` table for client API key management.
- Rate limiting: Reuse your existing pattern from `eventPermissions.ts` — add a `a2a_rate_limits` config.
- Billing: Each A2A task should create an `agent_runs` record with `source: 'a2a'` so your existing cost tracking in `agent_runs` captures external work.
- Authority: External A2A tasks should default to `yellow` tier (require one founder approval) until the client is trusted. Add `a2a_client_trust` table.

**New Cloud Run service:** `glyphor-a2a-gateway`

- Dockerfile: `docker/Dockerfile.a2a-gateway`
- Endpoint: `https://a2a.glyphor.ai`
- Add to CI/CD pipeline in `.github/workflows/deploy.yml`

### Database migration

```sql
CREATE TABLE a2a_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  trust_level TEXT DEFAULT 'untrusted',  -- untrusted, basic, trusted
  rate_limit_per_hour INT DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE a2a_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES a2a_clients(id),
  directive_id UUID REFERENCES founder_directives(id),
  status TEXT DEFAULT 'submitted',  -- submitted, working, completed, failed
  input JSONB NOT NULL,
  output JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

**Reverse direction (Glyphor agents discovering external A2A agents):**

Add a new tool to `coreTools.ts`:

```typescript
{
  name: 'discover_external_agents',
  description: 'Discover and delegate tasks to external A2A-compatible agents',
  parameters: {
    query: { type: 'string', description: 'What capability are you looking for?' },
    registry_url: { type: 'string', description: 'A2A registry URL to search' }
  }
}
```

This lets Sarah discover a client's internal agents and delegate subtasks to them — the reverse integration that no competitor offers.

---

## Priority 3: Self-Evolution Engine (Skill Library + Inter-Agent Transfer)

**Goal:** Agents that actively improve by extracting successful procedures into reusable skills and sharing them across the organization.

### What exists today

- `skills` table + `agent_skills` table (10 skill categories, proficiency tracking)
- `shared_procedures` table in `sharedMemoryLoader.ts` (L4: Procedural memory)
- `shared_episodes` table with `significance_score`
- `episodicReplay.ts` — runs every 2 hours, does pattern analysis
- `worldModelUpdater.ts` — REFLECT→LEARN→IMPROVE loop
- `agent_reflections` table with `whatWentWell[]`, `whatCouldImprove[]`, `knowledgeGaps[]`
- `skillFeedbackWriter` updates proficiency from reflections
- `agent_world_model` with self-assessment scores

### What to build

**Phase 1: Automatic skill extraction from successful runs**

**New file:** `packages/agent-runtime/src/skillExtractor.ts`

After a run completes with quality score ≥ 80 (from the reflection in step 9 of the run loop), analyze the tool call sequence to identify extractable procedures:

```typescript
interface ExtractedSkill {
  name: string;
  description: string;
  category: string;           // maps to existing 10 skill categories
  toolSequence: string[];     // ordered list of tools used
  contextPatterns: string[];  // what kind of task triggers this sequence
  successRate: number;        // from historical agent_runs data
  sourceAgent: string;        // who discovered this
  sourceRunIds: string[];     // provenance
}
```

**Integration point:** Add to the post-run flow in `baseAgentRunner.ts`, after step 9 (REFLECTION) and step 11 (WORLD MODEL SELF-ASSESSMENT):

```
Step 12: SKILL EXTRACTION (new)
  → Only runs if qualityScore ≥ 80 AND turns ≤ 5 (efficient + high quality)
  → Analyze actionReceipts[] for repeatable tool sequences
  → Check if sequence matches an existing skill in skills table
  → If new: INSERT into skills + proposed_skills (pending review)
  → If existing: UPDATE proficiency evidence + usage_count
  → Emit skill.discovered event on GlyphorEventBus
```

**Phase 2: Cross-agent skill recommendation**

**Modify:** `jitContextRetriever.ts` — when assembling context for a task, also query `skills` + `agent_skills` for skills that match the task embedding but are assigned to OTHER agents:

```typescript
// In jitContextRetriever.ts, add a new parallel query:
const transferableSkills = await db.query(`
  SELECT s.*, as2.proficiency, as2.agent_role as source_agent
  FROM skills s
  JOIN agent_skills as2 ON s.id = as2.skill_id
  WHERE as2.proficiency >= 0.7
    AND as2.agent_role != $1
    AND s.embedding <-> $2 < 0.5
  ORDER BY as2.proficiency DESC
  LIMIT 3
`, [currentAgentRole, taskEmbedding]);
```

Inject these as "Recommended procedures from colleagues" in the agent's context window. This is the organizational learning layer — when the research team develops a strong data-gathering skill, the finance team can benefit.

**Phase 3: Automatic rubric evolution**

**New file:** `packages/agent-runtime/src/rubricEvolver.ts`

Run weekly (add to `cronManager.ts`). Analyzes correlation between rubric dimension scores and downstream outcomes:

```
For each role_rubric dimension:
  → Query agent_reflections for last 30 days
  → Correlate dimension score with overall qualityScore
  → Identify dimensions with < 0.2 correlation (noise — candidate for pruning)
  → Identify implicit patterns in whatWentWell[] that aren't captured by rubrics
  → Propose rubric amendments (similar to constitutional amendments flow)
  → Store in proposed_rubric_amendments table
  → Route to founder for approval
```

### Database migration

```sql
CREATE TABLE proposed_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_data JSONB NOT NULL,
  source_agent TEXT NOT NULL,
  source_run_ids TEXT[] NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending, approved, rejected
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE skills ADD COLUMN usage_count INT DEFAULT 0;
ALTER TABLE skills ADD COLUMN last_used_at TIMESTAMPTZ;
ALTER TABLE skills ADD COLUMN discovery_source TEXT;  -- 'manual', 'auto_extracted'

CREATE TABLE proposed_rubric_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  amendment_type TEXT NOT NULL,  -- 'add_dimension', 'remove_dimension', 'modify_weight'
  details JSONB NOT NULL,
  evidence JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Priority 4: Adversarial Security Layer

**Goal:** Protect the multi-agent attack surface before it becomes a liability.

### What exists today

- `driftDetector.ts` — behavioral drift detection every 6 hours (2σ threshold)
- `trustScorer.ts` — 9-signal trust scoring with automatic demotion
- `constitutionalGovernor.ts` — per-agent constitutional governance
- `formalVerifier.ts` — deterministic pre-execution checks
- `eventPermissions.ts` — tiered event emission permissions
- `toolExecutor.ts` — grant-based tool access control
- Rate limiting on events (10/hr), messages (5/hr), meetings (2/day)
- `platform_audit_log` for structured audit logging

### What to build

**1. Agent behavioral fingerprinting**

**New file:** `packages/agent-runtime/src/behavioralFingerprint.ts`

Build baseline behavior profiles from `agent_runs` + `agent_tool_grants` usage patterns:

```typescript
interface BehaviorProfile {
  agentRole: string;
  normalToolPatterns: Map<string, number>;    // tool → avg calls per run
  normalKGAccessPatterns: string[];           // kg_node categories accessed
  normalMessageTargets: string[];             // who this agent normally messages
  normalBudgetRange: [number, number];        // min/max cost per run
  normalTurnRange: [number, number];          // min/max turns per run
  baselinePeriod: string;                     // "30 days"
}
```

On each run, compare current behavior against the profile. Flag anomalies:

- Agent accessing KG nodes outside its normal domain (CMO querying financial data)
- Agent messaging agents outside its reporting chain
- Tool call sequence that's never been observed before
- Cost per run > 3x historical average

**Integration:** Add check in `toolExecutor.ts` before executing sensitive tools. Log anomalies to a new `security_anomalies` table. High-severity anomalies emit `alert.triggered` (critical) which already wakes CTO + ops + CoS via wake rules.

**2. Knowledge compartmentalization**

**Modify:** `jitContextRetriever.ts` + `graphReader.ts`

Add a `knowledge_access_scope` column to `company_agents` table. Define which KG node categories each agent can access:

```typescript
const KNOWLEDGE_SCOPES: Record<string, string[]> = {
  'cfo':          ['financial', 'revenue', 'costs', 'billing', 'general'],
  'cto':          ['engineering', 'infrastructure', 'security', 'general'],
  'cmo':          ['marketing', 'content', 'brand', 'general'],
  'clo':          ['legal', 'compliance', 'contracts', 'general'],
  // sub-team agents inherit their executive's scope
};
```

In `graphReader.ts`, add a scope filter to all queries:

```sql
-- Add to semantic search in graphReader
AND (n.category = ANY($scopeArray) OR n.category = 'general')
```

**3. Cross-agent tool verification for high-stakes actions**

**Modify:** `toolExecutor.ts`

For tools in the `red` authority tier (or mutations affecting financial data, external communications), require a verification step from a second agent:

```typescript
// In toolExecutor.ts, after authority gate check:
if (authorityTier === 'red' || isHighStakesTool(toolName)) {
  const verificationResult = await verifierRunner.verifyToolCall({
    requestingAgent: agentRole,
    toolName,
    params,
    context: taskDescription,
    // Use a different model family than the requesting agent
  });
  
  if (verificationResult.verdict === 'BLOCK') {
    return { error: `Tool call blocked by verification: ${verificationResult.reason}` };
  }
}
```

This extends your existing `verifierRunner.ts` dual-track verification to cover tool execution, not just content generation.

### Database migration

```sql
CREATE TABLE security_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,  -- 'unusual_tool', 'unusual_kg_access', 'unusual_message_target', 'cost_spike'
  severity TEXT NOT NULL,       -- 'low', 'medium', 'high', 'critical'
  details JSONB NOT NULL,
  run_id UUID REFERENCES agent_runs(id),
  acknowledged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE company_agents ADD COLUMN knowledge_access_scope TEXT[] DEFAULT '{general}';
```

---

## Priority 5: Economic Intelligence — Dynamic Model Routing Per Subtask

**Goal:** Within a single agent run, route different subtasks to different models based on complexity.

### What exists today

- `modelClient.ts` with `detectProvider()` routing and `ProviderFactory` singleton adapters
- Per-agent model override via dashboard Settings tab
- Runtime routing that overrides stored model based on capabilities and trust score
- `AGENT_BUDGETS` with per-run, daily, monthly caps
- `agent_runs.model` records which model was used
- Cost tiers: Economy ($0.25/1M), Standard ($0.30/1M), Pro ($0.50/1M)

### What to build

**New file:** `packages/agent-runtime/src/subtaskRouter.ts`

The idea: the reasoning engine's initial task classification (from `jitContextRetriever.ts`) should determine model selection, not the agent's default model.

```typescript
interface SubtaskClassification {
  complexity: 'trivial' | 'standard' | 'complex' | 'frontier';
  requiresReasoning: boolean;
  requiresCreativity: boolean;
  requiresFactualGrounding: boolean;
  estimatedTokens: number;
}

const MODEL_ROUTING: Record<string, string> = {
  'trivial':   'gpt-5-nano',           // cheapest, fastest
  'standard':  'gpt-5-mini-2025-08-07', // current default
  'complex':   'gemini-3-flash-preview', // strong reasoning
  'frontier':  'claude-opus-4-6',        // highest quality
};
```

**Integration:** Modify `baseAgentRunner.ts` to call the subtask router before each model call in the loop:

```typescript
// Before each modelClient.generate() call in the run loop:
const classification = subtaskRouter.classify(
  currentTurnContext,
  toolCallHistory,
  agentRole
);
const effectiveModel = subtaskRouter.selectModel(classification, agentBudget);
```

**Cost-per-quality dashboards:**

**Modify:** `packages/dashboard/src/pages/Financials.tsx`

Add a new panel that correlates `agent_runs.cost` with `agent_reflections.qualityScore`:

```typescript
// New chart: Quality Score vs Cost Per Run (scatter plot)
// X-axis: cost per run (from agent_runs)
// Y-axis: quality score (from agent_reflections)
// Color: by agent role
// This reveals which agents are efficient (high quality, low cost)
// and which are burning tokens for mediocre output
```

Also add aggregate metrics: cost-per-quality-point by agent, by department, trending over time.

### Database migration

```sql
ALTER TABLE agent_runs ADD COLUMN model_routing_reason TEXT;
ALTER TABLE agent_runs ADD COLUMN subtask_complexity TEXT;
```

---

## Priority 6: T+1 Simulation Framework Formalization

**Goal:** Package the existing simulation engine into a named, explainable framework with dashboard visualizations.

### What exists today

- `simulationEngine.ts` in `packages/scheduler/src/` — T+1 impact simulation engine
- Endpoints: `POST /simulation/run`, `GET /simulation/:id`, `POST /simulation/:id/accept`, `GET /simulation/:id/export`
- `simulations` table in the database
- `Strategy.tsx` renders simulation results

### What to build

**Name it "Cascade Analysis"** — more intuitive than "T+1 simulation" for enterprise buyers.

**1. Visual before/after state comparison**

**Modify:** `packages/dashboard/src/pages/Strategy.tsx`

Add a "Cascade Map" visualization when viewing simulation results:

```
[Current State]  →  [Proposed Action]  →  [Predicted State T+1]
                                              │
                          ┌───────────────────┼───────────────────┐
                          │                   │                   │
                    [Engineering]       [Finance]           [Customer Success]
                    Impact: +15%        Impact: -$2K/mo     Impact: Neutral
                    Confidence: 0.8     Confidence: 0.9     Confidence: 0.6
```

Use the existing `kg_edges` with `causal_confidence`, `causal_lag`, and `causal_mechanism` (from the Counterfactual Causal Reasoning extension) to trace the cascade paths.

**2. Decision journal with accuracy tracking**

**New table:** Track what simulations predicted vs what actually happened.

```sql
CREATE TABLE cascade_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID REFERENCES simulations(id),
  prediction_type TEXT NOT NULL,     -- 'metric_change', 'risk_event', 'team_impact'
  predicted_value JSONB NOT NULL,
  actual_value JSONB,
  accuracy_score NUMERIC(3,2),       -- 0-1, computed after outcome observed
  outcome_observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Add a scheduled job (weekly) that checks whether simulation predictions from 7/14/30 days ago came true. Feed accuracy scores back into the `agent_world_model` for the agents involved.

**3. Automatic cascade triggering**

Wire cascade analysis into the `authorityGates.ts` flow for `yellow` and `red` tier decisions:

```typescript
// In authorityGates.ts, when a yellow/red decision is filed:
if (tier === 'yellow' || tier === 'red') {
  // Auto-run a lightweight cascade analysis
  const cascadeResult = await simulationEngine.runQuick({
    action: proposedAction,
    depth: 'lightweight',  // 1 department hop, not full org
    timeout: 30000
  });
  
  // Attach cascade preview to the decision card in Teams
  decision.cascade_preview = cascadeResult.summary;
}
```

This means every decision that requires founder approval automatically comes with a "here's what the system thinks will happen" preview — a powerful trust-building mechanism.

---

## Priority 7: Agent SDK for Client-Side Extension

**Goal:** Let clients add their own domain-specific agents into the Glyphor hierarchy.

### What exists today

- `agentLifecycle.ts` — create/retire temporary agents (used by analysis engine)
- `agentCreationTools.ts` — `create_specialist_agent` (max 3, 7d TTL)
- `runDynamicAgent.ts` — runner for DB-defined agents (no file-based runner needed)
- `agent_briefs` table for DB-stored role briefs
- `agent_schedules` table for DB-driven cron
- Dynamic tool executor can run API-type tools registered in `tool_registry`

### What to build

**New package:** `packages/agent-sdk/`

The SDK wraps the existing `runDynamicAgent.ts` + `agentCreationTools.ts` + `agent_briefs` patterns into a client-facing API:

```typescript
// Client-side usage:
const agent = await glyphor.createAgent({
  name: 'Industry Compliance Monitor',
  role: 'compliance-monitor',
  department: 'Legal',
  reportsTo: 'clo',               // Victoria Chase
  personality: {
    tone: 'precise',
    expertise: ['FDA regulations', 'medical device compliance'],
  },
  tools: [
    { name: 'fda_database_lookup', type: 'api', config: { url: '...' } }
  ],
  schedule: '0 8 * * 1-5',         // weekday mornings
  brief: `Monitor FDA regulatory changes affecting our product line...`,
  authorityScope: 'green',          // can only take green-tier actions
  ttl: null,                        // permanent (vs 7d TTL for temp agents)
});
```

Under the hood, this calls:

1. `POST /agents/create` → creates `company_agents` row
2. `INSERT agent_briefs` with the client's brief
3. `INSERT agent_schedules` for the cron
4. Register client's custom tools in `tool_registry`
5. Sarah automatically discovers the new agent via the heartbeat cycle
6. The agent runs via `runDynamicAgent.ts` — no code deploy needed

**Key constraints:**

- Client-created agents inherit the `authorityScope` of their reporting executive (can't exceed it)
- Client-created agents are isolated to the client's tenant (use existing row-level security)
- Maximum 10 client-created agents per tenant (configurable)
- All client agent runs are logged in `agent_runs` with `source: 'client_sdk'`

This turns Glyphor from a product into a platform — the equivalent of the App Store for organizational intelligence.

---

## Implementation Sequencing

| Phase | Work | Timeline | Impact |
|-------|------|----------|--------|
| **1** | Cross-model consensus verification policy + wiring into agent run loop | 1-2 weeks | Surgical quality improvement on high-stakes runs, zero cost on routine work |
| **2** | Dynamic model routing per subtask | 1 week | Further cost optimization, better quality matching |
| **3** | Behavioral fingerprinting + knowledge compartmentalization | 2 weeks | Security hardening before any external exposure |
| **4** | A2A gateway (Agent Cards + task lifecycle) | 3-4 weeks | Distribution moat, enterprise integration story |
| **5** | Skill extraction + cross-agent transfer | 2-3 weeks | Compounding organizational learning |
| **6** | Cascade Analysis formalization + prediction tracking | 2 weeks | Sales weapon, trust-building for enterprise |
| **7** | Agent SDK | 3-4 weeks | Platform play, requires A2A to be stable first |

**Parallel track:** T+1 Cascade Analysis naming/packaging can happen alongside Phase 1-2 as a positioning/content exercise. The whitepaper writes itself from your existing `simulationEngine.ts` capabilities.

---

## Files Modified (Summary)

| Existing File | Modification |
|--------------|-------------|
| `packages/agent-runtime/src/baseAgentRunner.ts` | Add verification policy check (step 8.5) before reasoning engine; add skill extraction in post-run; add behavioral fingerprint check |
| `packages/agent-runtime/src/reasoningEngine.ts` | Accept pass-type filtering from verification policy |
| `packages/agent-runtime/src/jitContextRetriever.ts` | Add cross-agent skill recommendation query; add knowledge scope filtering |
| `packages/agent-runtime/src/toolExecutor.ts` | Add cross-agent verification for red-tier tool calls; add behavioral anomaly detection |
| `packages/agent-runtime/src/modelClient.ts` | Support per-turn model override from subtask router |
| `packages/company-memory/src/graphReader.ts` | Add knowledge scope filter to all queries |
| `packages/scheduler/src/authorityGates.ts` | Auto-trigger cascade analysis for yellow/red decisions |
| `packages/scheduler/src/simulationEngine.ts` | Add `runQuick()` lightweight mode |
| `packages/scheduler/src/analysisEngine.ts` | Pass `engineSource: 'analysis'` in Phase 4 SYNTHESIZE for Tier 2 verification |
| `packages/scheduler/src/deepDiveEngine.ts` | Pass `engineSource: 'deep_dive'` in synthesis phase for Tier 2 verification |
| `packages/scheduler/src/strategyLabEngine.ts` | Pass `engineSource: 'strategy_lab'` in synthesis phase for Tier 2 verification |
| `packages/scheduler/src/cotEngine.ts` | Pass `engineSource: 'cot'` in synthesis phase for Tier 2 verification |
| `packages/scheduler/src/cronManager.ts` | Add rubric evolution weekly job; add prediction accuracy checker |
| `packages/dashboard/src/pages/Financials.tsx` | Add cost-per-quality scatter chart; add verification tier distribution + cost breakdown panel |
| `packages/dashboard/src/pages/Strategy.tsx` | Add Cascade Map visualization |
| `packages/agents/src/shared/coreTools.ts` | Add `discover_external_agents` tool |

## New Files

| File | Purpose |
|------|---------|
| `packages/agent-runtime/src/verificationPolicy.ts` | Deterministic verification tier policy (none / self_critique / cross_model / conditional) |
| `packages/agent-runtime/src/subtaskRouter.ts` | Per-subtask model routing |
| `packages/agent-runtime/src/skillExtractor.ts` | Auto-extract skills from successful runs |
| `packages/agent-runtime/src/behavioralFingerprint.ts` | Agent behavior baseline + anomaly detection |
| `packages/agent-runtime/src/rubricEvolver.ts` | Automatic rubric dimension analysis |
| `packages/a2a-gateway/src/server.ts` | A2A protocol gateway HTTP server |
| `packages/a2a-gateway/src/agentCards.ts` | Agent Card generation from DB |
| `packages/a2a-gateway/src/taskHandler.ts` | A2A task lifecycle management |
| `packages/agent-sdk/src/index.ts` | Client-facing agent creation SDK |
| `docker/Dockerfile.a2a-gateway` | A2A gateway container |

## New Database Tables

| Table | Purpose |
|-------|---------|
| `a2a_clients` | External A2A client registration |
| `a2a_tasks` | External task tracking |
| `security_anomalies` | Behavioral anomaly logging |
| `proposed_skills` | Auto-extracted skill proposals |
| `proposed_rubric_amendments` | Rubric evolution proposals |
| `cascade_predictions` | Simulation prediction tracking |

## Altered Tables

| Table | Changes |
|-------|---------|
| `agent_runs` | +`verification_tier`, +`verification_reason`, +`verification_passes`, +`model_routing_reason`, +`subtask_complexity` |
| `company_agents` | +`knowledge_access_scope` |
| `skills` | +`usage_count`, +`last_used_at`, +`discovery_source` |
