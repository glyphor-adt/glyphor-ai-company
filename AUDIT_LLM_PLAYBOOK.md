# LLM_OPTIMIZATION_PLAYBOOK.md - Audit Report (Issues 1-7)
Date: 2026-03-11
Audit Focus: Migration naming, package structure, scheduler wiring, build commands

---

## CRITICAL MISMATCHES

### 1. Migration Number Mismatch (Issue 1)
**SEVERITY: HIGH - Structural execution failure**

**Playbook Citation:**
- Line 18: "Create \db/migrations/139_add_routing_columns.sql\"
- Line 22: "-- Migration 139: Add routing observability columns..."
- Line 52: "psql -h \ -U \ -d \ -f db/migrations/139_add_routing_columns.sql"

**Actual Codebase State:**
- Latest migration: \20260311120000_schema_drift_fixes.sql\ (timestamp-based format)
- All existing migrations use timestamp format: \YYYYMMDDHHMMSS_description.sql\
- Examples: 
  - 20260307120500_constitutional_gates.sql
  - 20260308002000_core_initiatives_schema.sql
  - 20260311120000_schema_drift_fixes.sql

**Issue:**
The playbook specifies sequential numeric migration IDs (139), but the codebase uses timestamp-based migrations (20260311120000). Using \139_add_routing_columns.sql\ would violate the existing migration convention and likely break the migration ledger tracked in \schema_migration_ledger\ table.

**Required Fix:**
Migration should be named: \20260311HHMMSS_add_routing_columns.sql\ (where HHMMSS is next sequential time)

---

### 2. Missing Directory Structure (Issue 2)
**SEVERITY: HIGH - Non-existent package paths**

**Playbook Citation:**
- Line 69: "Create \packages/agent-runtime/src/routing/capabilities.ts\"
- Line 111: "Create \packages/agent-runtime/src/routing/toolCapabilityMap.ts\"
- Line 337: "Create \packages/agent-runtime/src/routing/index.ts\"

**Actual Codebase State:**
- \packages/agent-runtime/src/routing/\ directory: **DOES NOT EXIST**
- Current \packages/agent-runtime/src/\ directories:
  - __tests__/
  - config/
  - providers/ (contains: anthropic.ts, gemini.ts, index.ts, openai.ts, types.ts)
  - triangulation/
- Main source files in \src/\ include: baseAgentRunner.ts, companyAgentRunner.ts, formalVerifier.ts, etc.

**Impact:**
All three Issues 2, 3, 4 depend on creating the \outing/\ package structure. This is not optional refactoring—it's foundational.

**Source File Reference:**
- Verified via: \Get-ChildItem -Path "C:\Users\KristinaDenney\source\repos\glyphor-ai-company\packages\agent-runtime\src" -Directory\

---

### 3. Missing Schemas Directory (Issue 7)
**SEVERITY: HIGH - Non-existent schema paths**

**Playbook Citation:**
- Line 1254: "Create \packages/agent-runtime/src/schemas/reflectionSchema.ts\"
- Line 1367: "Create \packages/agent-runtime/src/schemas/assignmentOutputSchema.ts\"
- Line 1419: "Create \packages/agent-runtime/src/schemas/evaluationSchema.ts\"

**Actual Codebase State:**
- \packages/agent-runtime/src/schemas/\ directory: **DOES NOT EXIST**

**Impact:**
All three schema files must be created in a new directory. This is a clean-slate requirement.

---

### 4. cronPreCheck.ts Placement Mismatch (Issue 5)
**SEVERITY: MEDIUM - Unclear file location**

**Playbook Citation:**
- Line 936: "Create \packages/agent-runtime/src/cronPreCheck.ts\"
- Line 1174: "Import statement: \import { PRE_CHECK_REGISTRY } from './cronPreCheck';\"

**Actual Codebase State:**
- File does NOT exist in \packages/agent-runtime/src/\
- File naming suggests it's for cron-based checks (health_check, freshness_check, cost_check, etc.)
- Current \packages/agent-runtime/src/\ has similar files like: heartbeat.ts, taskRunner.ts, but cronPreCheck.ts is missing

**Question for Interpretation:**
The playbook says to create this file in agent-runtime, which is correct based on context (pre-checks are evaluated during runner initialization). However, the playbook's reference on line 1174 shows it imported directly in companyAgentRunner: \import { PRE_CHECK_REGISTRY } from './cronPreCheck';\ This import path assumes cronPreCheck.ts is at the same directory level as companyAgentRunner.ts, which is valid.

---

### 5. AgentExecutionResult Type Mismatch (Issue 6)
**SEVERITY: MEDIUM - Missing optional fields**

**Playbook Citation:**
- Lines 1231-1236:
  `	ypescript
  export interface AgentExecutionResult {
    // ... existing fields ...
    routingRule?: string;
    routingCapabilities?: string[];
    routingModel?: string;
  }
  `

**Actual Codebase State (packages/agent-runtime/src/types.ts, lines 191-211):**
  `	ypescript
  export interface AgentExecutionResult {
    agentId: string;
    role: string;
    status: 'completed' | 'aborted' | 'error';
    output: string | null;
    totalTurns: number;
    totalFilesWritten: number;
    totalMemoryKeysWritten: number;
    elapsedMs: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cachedInputTokens: number;
    cost: number;
    abortReason?: string;
    error?: string;
    reasoning?: ReasoningEnvelope;
    conversationHistory: ConversationTurn[];
    actions?: ActionReceipt[];
  }
  `

**Status:**
The interface exists but does NOT have the three routing fields. These must be added:
- routingRule?: string
- routingCapabilities?: string[]
- routingModel?: string

---

### 6. Scheduler.ts UPDATE Query Not Updated (Issue 6)
**SEVERITY: HIGH - Wiring missing for logging**

**Playbook Citation:**
- Lines 1214-1224: Instructions to modify \packages/scheduler/src/server.ts\ to add routing columns to UPDATE agent_runs query

**Actual Codebase State (packages/scheduler/src/server.ts):**
Current UPDATE query (from grep result):
`	ypescript
UPDATE agent_runs SET status=, completed_at=, duration_ms=, turns=, tool_calls=, 
  input_tokens=, output_tokens=, cost=, output=, error=, thinking_tokens=, 
  cached_input_tokens= 
WHERE id=
`

**Missing Columns:**
- routing_rule
- routing_capabilities
- routing_model

**Impact:**
Issue 6 explicitly says to wire routing values into the UPDATE statement. This has not been done.

---

## STRUCTURAL ASSUMPTIONS THAT ARE CORRECT

### ✅ Package structure (agent-runtime exists)
- packages/agent-runtime/ exists and is properly configured
- Build command: \
pm run build --workspace=@glyphor/agent-runtime\ maps to \	sc\
- **Reference:** package.json line 10: \"build": "turbo run build"\ + agent-runtime/package.json: \"build": "tsc"\

### ✅ Provider files exist and are modifiable
- packages/agent-runtime/src/providers/openai.ts ✓
- packages/agent-runtime/src/providers/anthropic.ts ✓
- packages/agent-runtime/src/providers/gemini.ts ✓
- All three provider files exist and can be extended per Issues 8-10

### ✅ MCP tool factories exist and use defaults
**Playbook Assumption (Issue 13):**
- Lines 1556-1559 reference \createAgent365McpTools(agentRole?, serverFilter?)\ and \createGlyphorMcpTools(agentRole?, serverFilter?)\
- Currently default behavior loads ALL servers when no serverFilter provided

**Actual Codebase State:**
- packages/agents/src/shared/agent365Tools.ts: Line 79 shows \maybeServerFilter ?? [...ALL_M365_SERVERS]\
- packages/agents/src/shared/glyphorMcpTools.ts: Lines 175-179 shows optional filtering
- **Current Behavior:** When no serverFilter passed, defaults to ALL servers
- **Playbook Requirement (Issue 13):** Change default to require explicit server list

✅ This is correctly identified as a future modification target.

### ✅ CompanyAgentRunner exists and is modifiable
- packages/agent-runtime/src/companyAgentRunner.ts exists
- Does NOT currently import routing or PRE_CHECK_REGISTRY (verified via grep)
- Can be extended with Issue 6 wiring

### ✅ Heartbeat system exists
- packages/scheduler/src/heartbeat.ts exists
- Can integrate pre-checks per Issue 6

---

## ACCEPTED CONVENTIONS IN PLAYBOOK (Correct Interpretation)

### ✅ Database migration references
**Playbook Line 52:** \psql -h \ -U \ -d \ -f db/migrations/139_add_routing_columns.sql\
- This is a generic command-line pattern showing intent, not exact shell syntax
- However, the filename \139_add_routing_columns.sql\ IS wrong and must be updated

### ✅ Build command references
**Playbook Line 351:** \
px tsc --noEmit\ in agent-runtime
- This is valid and matches package.json configuration
- Turbo build wraps tsc: \
pm run build --workspace=@glyphor/agent-runtime\

### ✅ TypeScript compilation
**Playbook assumes:** \
px tsc --noEmit\ works at each step
- This is valid and should be run at each issue completion

---

## ACCEPTANCE CRITERIA ANALYSIS

### Issue 1 Acceptance Criteria (Line 55-59)
`
- [ ] gent_runs table has outing_rule, outing_capabilities, outing_model columns
- [ ] Indexes exist on both columns
- [ ] Existing rows have NULL for all three columns (no backfill)
- [ ] New INSERT INTO agent_runs statements still work without specifying these columns
`

**Assessment:** ✓ Valid and testable. Migration must add columns and indexes.

### Issue 2 Acceptance Criteria (Line 346-351)
`
- [ ] packages/agent-runtime/src/routing/ directory exists with 3 files
- [ ] Capability type exported
- [ ] TOOL_CAPABILITY_MAP covers all tool names from AGENT_PLATFORM_REFERENCE.md Part 2
- [ ] MCP_SERVER_CAPABILITIES maps all 8 Glyphor + 8 A365 servers
- [ ] TypeScript compiles with no errors: 
px tsc --noEmit in agent-runtime
`

**Assessment:** ⚠️ Criterion 3 references \AGENT_PLATFORM_REFERENCE.md\ Part 2 for tool coverage validation. This document exists but was not fully audited. Tool count validation should be done during implementation.

### Issue 5 Acceptance Criteria (Line 1150-1155)
`
- [ ] All 6 pre-check functions query real tables from the schema
- [ ] Each returns { shouldCallLLM: false } when nothing is wrong
- [ ] Each returns { shouldCallLLM: true, context: '...' } with diagnostic info when issues found
- [ ] PRE_CHECK_REGISTRY maps task names to pre-check functions
- [ ] TypeScript compiles: 
px tsc --noEmit
`

**Assessment:** ✓ Valid. Playbook pre-checks query real tables: agent_runs, data_sync_status, agent_messages, financials. These tables are assumed to exist.

---

## SUMMARY TABLE: Mismatches by Severity

| Issue | Mismatch | Type | Severity | Status |
|-------|----------|------|----------|--------|
| 1 | Migration naming (139 vs 20260311HHMMSS) | Naming Convention | **CRITICAL** | ⛔ Blocking |
| 2 | Missing packages/agent-runtime/src/routing/ dir | Directory Structure | **CRITICAL** | ⛔ Blocking |
| 5 | Missing packages/agent-runtime/src/cronPreCheck.ts | File Creation | **HIGH** | ⛔ Blocking |
| 6 | AgentExecutionResult missing routing fields | Type Definition | **HIGH** | ⛔ Blocking |
| 6 | scheduler/server.ts UPDATE not wired | SQL Integration | **HIGH** | ⛔ Blocking |
| 7 | Missing packages/agent-runtime/src/schemas/ dir | Directory Structure | **HIGH** | ⛔ Blocking |
| 2 | TOOL_CAPABILITY_MAP validation unclear | Reference | **MEDIUM** | ⚠️ Requires Validation |

---

## EXECUTION IMPACT

### What Works Immediately:
- ✅ Issues 8-10 (provider updates) can reference existing provider files
- ✅ Issue 11 (flip routing on) can reference existing runner once Issues 2-6 done
- ✅ Issue 13 (MCP filtering) can reference existing factory functions
- ✅ Build commands (npm run build, npm run typecheck) are correctly referenced

### What Is Blocked:
- ❌ Issue 2 cannot complete without creating routing/ directory
- ❌ Issue 3 depends on Issue 2 (routing directory)
- ❌ Issue 4 depends on Issues 2-3
- ❌ Issue 5 cannot be verified without cronPreCheck.ts file
- ❌ Issue 6 cannot complete without Issues 2-5 AND database schema AND runner wiring

### Timeline Risk:
All Issues 1-7 are blocking each other in a critical chain. Issue 1 must use correct migration naming. Issues 2-4 must create the routing package. Issue 5 must create cronPreCheck.ts. Issue 6 must wire everything together. No parallelization possible.

---

## RECOMMENDATIONS

1. **Fix migration naming in Issue 1:**
   - Change line 18 from: \db/migrations/139_add_routing_columns.sql\
   - To: \db/migrations/20260311HHMMSS_add_routing_columns.sql\ (next sequence)

2. **Ensure directories are created:**
   - Create \packages/agent-runtime/src/routing/\ with 3 files (Issues 2, 3, 4)
   - Create \packages/agent-runtime/src/schemas/\ with 3 files (Issue 7)
   - Create \packages/agent-runtime/src/cronPreCheck.ts\ (Issue 5)

3. **Update types.ts before wiring:**
   - Add routing fields to AgentExecutionResult interface before implementing Issue 6

4. **Wire scheduler after types updated:**
   - Update UPDATE query in packages/scheduler/src/server.ts to capture routing columns

5. **Test build chain:**
   - After each issue, run: \
pm run build --workspace=@glyphor/agent-runtime\
   - Verify: \
px tsc --noEmit\ returns no errors

---

## AUDIT COMPLETE

**Status:** READY FOR IMPLEMENTATION (with corrections)
**Critical Blockers:** 7 (all structural)
**Estimated Fix Time:** ~4-6 hours for structural changes + testing
