# Server-Side Compaction — Implementation Guide

> Replaces client-side `compressHistory` + `sanitizeToolPairs` with native provider-managed context compaction. Eliminates the tool_call split bug class entirely for OpenAI and Anthropic paths.

---

## Problem Being Solved

`historyManager.ts` uses `.slice(1)` to trim conversation turns when the 8000-token budget is exceeded during on-demand chat sessions. This is structurally unaware — it can split tool_call/tool_result pairs, orphan reasoning chains, and lose the original user intent. The `sanitizeToolPairs` fix patches one symptom (count parity) but the underlying approach of treating structured conversations as flat token streams remains fragile.

Both OpenAI (Responses API) and Anthropic (Messages API) now offer server-side compaction that handles this natively. The provider understands its own message format, knows which units are atomic, and generates a summary that preserves state needed for continuation.

---

## Scope

Compaction applies ONLY to the **on-demand chat path** — `CompanyAgentRunner` handling founder conversations via dashboard or Teams bot. It does NOT apply to scheduled/heartbeat runs (OrchestratorRunner, TaskRunner) because those get fresh context each cycle from `jitContextRetriever` and `workingMemoryLoader` — they don't accumulate multi-turn history.

---

## OpenAI — `packages/agent-runtime/src/providers/openai.ts`

OpenAI compaction works through the Responses API, which `OpenAIAdapter` already uses for GPT-5 routing.

### Request changes

Add `context_management` to the Responses API request body when the run source is `on_demand`:

```typescript
// In OpenAIAdapter.generate(), when building the Responses API request:

const requestBody: any = {
  model: request.model,
  input: mappedInput,
  tools: mappedTools,
  // ... existing fields (reasoning_effort, previous_response_id, etc.)
};

// Enable compaction for chat sessions only
if (request.source === 'on_demand') {
  requestBody.context_management = [
    { type: 'compaction', compact_threshold: 6000 }
  ];
}
```

The `compact_threshold` of 6000 tokens triggers compaction before hitting the 8000-token budget, giving headroom for the summary itself. Tune this up or down based on observed behavior.

### Response handling

When compaction fires, the response output includes a compaction item alongside normal content. The compaction item is an **encrypted opaque blob** — you can't read it, just pass it forward.

```typescript
// In the response parsing section of OpenAIAdapter.generate():

// After processing response.output items into UnifiedModelResponse:
for (const item of response.output) {
  if (item.type === 'compaction') {
    // Flag that compaction occurred for logging
    result.compactionOccurred = true;
    // The compaction item is already in response.output —
    // it gets appended to conversation history naturally
    // via the existing output → chat_messages persistence flow
  }
}
```

### Conversation history persistence

The key behavior: on the next API call, pass the full conversation including the compaction item. The API automatically drops all items before the most recent compaction item. This means your `chat_messages` table accumulates messages as normal, and when you load history for the next turn, the compaction item acts as a boundary marker — everything before it is ignored server-side even if you send it.

**Optimization:** After a compaction item appears in the response, you can optionally prune `chat_messages` rows older than the compaction point to save DB storage. This is optional — the API handles it either way — but keeps the table clean for long sessions.

```typescript
// Optional: in companyAgentRunner.ts after receiving a compaction response
if (result.compactionOccurred) {
  // Find the compaction item's position in the conversation
  // Delete chat_messages rows before it (or mark them as compacted)
  await db.query(`
    UPDATE chat_messages 
    SET compacted = true 
    WHERE conversation_id = $1 
      AND created_at < $2
  `, [conversationId, compactionTimestamp]);
}
```

### What NOT to change

- `previous_response_id` chaining: if you're using this, the docs say do NOT manually prune. Let the API handle it.
- Scheduled/heartbeat runs: no `context_management` field. These don't use multi-turn chat history.
- The existing `mapConversation` logic for OpenAI: keep it as-is for building the initial input array. Compaction happens server-side after mapping.

---

## Anthropic — `packages/agent-runtime/src/providers/anthropic.ts`

Anthropic compaction works through the Messages API with a beta header. Your `AnthropicAdapter` uses the `@anthropic-ai/vertex-sdk` (`AnthropicVertex`) for Vertex AI on GCP.

### Request changes

Add `context_management` to the Messages API request and include the beta header:

```typescript
// In AnthropicAdapter.generate(), when building the request:

const requestParams: any = {
  model: request.model,
  max_tokens: 16384,
  messages: mappedMessages,
  tools: mappedTools,
  // ... existing fields (thinking, effort, etc.)
};

// Enable compaction for chat sessions only
if (request.source === 'on_demand') {
  requestParams.context_management = {
    edits: [
      {
        type: 'compact_20260112',
        trigger: { type: 'input_tokens', value: 6000 }
      }
    ]
  };
}

// Add beta header to the client call
const response = await this.client.beta.messages.create({
  betas: ['compact-2026-01-12'],
  ...requestParams,
});
```

**Vertex AI note:** Verify that the `@anthropic-ai/vertex-sdk` supports the `beta.messages.create` path with the compaction beta. If not, you may need to pass the beta flag as a header via the SDK's request options. The Bedrock docs confirm compaction works there with `anthropic_beta: ["compact-2026-01-12"]` in the request body, so Vertex should support the equivalent.

### Response handling

Unlike OpenAI's encrypted blob, Anthropic returns a **readable compaction block** with the summary text. This is useful for debugging and audit logging.

```typescript
// In the response parsing section of AnthropicAdapter.generate():

for (const block of response.content) {
  if (block.type === 'compaction') {
    // Readable summary — log it for observability
    result.compactionOccurred = true;
    result.compactionSummary = block.content;  // human-readable summary text
    
    // The compaction block gets appended to conversation history
    // as part of the assistant response content.
    // On the next call, the API drops all messages before this block.
  }
}
```

### Tool use during compaction

This is the specific fix for the bug you patched. From Anthropic's docs: when compaction is triggered while a tool use response is pending, the SDK removes the tool_use block from the message history before generating the summary. Claude will re-issue the tool call after resuming from the summary if still needed. This means tool_call/tool_result pairing is handled natively — no more orphaned pairs from client-side slicing.

### pause_after_compaction option

Anthropic offers a `pause_after_compaction: true` flag that returns `stop_reason: "compaction"` instead of continuing. This lets you preserve specific recent messages after the compaction block:

```typescript
// Optional: if you want to control what survives compaction
{
  type: 'compact_20260112',
  trigger: { type: 'input_tokens', value: 6000 },
  pause_after_compaction: true  // returns immediately after compacting
}

// Then in response handling:
if (response.stop_reason === 'compaction') {
  const compactionBlock = response.content[0];
  
  // Rebuild message list: compaction summary + last N messages
  const preserved = messages.slice(-2);  // keep last user+assistant exchange
  messages = [
    { role: 'assistant', content: [compactionBlock] },
    ...preserved,
    // Re-send the current user message to get the actual response
  ];
  
  // Make a second API call with the compacted context
  const actualResponse = await this.client.beta.messages.create({
    betas: ['compact-2026-01-12'],
    ...requestParams,
    messages,
  });
}
```

This adds one extra API call when compaction fires but gives you precise control. For most cases, the default behavior (compact and continue in one call) is fine. Use `pause_after_compaction` only if you find the default summary is dropping recent context you need.

---

## What to do with `historyManager.ts`

### Keep for Gemini fallback

Google doesn't have compaction yet. Your agents rarely route to Gemini for on-demand chat (it's used for grounded research and visual analysis), but if it happens, you still need client-side trimming.

Refactor `compressHistory` into a Gemini-only fallback with structural awareness:

```typescript
// historyManager.ts — simplified, Gemini-only path

function compressHistoryStructural(
  turns: ConversationTurn[], 
  tokenBudget: number
): ConversationTurn[] {
  // Step 1: Group turns into atomic units
  const groups = groupTurns(turns);
  // A group = tool_call + all matching tool_results, OR a standalone user/assistant turn
  
  // Step 2: Calculate tokens per group
  let totalTokens = groups.reduce((sum, g) => sum + g.tokenCount, 0);
  
  // Step 3: Evict oldest groups (but never the first user message or last 2 groups)
  const pinned = new Set([0, groups.length - 1, groups.length - 2]);
  let i = 1;  // start after first group
  while (totalTokens > tokenBudget && i < groups.length - 2) {
    if (!pinned.has(i)) {
      totalTokens -= groups[i].tokenCount;
      groups[i].evicted = true;
    }
    i++;
  }
  
  // Step 4: Flatten surviving groups back to turns
  return groups.filter(g => !g.evicted).flatMap(g => g.turns);
}

function groupTurns(turns: ConversationTurn[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let i = 0;
  while (i < turns.length) {
    if (turns[i].role === 'tool_call') {
      // Collect all consecutive tool_calls + their tool_results as one group
      const group: ConversationTurn[] = [];
      while (i < turns.length && turns[i].role === 'tool_call') {
        group.push(turns[i++]);
      }
      while (i < turns.length && turns[i].role === 'tool_result') {
        group.push(turns[i++]);
      }
      groups.push({ turns: group, tokenCount: countTokens(group) });
    } else {
      groups.push({ turns: [turns[i]], tokenCount: countTokens([turns[i]]) });
      i++;
    }
  }
  return groups;
}
```

### Keep `sanitizeToolPairs` as defense in depth

The existing fix stays in `mapConversation` for all providers. It should never fire for OpenAI/Anthropic once compaction is active, but if it does, log a warning — that means something upstream broke:

```typescript
// In mapConversation, after sanitizeToolPairs runs:
if (pairsRemoved > 0) {
  console.warn(
    `[${provider}] sanitizeToolPairs removed ${pairsRemoved} orphaned pairs — ` +
    `compaction should have prevented this. Investigate.`
  );
}
```

### Remove from OpenAI/Anthropic paths

In `companyAgentRunner.ts`, the call to `compressHistory` should be gated by provider:

```typescript
// Before building the conversation for the model call:
const provider = detectProvider(effectiveModel);

if (provider === 'gemini') {
  // Gemini has no server-side compaction — use client-side structural trimming
  conversationTurns = compressHistoryStructural(conversationTurns, 8000);
} 
// OpenAI and Anthropic: skip client-side trimming entirely.
// Server-side compaction handles it via context_management in the request.
```

---

## Passing `source` to provider adapters

The adapters need to know whether this is an `on_demand` chat (enable compaction) or a scheduled/heartbeat run (skip it). The `source` field needs to flow through `ModelClient.generate()` to the provider adapter.

### Option A: Add to the existing request interface

```typescript
// In packages/agent-runtime/src/providers/types.ts (ProviderAdapter interface):

interface GenerateRequest {
  model: string;
  messages: ConversationTurn[];
  tools?: ToolDefinition[];
  // ... existing fields
  source?: 'on_demand' | 'scheduled' | 'heartbeat' | 'wake' | 'a2a';  // NEW
}
```

The `companyAgentRunner.ts` already knows the source (it's in the `ClassifiedRunDependencies`). Thread it through to `ModelClient.generate()`:

```typescript
// In companyAgentRunner.ts, when calling modelClient.generate():
const response = await this.modelClient.generate({
  model: effectiveModel,
  messages: conversation,
  tools: effectiveTools,
  source: this.runContext.source,  // NEW: passes through to adapter
  // ... existing fields
});
```

### Option B: Feature flag on ModelClient

If you don't want to thread source through the whole chain, add a simpler flag:

```typescript
const response = await this.modelClient.generate({
  // ... existing fields
  enableCompaction: this.runContext.source === 'on_demand',  // boolean flag
});
```

Option A is cleaner long-term. Option B is faster to ship.

---

## Database changes

### Required

```sql
-- Track compaction events for observability
ALTER TABLE chat_messages ADD COLUMN compacted BOOLEAN DEFAULT FALSE;
ALTER TABLE agent_runs ADD COLUMN compaction_count INT DEFAULT 0;
```

### Optional (for cleanup)

```sql
-- Periodic cleanup of compacted messages older than 7 days
-- Run as a scheduled job or add to dataSyncScheduler
DELETE FROM chat_messages 
WHERE compacted = true 
  AND created_at < NOW() - INTERVAL '7 days';
```

---

## Dashboard visibility

Add a small indicator in `Chat.tsx` when compaction occurs during a conversation:

```typescript
// In Chat.tsx, when rendering assistant messages:
{message.compactionOccurred && (
  <div className="text-xs text-zinc-500 italic mt-1">
    Context summarized — earlier messages compressed
  </div>
)}
```

This is optional polish but helps founders understand why the conversation feels "reset" after a compaction event.

---

## Testing

### Verify compaction fires

1. Open dashboard chat with any agent (on_demand path)
2. Have a long back-and-forth conversation with tool calls (10+ turns)
3. Watch for compaction block in the response (Anthropic: readable summary, OpenAI: opaque item)
4. Verify the conversation continues coherently after compaction
5. Check `agent_runs.compaction_count` incremented

### Verify tool pairs survive

1. Chat with an agent that uses tools heavily (Sarah with research, Nathan with account lookups)
2. Push past the 6000-token trigger point
3. Verify no Anthropic 400 errors from orphaned tool_use IDs
4. Verify no fabricated `call_*` IDs in the mapped conversation
5. Check `sanitizeToolPairs` warning log does NOT fire

### Verify scheduled runs unaffected

1. Confirm `ops-health-check` (every 10 min) runs normally without compaction overhead
2. Confirm `cos-briefing-kristina` runs normally
3. Check `agent_runs` for these runs: `compaction_count` should be 0

---

## Rollout plan

1. **Ship behind feature flag** — `COMPACTION_ENABLED=true` env var in GCP Secret Manager. Default off.
2. **Enable for Anthropic first** — Claude paths are where the bug surfaced. Verify for 48 hours.
3. **Enable for OpenAI** — GPT-5-mini is the default model, so this covers ~80% of chat sessions. Verify for 48 hours.
4. **Remove `compressHistory` from OpenAI/Anthropic paths** — once confident, gate it to Gemini-only.
5. **Clean up** — remove the feature flag, make compaction the default for on_demand + OpenAI/Anthropic.

---

## Summary of changes

| File | Change | Lines (est.) |
|------|--------|-------------|
| `providers/openai.ts` | Add `context_management` to Responses API request for on_demand; handle compaction item in response | ~15 |
| `providers/anthropic.ts` | Add `context_management` + beta header to Messages API request for on_demand; handle compaction block in response | ~20 |
| `providers/types.ts` | Add `source` field to `GenerateRequest` interface | ~2 |
| `companyAgentRunner.ts` | Thread `source` to `modelClient.generate()`; gate `compressHistory` to Gemini-only | ~10 |
| `historyManager.ts` | Refactor `compressHistory` to structural grouping (Gemini fallback only); add warning log to `sanitizeToolPairs` | ~40 |
| `Chat.tsx` | Optional compaction indicator | ~5 |

Total: ~90 lines changed across 6 files. No new packages. No new services. No new database tables (2 optional column additions for observability).
