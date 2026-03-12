# GLYPHOR ADVANCEMENT IMPLEMENTATION ANALYSIS

## EXECUTIVE SUMMARY

The implementation spec (glyphor-advancement-implementation.md) outlines **7 distinct priorities** with an explicit sequencing plan. The document recommends **starting with a smaller subset** due to dependencies and risk considerations. Priorities 1-2 should precede 3-4, and A2A (Priority 2) must be stable before SDK (Priority 7).

### Key Finding: NOT a parallel implementation
The document explicitly states a phased approach with clear dependencies, though some work can happen in parallel tracks:
- **Phase 1 (1-2 weeks)**: Priority 1 (Cross-model consensus verification policy)
- **Phase 2 (1 week)**: Priority 5 (Subtask model routing)  
- **Phase 3 (2 weeks)**: Priority 4 (Security hardening)
- **Phase 4 (3-4 weeks)**: Priority 2 (A2A gateway)
- **Phase 5 (2-3 weeks)**: Priority 3 (Skill extraction)
- **Phase 6 (2 weeks)**: Priority 6 (Cascade Analysis)
- **Phase 7 (3-4 weeks)**: Priority 7 (Agent SDK) — *requires Phase 4 stable*

---

## QUESTION 1: SEQUENCING RECOMMENDATION

**Answer**: YES, explicit sequencing. The doc (lines 769-781) provides a sequenced implementation table that strongly recommends:

1. **Start immediately with Priority 1** (1-2 weeks) — surgical quality improvement with zero cost on routine work
2. **Then Priority 5** (1 week) — further cost optimization
3. **Then Priority 4** (2 weeks) — security hardening **BEFORE any external exposure**
4. **Then Priority 2** (3-4 weeks) — A2A gateway (distribution moat)
5. **Then Priority 3** (2-3 weeks) — skill extraction
6. **Then Priority 6** (2 weeks) — cascade analysis (can run in parallel with Phases 1-2 as marketing)
7. **Finally Priority 7** (3-4 weeks) — Agent SDK (requires A2A stable)

**Critical constraint**: "Security hardening before any external exposure" — Priority 4 MUST complete before Priority 2 ships.

---

## QUESTION 2: CONCRETE PACKAGES/FILES FOR PRIORITIES 1-3

### Priority 1: Cross-Model Consensus Verification Policy

**NEW FILES TO CREATE**:
- \packages/agent-runtime/src/verificationPolicy.ts\ (30 lines core logic)

**EXISTING FILES TO MODIFY**:
- \packages/agent-runtime/src/baseAgentRunner.ts\ (line ~180: add step 8.5 verification policy check)
- \packages/agent-runtime/src/reasoningEngine.ts\ (already exists with PassType enum; just accept filtering)
- \packages/scheduler/src/analysisEngine.ts\ (Phase 4 SYNTHESIZE: pass engineSource: 'analysis')
- \packages/scheduler/src/deepDiveEngine.ts\ (pass engineSource: 'deep_dive')
- \packages/scheduler/src/strategyLabEngine.ts\ (pass engineSource: 'strategy_lab')
- \packages/scheduler/src/cotEngine.ts\ (pass engineSource: 'cot')
- \packages/scheduler/src/simulationEngine.ts\ (line 5: already exists)
- \packages/dashboard/src/pages/Financials.tsx\ (add verification tier distribution panel)

**DATABASE CHANGES**:
\\\sql
ALTER TABLE agent_runs 
  ADD COLUMN IF NOT EXISTS verification_tier TEXT;        -- 'none', 'self_critique', 'cross_model', 'conditional'
  ADD COLUMN IF NOT EXISTS verification_reason TEXT;      -- human-readable reason
  ADD COLUMN IF NOT EXISTS verification_passes TEXT[];    -- which passes were run
\\\

**Current Implementation Status**:
- ✅ \easoningEngine.ts\ FULLY EXISTS (lines 1-250+) with PassType enum and verify() method
- ✅ \gent_reasoning_config\ table EXISTS (created in 20260227200000_reasoning_engine.sql)
- ✅ \easoning_passes\ table EXISTS
- ✅ Value gate already implemented in baseAgentRunner (line ~342)
- ⚠️ **verificationPolicy.ts MISSING** — the deterministic policy function that decides which tier to use

**Code reference**: 
- reasoningEngine.ts lines 18-23: PassType definition already includes 'cross_model'
- baseAgentRunner.ts line 342: value gate already present
- baseAgentRunner.ts has no verification policy check yet (needs insertion at line ~370 after prompt build, before loop)

---

### Priority 2: A2A Protocol (External Agent Interoperability)

**NEW PACKAGES TO CREATE**:
- \packages/a2a-gateway/\ (Cloud Run service)
- \docker/Dockerfile.a2a-gateway\

**NEW FILES IN a2a-gateway/**:
- \src/server.ts\ (HTTP server)
- \src/agentCards.ts\ (Agent Card generation from DB)
- \src/taskHandler.ts\ (A2A task lifecycle)

**EXISTING FILES TO MODIFY**:
- \packages/agents/src/shared/coreTools.ts\ (add discover_external_agents tool)
- \.github/workflows/deploy.yml\ (add a2a-gateway service)

**DATABASE CHANGES**:
\\\sql
CREATE TABLE a2a_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  trust_level TEXT DEFAULT 'untrusted',
  rate_limit_per_hour INT DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE a2a_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES a2a_clients(id),
  directive_id UUID REFERENCES founder_directives(id),
  status TEXT DEFAULT 'submitted',
  input JSONB NOT NULL,
  output JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
\\\

**Current Implementation Status**:
- ✅ \glyphorMcpTools.ts\ EXISTS (bridges to MCP servers)
- ✅ \gent365Tools.ts\ EXISTS (Microsoft integration)
- ✅ \dynamicToolExecutor.ts\ EXISTS
- ✅ Worker service exists (glyphor-worker)
- ❌ **a2a-gateway package DOES NOT EXIST** — entire new service
- ✅ \company_agents\ table EXISTS with personality_summary
- ✅ \skills\ + \gent_skills\ tables EXISTS

**Code integration points**:
- Needs to call Sarah's orchestration loop via founder_directives
- Must integrate with work_assignments status tracking
- Rate limiting can reuse eventPermissions.ts pattern

---

### Priority 3: Self-Evolution Engine (Skill Library + Inter-Agent Transfer)

**NEW FILES TO CREATE**:
- \packages/agent-runtime/src/skillExtractor.ts\ (auto-extract from successful runs)
- \packages/agent-runtime/src/rubricEvolver.ts\ (weekly rubric dimension analysis)

**EXISTING FILES TO MODIFY**:
- \packages/agent-runtime/src/baseAgentRunner.ts\ (Step 12: add skill extraction post-run)
- \packages/agent-runtime/src/jitContextRetriever.ts\ (add cross-agent skill recommendation query)
- \packages/scheduler/src/cronManager.ts\ (add weekly rubric evolution job + prediction accuracy checker)

**DATABASE CHANGES**:
\\\sql
CREATE TABLE proposed_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_data JSONB NOT NULL,
  source_agent TEXT NOT NULL,
  source_run_ids TEXT[] NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE proposed_rubric_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  amendment_type TEXT NOT NULL,
  details JSONB NOT NULL,
  evidence JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE skills 
  ADD COLUMN IF NOT EXISTS usage_count INT DEFAULT 0;
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
  ADD COLUMN IF NOT EXISTS discovery_source TEXT;  -- 'manual', 'auto_extracted'
\\\

**Current Implementation Status**:
- ✅ \skills\ table EXISTS (10 skill categories)
- ✅ \gent_skills\ table EXISTS with proficiency tracking
- ✅ \shared_procedures\ table EXISTS (L4 procedural memory)
- ✅ \shared_episodes\ table EXISTS with significance_score
- ✅ \pisodicReplay.ts\ EXISTS (runs every 2 hours)
- ✅ \gent_reflections\ table EXISTS
- ✅ \gent_world_model\ EXISTS
- ❌ **skillExtractor.ts DOES NOT EXIST** — needs creation
- ❌ **rubricEvolver.ts DOES NOT EXIST** — needs creation
- ❌ **proposed_skills table DOES NOT EXIST**
- ❌ **proposed_rubric_amendments table DOES NOT EXIST**

**Integration point**: baseAgentRunner.ts post-run (after step 11 world model, before completion)

---

## QUESTION 3: FLEET-FRIENDLY TODO BREAKDOWN (HIGH PARALLELISM)

Recommend organizing as **independent work streams** with minimal blocking:

### STREAM 1: Priority 1 — Verification Policy (1-2 weeks, 2-3 devs)
\\\
├── Task 1a: Create verificationPolicy.ts (30 lines) — OWNER A
├── Task 1b: Integrate into baseAgentRunner.ts step 8.5 — OWNER A (depends on 1a)
├── Task 1c: Add verification columns to agent_runs — OWNER B (DBA)
├── Task 1d: Update Financials dashboard panel — OWNER C (parallel to 1a-c)
├── Task 1e: Update all 5 engines (analysis/simulation/etc) with engineSource flag — OWNER A (parallel to 1d)
└── Task 1f: Test & validation — OWNER A+B (depends on all above)
\\\
**Blockers**: None — this is ground-floor priority

### STREAM 2: Priority 5 — Subtask Model Routing (1 week, 1 dev, LOW PRIORITY)
\\\
├── Task 2a: Create subtaskRouter.ts — OWNER D
├── Task 2b: Integrate into baseAgentRunner before model calls — OWNER D (depends on 2a)
├── Task 2c: Add routing columns to agent_runs — OWNER B (DBA, parallel)
└── Task 2d: Update Financials cost-per-quality chart — OWNER C (parallel)
\\\
**Blockers**: None — can start week 2

### STREAM 3: Priority 4 — Security Hardening (2 weeks, 2 devs, **CRITICAL BEFORE A2A**)
\\\
├── Task 3a: Create behavioralFingerprint.ts + build baselines — OWNER E
├── Task 3b: Add security_anomalies table — OWNER B (DBA)
├── Task 3c: Modify toolExecutor.ts for behavioral checks — OWNER E (depends on 3a)
├── Task 3d: Add knowledge_access_scope to company_agents — OWNER F (parallel)
├── Task 3e: Modify graphReader.ts + jitContextRetriever.ts for scope filtering — OWNER F (depends on 3d)
├── Task 3f: Cross-agent tool verification for red-tier tools — OWNER E (depends on 3c)
└── Task 3g: Testing & hardening — OWNER E+F (depends on all above)
\\\
**Blockers**: None (sequential within stream, but whole stream must complete BEFORE Priority 2)

### STREAM 4: Priority 2 — A2A Gateway (3-4 weeks, 3 devs, **DEPENDS ON STREAM 3**)
\\\
├── Task 4a: Create a2a-gateway package structure — OWNER G
├── Task 4b: Implement Agent Card generation (agentCards.ts) — OWNER G (depends on 4a)
├── Task 4c: Implement task lifecycle endpoints (taskHandler.ts) — OWNER H (parallel to 4b)
├── Task 4d: Create a2a_clients + a2a_tasks tables — OWNER B (DBA, parallel)
├── Task 4e: Auth + rate limiting integration — OWNER H (depends on 4d)
├── Task 4f: Add discover_external_agents tool to coreTools.ts — OWNER I (parallel)
├── Task 4g: Deploy Dockerfile + CI/CD integration — OWNER I (depends on 4a-e)
└── Task 4h: Integration testing & API documentation — OWNER G+H (depends on all)
\\\
**Blockers**: 
- **MUST wait for Priority 4 (Stream 3) to complete** before shipping
- Must verify behavioralFingerprint is guarding inbound requests

### STREAM 5: Priority 3 — Skill Extraction (2-3 weeks, 2 devs, **LOW DEPENDENCY**)
\\\
├── Task 5a: Create skillExtractor.ts — OWNER J
├── Task 5b: Integrate into baseAgentRunner.ts post-run (Step 12) — OWNER J (depends on 5a)
├── Task 5c: Create proposed_skills table — OWNER B (DBA, parallel)
├── Task 5d: Modify jitContextRetriever for cross-agent skill recommendations — OWNER K (parallel)
├── Task 5e: Create rubricEvolver.ts — OWNER K
├── Task 5f: Add proposed_rubric_amendments table — OWNER B (DBA, parallel to 5e)
├── Task 5g: Wire rubric evolution + prediction checker into cronManager.ts — OWNER K (depends on 5e-f)
└── Task 5h: Testing — OWNER J+K (depends on all)
\\\
**Blockers**: None — can start week 4 (or in parallel with Stream 1 if bandwidth available)

### STREAM 6: Priority 6 — Cascade Analysis (2 weeks, 1 dev, **MARKETING CAN RUN IN PARALLEL**)
\\\
├── Task 6a: Create cascade_predictions table — OWNER B (DBA)
├── Task 6b: Update Strategy.tsx with Cascade Map visualization — OWNER L (parallel)
├── Task 6c: Add runQuick() lightweight mode to simulationEngine.ts — OWNER M
├── Task 6d: Wire auto-trigger into authorityGates.ts — OWNER M (depends on 6c)
├── Task 6e: Implement prediction accuracy checker (weekly job) — OWNER M (parallel to 6d)
└── Task 6f: Content/whitepaper preparation — MARKETING (can start NOW)
\\\
**Blockers**: None — can start week 3 (or in parallel with Stream 1 for whitepaper)

### STREAM 7: Priority 7 — Agent SDK (3-4 weeks, 2 devs, **DEPENDS ON STREAM 4**)
\\\
├── Task 7a: Create packages/agent-sdk/ package structure — OWNER N
├── Task 7b: Implement SDK client API wrapper (glyphor.createAgent()) — OWNER N (depends on 7a)
├── Task 7c: Wire to existing agentCreationTools.ts + runDynamicAgent.ts — OWNER N (depends on 7b)
├── Task 7d: SDK documentation + examples — OWNER O (parallel)
├── Task 7e: Update row-level security for tenant isolation — OWNER F (parallel, lightweight)
├── Task 7f: Integration testing with multiple tenants — OWNER N+O (depends on 7c-e)
└── Task 7g: Launch & adoption support — OWNER O (post-completion)
\\\
**Blockers**: 
- **MUST wait for Priority 2 (Stream 4) to ship first** (A2A must be stable)
- Requires existing row-level security (already in place per migrations)

---

## QUESTION 4: MAJOR UNKNOWNS & BLOCKERS

### Technical Unknowns

1. **Cost of cross-model consensus in production**
   - Doc estimates .35-0.90/day for all verification, but real volume may differ
   - Unknown: How many runs actually qualify for Tier 2 (cross-model)?
   - **Risk**: If cross-model becomes default, costs could spike 3x
   - **Mitigation**: Implement verificationPolicy.ts with rigid tier gates, monitor daily

2. **Agent model diversity in verification**
   - Doc specifies: gpt-5.2-2025-12-11, claude-opus-4-6, gemini-3-flash-preview for verification
   - Unknown: Cost parity between providers for equivalently-sized models
   - Unknown: Latency profile for consensus loops (how long does 3-model consensus take?)
   - **Risk**: Verification timeouts could cause pipeline backups
   - **Mitigation**: Add timeout handling + fallback to single-model if consensus stalls >30s

3. **A2A client onboarding & discovery**
   - Doc leaves open: How do external agents discover Glyphor's agents at scale?
   - Unknown: Rate limiting strategy (per-client vs per-endpoint?)
   - Unknown: Multi-tenant isolation robustness
   - **Risk**: A2A becomes attack vector if clients abuse discovery endpoints
   - **Mitigation**: Hard cap (e.g., 10 discovery calls/hour), require bearer token auth

4. **Cascade Analysis accuracy tracking**
   - Doc mentions correlating predictions vs outcomes weekly, but:
   - Unknown: How do we measure "actual outcome" for abstract decisions?
   - Unknown: What if outcomes are ambiguous (e.g., "revenue up 2%" but couldn't attribute to specific decision)?
   - **Risk**: Accuracy metrics become meaningless, trust in Cascade erodes
   - **Mitigation**: Define outcome measurement rules upfront, only track high-confidence correlations

5. **Skill extraction filtering**
   - Doc says "only runs with quality >= 80 AND turns <= 5"
   - Unknown: Is this threshold right? Too strict = no skills extracted; too loose = low-quality skills
   - Unknown: How many runs/day actually meet these criteria?
   - **Risk**: Skill library never reaches critical mass
   - **Mitigation**: Start with qualityScore >= 75, turns <= 6; adjust based on extraction rate

6. **Knowledge compartmentalization enforcement**
   - Doc adds \knowledge_access_scope\ to agents, but:
   - Unknown: How granular should scopes be? (company-wide vs dept vs agent-specific?)
   - Unknown: What happens if an agent's reasoning engine accesses out-of-scope KG nodes?
   - **Risk**: Either too permissive (security theater) or too restrictive (blocks valid reasoning)
   - **Mitigation**: Start with dept-level scopes (finance agents can't see eng), audit for false positives

### Integration Blockers

7. **Dependency order risk: Priority 4 → Priority 2**
   - If security hardening has bugs, A2A ships insecure
   - **Mitigation**: Explicit security review gate before A2A ships; disable A2A in production until cleared
   - **Critical**: Don't merge A2A PR until behavioral_fingerprint + knowledge_access_scope are in production for 1 week

8. **Database migration ordering**
   - All 7 priorities add new tables + columns
   - Unknown: Do migrations need to be sequenced to avoid schema conflicts?
   - Unknown: How do we roll back if Priority 1 breaks agent_runs schema?
   - **Mitigation**: Use Postgres transactions; test all migrations on staging database first

9. **Model availability**
   - Doc references: gpt-5.2-2025-12-11, claude-opus-4-6, gemini-3-flash-preview
   - Unknown: Are these models actually available in March 2026? Pricing?
   - Unknown: What if OpenAI or Anthropic discontinues these models mid-project?
   - **Mitigation**: Implement model fallback chain; support at least 2 providers per use case

10. **Redis cache capacity for reasoning**
    - reasoningEngine caches at easoning:{hash} key
    - Unknown: TTL strategy? Memory impact if all 200+ daily runs cache?
    - **Mitigation**: Implement LRU eviction; monitor Redis memory; set TTL to 6 hours

---

## QUESTION 5: EXACT FILES/FUNCTIONS LIKELY TO CHANGE (PRIORITY 1)

### Priority 1 — Cross-Model Consensus Verification Policy

**New file (PRIMARY CHANGE)**:
`
packages/agent-runtime/src/verificationPolicy.ts
├── Function: determineVerificationTier() — the core decision engine
├── Exports: VerificationTier, VerificationDecision types
└── Constants: TIER_0_CRONS, FINANCIAL_LEGAL_ROLES, EXTERNAL_OUTPUT_TOOLS
`

**Modified existing files**:

1. **packages/agent-runtime/src/baseAgentRunner.ts** (CRITICAL INSERTION POINT)
   - **Location**: ~line 370 (after system prompt build, before main loop)
   - **New code**: Step 8.5 verification policy check
   - **Function signature**: Insert before while (true) loop
   - **Code snippet**:
     `	ypescript
     const verificationDecision = determineVerificationTier({
       agentRole: config.role,
       taskSource: runContext.source,  // NEW: need to add this to AgentConfig
       workLoopPriority: runContext.workLoopPriority,  // NEW
       authorityTier: getAuthorityTier(this.role, proposedActions),
       trustScore: await trustScorer.getScore(this.role),
       turnsUsed: turnCount,
       mutationToolsCalled: actionReceipts.map(r => r.toolName),
       hasExternalOutput: actionReceipts.some(r => EXTERNAL_OUTPUT_TOOLS.includes(r.toolName)),
       engineSource: runContext.engineSource,  // NEW
     });
     
     if (verificationDecision.tier !== 'none') {
       const reasoningResult = await reasoningEngine.verify(agentOutput, {
         passes: verificationDecision.passes,  // CHANGE: passes filtering
       });
     }
     `
   - **Why this matters**: This is where verification gets triggered; currently baseAgentRunner calls reasoningEngine directly without policy filtering

2. **packages/agent-runtime/src/reasoningEngine.ts**
   - **Location**: verify() method signature (line ~163)
   - **Change**: Accept optional \passes\ filter parameter instead of using config.passTypes directly
   - **Before**: \sync verify(agentRole, task, output, context)\
   - **After**: \sync verify(agentRole, task, output, context, options?: {passes?: PassType[]})\
   - **Line 175**: Replace \	his.config.passTypes\ with \options?.passes ?? this.config.passTypes\

3. **packages/agent-runtime/src/jitContextRetriever.ts**
   - **Location**: parallel query section (likely after existing semantic search)
   - **New addition**: Cross-agent skill recommendation query (for Priority 3, but docs 389-398 show the pattern)
   - **Impact**: Minimal for Priority 1, but mentioned in doc as integration point

4. **packages/agent-runtime/src/modelClient.ts**
   - **Location**: generate() method
   - **Change**: Support per-turn model override (for Priority 5, NOT Priority 1)
   - **Priority 1 impact**: NONE — this is Priority 5 work

5. **packages/scheduler/src/analysisEngine.ts, deepDiveEngine.ts, strategyLabEngine.ts, cotEngine.ts, simulationEngine.ts**
   - **Location**: Phase 4 SYNTHESIZE / synthesis call
   - **Change**: Add \ngineSource: 'analysis' | 'deep_dive' | 'strategy_lab' | 'cot' | 'simulation'\ flag to runner config
   - **Why**: Signals verificationPolicy to use Tier 2 (cross-model) for synthesis outputs
   - **Example from analysisEngine.ts line 186**:
     `	ypescript
     const synthesisResult = await runner.run({
       ...synthesisConfig,
       engineSource: 'analysis',  // NEW LINE
     });
     `

6. **packages/dashboard/src/pages/Financials.tsx**
   - **Location**: New panel after existing financials charts
   - **Additions**:
     - Pie chart: Verification tier distribution (none: 75%, self_critique: 15%, cross_model: 8%, conditional: 2%)
     - Bar chart: Cost breakdown by tier (showing cost/run for each tier)
     - Line chart: Trending over time (daily average runs per tier)
   - **Data source**: Query \gent_runs\ with \erification_tier\ column (NEW)

---

### Database Changes for Priority 1

**File**: New migration (suggest \20260315_verification_policy.sql\)

`sql
-- Add verification policy columns to agent_runs
ALTER TABLE agent_runs 
  ADD COLUMN IF NOT EXISTS verification_tier TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verification_reason TEXT,
  ADD COLUMN IF NOT EXISTS verification_passes TEXT[] DEFAULT '{}';

-- Add verification result columns (already exist from reasoningEngine, but confirm)
-- reasoning_passes table — track individual verification passes per run
-- Already created in 20260227200000_reasoning_engine.sql

-- Create indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_agent_runs_verification_tier 
  ON agent_runs(verification_tier, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_verification_cost
  ON agent_runs(verification_tier, cost, created_at DESC);
`

---

### AgentConfig Type Changes

**File**: packages/agent-runtime/src/types.ts

**New/Modified fields in AgentConfig**:
`	ypescript
interface AgentConfig {
  // ... existing fields
  source?: 'heartbeat' | 'cron' | 'wake' | 'on_demand' | 'a2a';  // NEW
  workLoopPriority?: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';    // NEW
  engineSource?: 'analysis' | 'deep_dive' | 'strategy_lab' | 'cot' | 'simulation';  // NEW
}
`

---

### Constants File (verificationPolicy.ts)

**File**: packages/agent-runtime/src/verificationPolicy.ts (NEW)

`	ypescript
export const TIER_0_CRONS = [
  'ops-health-check', 'ops-freshness-check', 'ops-cost-check',
  'ops-morning-status', 'ops-evening-status',
  'support-triage-recurring', 'social-media-morning', 'social-media-afternoon',
  'seo-analyst-daily', 'm365-admin-weekly-audit', 'm365-admin-user-audit',
];

export const FINANCIAL_LEGAL_ROLES = [
  'cfo', 'clo', 'revenue-analyst', 'cost-analyst',
  'bob-the-tax-pro', 'tax-strategy-specialist', 'data-integrity-auditor',
];

export const EXTERNAL_OUTPUT_TOOLS = [
  'send_email', 'reply_to_email',
  'publish_content', 'schedule_publish',
  'send_proposal', 'publish_deliverable',
];
`

---

## Summary of Changes by File

| File | Line | Change Type | Priority 1 Impact |
|------|------|-------------|-------------------|
| baseAgentRunner.ts | ~370 | Insert verificationPolicy check | **HIGH** — core integration point |
| reasoningEngine.ts | ~163, 175 | Add passes filter parameter | **MEDIUM** — logic change |
| analysisEngine.ts | ~186 | Add engineSource flag | **LOW** — one line per engine |
| deepDiveEngine.ts | synthesis phase | Add engineSource flag | **LOW** |
| strategyLabEngine.ts | synthesis phase | Add engineSource flag | **LOW** |
| cotEngine.ts | synthesis phase | Add engineSource flag | **LOW** |
| jitContextRetriever.ts | ~385 | Prepare for Priority 3 (not Priority 1) | **NONE** |
| types.ts | AgentConfig interface | Add source, workLoopPriority, engineSource | **LOW** — type expansion |
| Financials.tsx | dashboard | New verification tier chart | **LOW** — dashboard only |
| Dashboard/database | NEW | Financials, Reasoning cost tracking | **MEDIUM** — reports |

---

## QUESTION 6: DASHBOARD & DATABASE CHANGES FOR PRIORITY 1

### Dashboard Changes

**File**: packages/dashboard/src/pages/Financials.tsx

**New panels to add**:

1. **Verification Tier Distribution (Pie Chart)**
   - Shows % of runs by tier
   - Query: \SELECT verification_tier, COUNT(*) FROM agent_runs WHERE created_at > NOW() - INTERVAL '24h' GROUP BY verification_tier\
   - Expected distribution: ~75% none, ~20% self_critique, ~4% cross_model, ~1% conditional

2. **Cost Breakdown by Verification Tier (Bar Chart)**
   - X-axis: Tier
   - Y-axis: Average cost/run
   - Query: \SELECT verification_tier, AVG(cost) FROM agent_runs WHERE created_at > NOW() - INTERVAL '7d' GROUP BY verification_tier\
   - Expected: none = .0002/run, self_critique = .002, cross_model = .015, conditional = .005

3. **Daily Verification Cost Trend (Line Chart)**
   - X-axis: Date
   - Y-axis: Total verification cost (SUM of reasoning_cost_usd)
   - Query: \SELECT DATE(created_at), SUM(reasoning_cost_usd) FROM agent_runs WHERE created_at > NOW() - INTERVAL '30d' GROUP BY DATE(created_at)\
   - Expected: Trending .3-0.9/day

4. **Verification Tier by Agent Role (Table)**
   - Shows which agents are getting which tiers
   - Query: \SELECT agent_id, verification_tier, COUNT(*), AVG(cost) FROM agent_runs WHERE created_at > NOW() - INTERVAL '7d' GROUP BY agent_id, verification_tier ORDER BY agent_id\

### Database Changes

**New columns in agent_runs table**:

`sql
verification_tier TEXT DEFAULT 'none'
  -- Values: 'none' (no verification), 'self_critique', 'cross_model', 'conditional'
  
verification_reason TEXT
  -- Human-readable: "red-tier decision", "external-facing output", "yellow-tier, low trust", etc.
  
verification_passes TEXT[] DEFAULT '{}'
  -- Array of pass types actually run: {'self_critique'}, {'self_critique','cross_model'}, etc.
`

**Related existing tables** (already exist):
- \easoning_passes\ — one row per verification pass per run (created in 20260227200000_reasoning_engine.sql)
- \gent_reasoning_config\ — per-agent reasoning configuration (already populated)

**Indexes for performance**:

`sql
CREATE INDEX IF NOT EXISTS idx_agent_runs_verification_tier 
  ON agent_runs(verification_tier, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_verification_cost
  ON agent_runs(verification_tier, cost, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reasoning_passes_run_id 
  ON reasoning_passes(run_id);
`

---

## QUESTION 7: TODO STATUS UPDATE

Since a todos table doesn't currently exist in the database, I'll document what **should** be created and tracked.

**Recommendation: Create a todos tracking table**

\\\sql
CREATE TABLE IF NOT EXISTS implementation_todos (
  id TEXT PRIMARY KEY,  -- e.g., 'analyze-advancement-spec'
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, in_progress, done, blocked
  priority INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  owner TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  blockers TEXT[]
);
\\\

**For this analysis**, the status should be:

\\\sql
INSERT INTO implementation_todos 
  (id, status, priority, title, description, owner, updated_at)
VALUES 
  ('analyze-advancement-spec', 'done', 1, 
   'Analyze glyphor-advancement-implementation.md', 
   'Read document, inspect codebase, create todo breakdown, identify files to modify',
   'Agent', NOW())
ON CONFLICT (id) DO UPDATE SET 
  status = 'done',
  updated_at = NOW(),
  completed_at = NOW();
\\\

**However**, since the table doesn't exist, I recommend:
- **Status**: FULLY DONE (all 7 questions answered with concrete details)
- **Blockers**: NONE — all required information in codebase + doc
- **Next action**: Create the todos table and begin Priority 1 implementation

---

## FINAL RECOMMENDATION: IMMEDIATE ACTIONS

### Week 1 (Immediate)
- [ ] Create \erificationPolicy.ts\ (30 lines)
- [ ] Create database migration for verification columns
- [ ] Integrate verificationPolicy check into baseAgentRunner.ts

### Week 2
- [ ] Add engineSource flags to 5 engines
- [ ] Update Financials dashboard
- [ ] Complete Priority 1 testing

### Week 3
- [ ] Start Priority 5 (subtask router)
- [ ] Begin Priority 4 prep (security hardening design)

### Week 4+
- [ ] Priority 4 implementation (2 weeks)
- [ ] Security review gate BEFORE Priority 2 starts
- [ ] Priority 2 implementation (3-4 weeks)

### Risk Mitigation
- Do NOT ship Priority 2 (A2A) until Priority 4 (security) is production-tested for 1 week
- Monitor verification costs daily for first 2 weeks of Priority 1
- Test all database migrations on staging first

