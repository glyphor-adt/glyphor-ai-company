# Cursor Instructions: Fix Tool Execution Pipeline

## The Problem

Tools exist but don't work. Agents say "I don't have access to that tool" even when
the tool is in their codebase. Or tools silently fail and the agent claims success.
Or the agent doesn't even attempt to use a tool it has. This is different from agents
lying (cursor-fix-agent-lying.md) — this is about the PIPELINE between "tool exists
in code" and "agent successfully executes tool" being broken at multiple points.

---

## The Tool Execution Pipeline (8 Gates)

Every tool call must pass through ALL of these gates in sequence. A failure at ANY
gate kills the tool call. The problem is that failures at different gates look
identical to the user: the agent either says "I don't have access" or claims to have
done something that never happened.

```
Gate 1: TOOL DEFINITION
  Does the tool exist in the agent's runner file (this.tools Map)?
  Failure: Tool never appears in the model's available tools
  
Gate 2: TOOL DECLARATION
  Is the tool included in the tools array sent to the LLM?
  Failure: LLM doesn't know the tool exists, cannot call it
  
Gate 3: TOOL REGISTRY
  Is the tool in KNOWN_TOOLS (static) or tool_registry (DB)?
  Failure: request_tool_access gets rejected ("ask CTO to build it")
  
Gate 4: TOOL GRANT
  Is the tool in agent_tool_grants for this agent_role?
  Failure: ToolExecutor returns "Not granted" error
  
Gate 5: GRANT CACHE
  Is the grant cache stale (60-second TTL)?
  Failure: Recently granted tool fails for up to 60 seconds
  
Gate 6: SCOPE CHECK
  Does the tool call pass scope restrictions?
  Failure: Scoped out of allowed parameters
  
Gate 7: RATE LIMIT + BUDGET
  Has the agent exceeded rate limits or budget caps?
  Failure: Tool blocked by rate limiter or budget exhaustion
  
Gate 8: EXECUTION
  Does the tool's actual code execute successfully?
  Failure: Runtime error, API failure, timeout, bad parameters
```

---

## Diagnosis: Which Gates Are Breaking

### Gate 1 Failure: Tool Not In Agent's this.tools Map

This is the MOST COMMON root cause for "I don't have that tool."

How tools get to agents today:
```
1. Tool is coded in packages/agents/src/shared/someTools.ts
2. Tool is imported in packages/agents/src/{role}/tools.ts
3. Tool is added to the tools Map in createTools() or equivalent
4. When the runner instantiates, this.tools Map is populated
5. this.tools Map is converted to tool declarations for the LLM
```

If step 2 or 3 is missed — the tool exists in the shared file but is never
imported into the specific agent's tools file — the tool is invisible. The agent
literally does not have it. It's not a grant issue. It's not a registry issue.
The tool was never wired to the agent.

**How to verify:** For each agent, log `Array.from(this.tools.keys())` at startup.
Compare against what the agent should have. Any missing tools = wiring gap.

**The fix:**

File: packages/agent-runtime/src/companyAgentRunner.ts (or equivalent runner)

Add tool inventory logging on startup:

```typescript
// On agent instantiation:
const toolNames = Array.from(this.tools.keys()).sort();
console.log(`[${this.role}] Loaded ${toolNames.length} static tools: ${toolNames.join(', ')}`);

// On first run, also log to activity_log:
await db.from('agent_activities').insert({
  agent_role: this.role,
  activity_type: 'tool_inventory',
  summary: `Static tools: ${toolNames.length}`,
  details: { tools: toolNames }
});
```

Now you can query `agent_activities WHERE activity_type = 'tool_inventory'` and see
exactly which tools each agent actually has loaded. Compare against the spec.

### Gate 2 Failure: Tool Declared But LLM Doesn't Receive It

Even if the tool is in this.tools, it must be converted to the LLM's tool
declaration format and included in the API call. Possible failures:

- Tool definition has invalid schema (missing required fields, malformed JSON schema)
- Tool declaration exceeds token limits and gets truncated
- Tool is excluded by tier (light/standard/full context tiers may filter tools)
- Task runner strips tools on last turn (cursor-fix-agent-lying.md covers this)

**The fix:**

File: packages/agent-runtime/src/companyAgentRunner.ts

Log the actual tools sent to the LLM:

```typescript
// Before each model call:
const declaredToolNames = toolDeclarations.map(t => t.name);
console.log(`[${this.role}] Turn ${turnCount}: Declaring ${declaredToolNames.length} tools to model`);

// If tool count differs from static tool count, log the discrepancy:
const staticToolCount = this.tools.size;
if (declaredToolNames.length !== staticToolCount) {
  console.warn(`[${this.role}] TOOL MISMATCH: ${staticToolCount} static, ${declaredToolNames.length} declared`);
}
```

### Gate 3 Failure: Tool Not In Registry

When an agent calls request_tool_access, the system checks isKnownTool(name)
against KNOWN_TOOLS (static set) and the tool_registry DB table. If the tool
isn't in either, the request is rejected with "ask CTO to build it."

This creates a chicken-and-egg problem:
1. Developer adds a new tool to an agent's tools.ts file
2. Developer forgets to add the tool name to KNOWN_TOOLS in toolRegistry.ts
3. Agent has the tool (Gate 1 passes)
4. Agent can use the tool directly (static tools bypass grant checks)
5. BUT if the grant was revoked or expired, request_tool_access fails
   because the registry doesn't know the tool exists

**The fix:**

File: packages/agent-runtime/src/toolRegistry.ts

Auto-register tools from static definitions:

```typescript
// On startup, scan all agent tool Maps and register any unregistered tools:
export async function syncToolRegistry(db: SupabaseClient, allAgentTools: Map<string, string[]>) {
  const knownTools = await getKnownTools(db);
  
  for (const [role, tools] of allAgentTools) {
    for (const toolName of tools) {
      if (!knownTools.has(toolName)) {
        await db.from('tool_registry').upsert({
          name: toolName,
          source: 'auto-discovered',
          discovered_from: role,
          created_at: new Date().toISOString()
        });
        console.log(`[registry] Auto-registered tool: ${toolName} (from ${role})`);
      }
    }
  }
}
```

Run this on scheduler startup. Every tool that any agent has in its static Map
gets auto-registered. No more chicken-and-egg.

### Gate 4 Failure: Tool Not Granted In agent_tool_grants

Architecture says: "Static tool bypass: Tools defined in an agent's code (this.tools Map)
always execute regardless of DB grant state."

This SHOULD mean Gate 4 never blocks static tools. But verify this is actually
implemented correctly in toolExecutor.ts:

```typescript
// Expected behavior in toolExecutor.ts:
async execute(toolCall) {
  // Check if tool is in the agent's static tools Map
  if (this.staticTools.has(toolCall.name)) {
    // BYPASS grant check — execute directly
    return await this.staticTools.get(toolCall.name).execute(toolCall.arguments);
  }
  
  // Only check grants for dynamically-added tools
  const granted = await isToolGranted(this.agentRole, toolCall.name, this.db);
  if (!granted) {
    return { error: `Not granted: ${toolCall.name}. Use request_tool_access.` };
  }
  
  // ... proceed with execution
}
```

**Potential bug:** If the static tool bypass is checking by reference rather than
by name, or if the tool Map is keyed differently than expected, static tools could
fail the bypass and fall through to the grant check.

**The fix:**

File: packages/agent-runtime/src/toolExecutor.ts

Add explicit logging at the bypass decision point:

```typescript
async execute(toolCall: ToolCall) {
  const isStatic = this.staticTools.has(toolCall.name);
  
  if (!isStatic) {
    // Dynamic tool — check grant
    const granted = await isToolGranted(this.agentRole, toolCall.name, this.db);
    if (!granted) {
      console.warn(`[toolExecutor] DENIED: ${this.agentRole} → ${toolCall.name} (not static, not granted)`);
      return {
        error: `Tool "${toolCall.name}" is not granted. Call request_tool_access to self-grant.`,
        denied: true
      };
    }
    console.log(`[toolExecutor] GRANTED (dynamic): ${this.agentRole} → ${toolCall.name}`);
  } else {
    console.log(`[toolExecutor] GRANTED (static): ${this.agentRole} → ${toolCall.name}`);
  }
  
  // ... proceed with execution
}
```

### Gate 5 Failure: Grant Cache Staleness

Grants are cached per-role for 60 seconds. After a grant_tool_access or
request_tool_access call, there's up to a 60-second window where the cache
still says "not granted."

Architecture says: "Cache is invalidated immediately on grant/revoke."

But is this actually implemented? If the cache invalidation only happens on the
same process/instance, and the grant was made by a different agent (Sarah granting
to Jasmine), the cache invalidation may not propagate.

**The fix:**

File: packages/agent-runtime/src/toolExecutor.ts

Use Redis for grant cache instead of in-memory, so all instances share the cache
and invalidation propagates. Or, simpler: after any request_tool_access call
succeeds, explicitly invalidate the local cache for that role:

```typescript
// In request_tool_access handler:
const result = await selfGrantTool(agentRole, toolName, db);
if (result.success) {
  // Force cache invalidation on THIS instance
  grantCache.delete(agentRole);
  // If using Redis: await redis.del(`grants:${agentRole}`);
}
```

### Gate 6-7: Scope and Budget (Less Likely)

These are less likely to cause the "I don't have access" symptom because they
produce specific error messages. But verify the error messages are actually
meaningful and not swallowed.

### Gate 8 Failure: Tool Code Errors

The tool exists, is granted, passes all checks, and then the actual implementation
throws an error. Common causes:

- Missing credentials (API key not in Secret Manager or .env)
- Network egress blocked (domain not in allowlist)
- Database query error (wrong table name, missing column)
- Parameter validation failure (tool receives wrong types)
- Timeout (tool takes too long, supervisor kills it)

**The fix:**

Every tool implementation should have structured error handling:

```typescript
// BAD — error is swallowed:
try {
  const result = await callExternalAPI(params);
  return { success: true, data: result };
} catch (e) {
  return { success: false, error: "Something went wrong" };
}

// GOOD — error is specific and actionable:
try {
  const result = await callExternalAPI(params);
  return { success: true, data: result };
} catch (e) {
  const errorDetails = {
    tool: 'get_search_performance',
    error_type: e.name,
    error_message: e.message,
    params_received: Object.keys(params),
    // Don't log param values (security), just keys
  };
  console.error(`[tool-error] ${JSON.stringify(errorDetails)}`);
  return { 
    success: false, 
    error: `${e.name}: ${e.message}`,
    recoverable: e.name === 'TimeoutError' || e.name === 'NetworkError'
  };
}
```

---

## The Self-Recovery Protocol Is Unreliable

The architecture says agents should:
1. On tool denial → call request_tool_access
2. Retry the original operation
3. If tool doesn't exist → call request_new_tool

In practice, this multi-step recovery fails because:

**Problem A: LLMs don't reliably follow multi-step recovery procedures.**
The model gets a "Not granted" error and instead of calling request_tool_access,
it tells the user "I don't have access to that tool." The ALWAYS_ON_PROTOCOL says
to never do this, but prompt instructions are probabilistic, not deterministic.
The more stressed the model is (low turn budget, complex task, cheap model), the
more likely it is to give up and report the error rather than attempt recovery.

**Problem B: Even when the model does call request_tool_access, it may not retry.**
Self-granting succeeds but the model treats the interaction as complete and
generates a text response about having requested access instead of retrying
the original tool call.

**Problem C: request_tool_access for unknown tools is a dead end.**
The tool isn't in KNOWN_TOOLS → request_tool_access says "ask CTO to build it" →
model tells user it can't do the task → user is stuck. The agent doesn't know
why the tool isn't registered, and the error message gives no path forward.

**The fix: Make recovery automatic at the system level, not the agent level.**

File: packages/agent-runtime/src/toolExecutor.ts

```typescript
async execute(toolCall: ToolCall): Promise<ToolResult> {
  const isStatic = this.staticTools.has(toolCall.name);
  
  if (!isStatic) {
    const granted = await isToolGranted(this.agentRole, toolCall.name, this.db);
    
    if (!granted) {
      // AUTO-RECOVERY: Don't return error to the model. Self-grant and retry.
      console.log(`[toolExecutor] Auto-recovering: ${this.agentRole} → ${toolCall.name}`);
      
      const isKnown = await isKnownTool(toolCall.name, this.db);
      if (!isKnown) {
        // Tool genuinely doesn't exist — return clear error
        return {
          error: `Tool "${toolCall.name}" does not exist in the system. ` +
                 `This tool has not been built yet. Do NOT tell the user you ` +
                 `tried to use it — instead explain that this capability is ` +
                 `not yet available and suggest an alternative approach.`
        };
      }
      
      // Tool exists but not granted — auto-grant and retry
      await selfGrant(this.agentRole, toolCall.name, this.db);
      grantCache.delete(this.agentRole);
      
      // Retry execution — now it should pass
      console.log(`[toolExecutor] Auto-granted ${toolCall.name} to ${this.agentRole}, retrying`);
      // Fall through to execution below
    }
  }
  
  // Execute the tool
  try {
    const handler = this.staticTools.get(toolCall.name) || 
                    await this.getDynamicHandler(toolCall.name);
    
    if (!handler) {
      return { error: `No handler found for tool "${toolCall.name}"` };
    }
    
    const result = await handler.execute(toolCall.arguments);
    return result;
    
  } catch (e) {
    return {
      error: `Tool execution failed: ${e.name}: ${e.message}`,
      recoverable: isRecoverableError(e)
    };
  }
}
```

Key change: Instead of returning a "Not granted" error to the model and hoping
the model follows the recovery protocol, the ToolExecutor handles recovery
AUTOMATICALLY. The model never sees the grant failure. It just gets the tool
result (or a real execution error if the tool itself fails).

This eliminates the entire class of "agent says I don't have access" failures
for tools that exist in the registry.

---

## The Baseline Grant Seed Is Probably Stale

Architecture says: "Seeded with baseline grants for all 37 agents."

Every time a new tool is added to an agent's code, the baseline seed in
agent_tool_grants needs to be updated too. If the seed was created once and
never maintained, new tools added after the initial seed won't have grants.

Static tools bypass grants (Gate 4), so this only matters for dynamically
granted tools. But if any tool was accidentally NOT added to the agent's
static tools Map, it falls through to the grant check, which fails because
the seed is stale.

**The fix: Auto-sync grants from static tools.**

File: packages/agent-runtime/src/toolExecutor.ts (or a startup script)

```typescript
// On agent startup, ensure all static tools have DB grants:
async function syncBaselineGrants(role: string, staticTools: Map<string, any>, db: SupabaseClient) {
  const toolNames = Array.from(staticTools.keys());
  
  for (const toolName of toolNames) {
    await db.from('agent_tool_grants').upsert({
      agent_role: role,
      tool_name: toolName,
      granted_by: 'system-baseline',
      reason: 'Static tool auto-sync',
      is_active: true
    }, {
      onConflict: 'agent_role,tool_name',
      ignoreDuplicates: true  // Don't overwrite existing grants
    });
  }
}
```

Run on every agent startup. Cheap (upsert with ignoreDuplicates is a no-op
for existing grants). Guarantees the DB always reflects the code.

---

## Comprehensive Fix: The Tool Health Dashboard

None of these individual fixes matter if you can't SEE the state of the system.
You need a single view that shows, for every agent and every tool:

File: packages/dashboard/src/pages/ToolHealth.tsx (new page)

```
┌──────────────────────────────────────────────────────────────┐
│ TOOL HEALTH DASHBOARD                                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Agent: Jasmine Rivera (head-of-hr)                           │
│ Model: gemini-3-flash-preview                                │
│ Static tools: 14  |  Granted tools: 12  |  Registry: 14    │
│ ⚠️ MISMATCH: 2 static tools missing from grants             │
│                                                              │
│ Tool                    Static  Granted  Registry  Last Used │
│ ─────────────────────── ─────── ──────── ──────── ────────── │
│ save_memory             ✅       ✅        ✅       2m ago    │
│ recall_memories         ✅       ✅        ✅       2m ago    │
│ send_agent_message      ✅       ✅        ✅       1h ago    │
│ update_agent_profile    ✅       ❌        ✅       never     │
│ get_agent_profile       ✅       ❌        ✅       never     │
│ web_search              ✅       ✅        ✅       5m ago    │
│ ...                                                          │
│                                                              │
│ Recent Tool Errors (last 24h):                               │
│ ─────────────────────────────────                            │
│ 14:22  update_agent_profile  DENIED (not granted)            │
│ 14:22  request_tool_access   SUCCESS (auto-approved)         │
│ 14:23  update_agent_profile  ERROR: column "reports_to"...   │
│                                                              │
│ Recent "I don't have access" claims (last 24h):              │
│ ─────────────────────────────────                            │
│ 14:22  Chat: "I don't seem to have access to update..."      │
│        → Tool was in static tools but not in grants          │
│        → Agent should have used request_tool_access           │
│        → Root cause: grant baseline stale                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Data sources:**
- Static tools: query agent_activities WHERE activity_type = 'tool_inventory'
- Granted tools: query agent_tool_grants WHERE is_active = true
- Registry: query tool_registry + KNOWN_TOOLS
- Last used: query agent_runs for tool_calls field
- Errors: query activity_log for tool execution errors
- "I don't have access" claims: pattern match on chat_messages

This dashboard shows you EXACTLY which gate is failing for which agent.
No more guessing.

---

## Implementation Priority

### ✅ DONE — Auto-recovery (Hours 1-2):

1. **Tool inventory logging** — companyAgentRunner.ts
   - Logs static tool count per agent at startup
   - Warns if agent has ZERO tools (wiring gap)
   - Logs declared-vs-static mismatch on Turn 1

2. **Auto-grant-and-retry in toolExecutor.ts**
   - When a KNOWN tool is not granted, auto-grant and retry
   - No longer returns "Not granted" to the model for known tools
   - Only denies truly unknown tools (not in KNOWN_TOOLS or tool_registry)
   - Invalidates cache after auto-grant

3. **Auto-sync grants from static tools on startup**
   - On every agent run, bulk-inserts all static tools into agent_tool_grants
   - Uses INSERT ... ON CONFLICT DO NOTHING (preserves existing grants)
   - Fire-and-forget (non-blocking, best-effort)

4. **Auto-sync static tools to agent_tool_grants on execute** (toolExecutor.ts)
   - When a static tool is executed, checks if DB grant exists
   - If missing, auto-inserts grant (fire-and-forget)

### Remaining — Dashboard (Day 2):

5. Tool health dashboard (ToolHealth.tsx)
   - Per-agent tool inventory with status across all gates
   - Recent errors and denials
   - Pattern detection

---

## Root Cause Summary

| Symptom | Most Likely Gate | Fix |
|---------|-----------------|-----|
| "I don't have access to X" | Gate 1 (not in static tools) or Gate 4 (not granted) | Auto-sync grants from static tools + auto-recovery in toolExecutor |
| Tool exists but agent never calls it | Gate 2 (not declared to LLM) or model behavior | Log declared tools per model call, verify schema validity |
| Tool called but silently fails | Gate 8 (execution error) | Structured error handling, parameter echo, error logging |
| Tool works sometimes, fails other times | Gate 5 (cache) or Gate 7 (rate limit/budget) | Redis-based cache, budget monitoring |
| Agent requests access but gets "ask CTO" | Gate 3 (not in registry) | Auto-registry sync from static tools |
| Agent self-grants but doesn't retry | Self-recovery protocol failure | Move recovery to toolExecutor (system level, not agent level) |

The single highest-impact fix is: **auto-grant-and-retry in toolExecutor.ts**.
This eliminates the entire class of "agent says I don't have access" by making
recovery invisible to the model. The model never sees the denial. It just gets
the tool result.

---

## Interaction With Other Documents

- **cursor-fix-agent-lying.md**: That doc fixes agents claiming they did things
  they didn't. This doc fixes agents failing to do things they should be able to.
  Both are tool pipeline problems but at different stages.

- **cursor-all-department-tools.md**: That doc adds ~297 new tools across all
  departments. Without the pipeline fixes in THIS doc, those new tools will hit
  the same failures. This doc must be implemented FIRST or IN PARALLEL.

- **cursor-design-team-tools.md**: Same — 50+ new design tools are useless if
  the pipeline that delivers them to agents is broken.

---

## Files Modified

| File | Change |
|------|--------|
| packages/agent-runtime/src/toolExecutor.ts | Auto-grant-and-retry, structured error logging, grant check logging |
| packages/agent-runtime/src/toolRegistry.ts | Auto-registry sync from static tools on startup |
| packages/agent-runtime/src/companyAgentRunner.ts | Tool inventory logging on startup, declared-vs-static mismatch logging |
| packages/dashboard/src/pages/ToolHealth.tsx | NEW — tool health dashboard |
| packages/scheduler/src/server.ts | Expose tool health API endpoints |

---

## The Point

You can write 297 new tools. You can spec Figma integration, Mailchimp campaigns,
Storybook visual regression, and product analytics. None of it matters if the
pipeline between "tool exists in code" and "tool executes successfully when an agent
needs it" has 8 gates where things silently fail.

Fix the pipeline. Then add the tools. Or fix them in parallel — but the pipeline
fix must land first or simultaneously, because every new tool you add will hit the
same broken gates.