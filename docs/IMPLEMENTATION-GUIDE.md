# Tool Retriever: Replacing toolSubsets.ts

## The Problem

156 tools assembled across 5 layers, capped to 128 by `toolSubsets.ts`.
The cap uses static priority buckets: pinned core → Agent365 MCP → everything else.
`search_sharepoint` falls in the lowest bucket and gets sliced off.
Even when it survives, models prefer `findFileOrFolder` (Agent365 MCP branding).

Frontier models (GPT-5.4, Claude 4.6) handle tool search natively.
Everything else — Gemini, Sonnet, Haiku, nano models — hits the cap wall.

## The Solution

**RAG for tools.** Semantic retrieval replaces static capping.

```
All 156 tools → Tool2Vec Index → Hybrid BM25+Vector Search → 10-25 relevant tools → Model
```

Every model gets only the tools relevant to the current task.
No more priority buckets. No more 128-cap guillotine.

## Architecture

### Where it lives

```
packages/agent-runtime/src/routing/
├── toolRetriever.ts          ← NEW: core retrieval module
├── capabilityRouter.ts       ← existing model routing
└── toolSubsets.ts            ← DEPRECATED: delete after migration
```

### What it replaces

```
BEFORE (in each agent's run.ts):
  allTools = assemble from 5 layers
  tools = toolSubsets.filterAndCap(allTools, 128)   ← dumb cap
  model.invoke({ tools })

AFTER:
  allTools = assemble from 5 layers                  ← unchanged
  { tools } = retriever.retrieve(taskContext, config) ← smart retrieval
  model.invoke({ tools })
```

### How retrieval works

1. **Tool2Vec Index** — Each tool is embedded NOT by its description, but by
   8 synthetic usage queries ("find the Q3 deck on SharePoint", "search our
   document library for the onboarding guide", etc.). The average of these
   query embeddings becomes the tool's vector. This puts `search_sharepoint`
   in the same semantic neighborhood as the tasks that need it.

2. **Hybrid Search** — For each agent turn:
   - BM25 catches exact keyword matches ("SharePoint" → `search_sharepoint`)
   - Vector cosine catches semantic matches ("find the file" → `search_sharepoint`)
   - Reciprocal Rank Fusion combines both ranked lists

3. **Pinned Tools** — Department-specific tools that bypass search entirely.
   Marketing always gets `search_sharepoint`. Finance always gets `revenue_lookup`.
   Core tools (`memory_recall`, `send_message`, etc.) are always included.

4. **Model-Aware Caps** — Different models get different tool budgets:

   | Model              | Cap | Notes                           |
   |--------------------|-----|---------------------------------|
   | GPT-5.4            | 128 | + native tool search            |
   | Claude Opus 4.6    | 128 | + native tool search (deferred) |
   | Claude Sonnet 4.6  | 100 | + native tool search (deferred) |
   | GPT-4.1            | 64  |                                 |
   | Gemini 2.5 Pro     | 64  |                                 |
   | GPT-4.1 Mini       | 40  |                                 |
   | Claude Haiku 4.5   | 25  |                                 |
   | GPT-4.1 Nano       | 20  |                                 |

5. **Native Tool Search (safety net)** — For Claude 4.5+/4.6, retrieved tools
   are additionally wrapped with `defer_loading: true` + the BM25 tool search
   tool. If the retriever missed something, the model can discover it natively.

## Setup Steps

### 1. Generate Tool2Vec queries (one-time, ~5 min)

```bash
npx ts-node scripts/generateToolQueries.ts
```

This uses GPT-4.1-mini to generate 8 usage queries per tool.
Output: `tool2vec-queries.json` (or store in `tool_registry.usage_queries`).

Cost: ~156 tools × 8 queries × ~100 tokens = ~125K tokens ≈ $0.02

### 2. Add to tool_registry (optional, recommended)

```sql
ALTER TABLE tool_registry
ADD COLUMN usage_queries JSONB DEFAULT '[]'::jsonb;
```

### 3. Initialize at startup

```typescript
import { initializeToolRetriever } from './routing/toolRetriever';

// In server.ts / main entry point:
const allTools = assembleAllTools();  // your existing assembly
const queries = loadUsageQueriesFromDB(db);
await initializeToolRetriever(allTools, queries);
```

### 4. Replace toolSubsets in each run.ts

```typescript
// Delete this:
const tools = filterAndCapTools(allTools, 128);

// Replace with:
const retriever = getRetriever();
const taskContext = buildTaskContext(lastMessage, role, department);
const { tools, trace } = await retriever.retrieve(taskContext, {
  model: selectedModel,
  department,
  agentRole: role,
});
```

## Debugging

### "Why didn't search_sharepoint show up?"

```typescript
const debug = await retriever.debugToolRetrieval(
  'search_sharepoint',
  'find the Q3 marketing deck'
);
console.log(debug);
// {
//   exists: true,
//   bm25Rank: 2,       ← ranked 2nd in keyword search
//   vectorRank: 1,     ← ranked 1st in semantic search
//   vectorScore: 0.87,
//   bm25Score: 4.2,
// }
```

### Retrieval trace

Every `retrieve()` call returns a trace:

```json
{
  "totalCandidates": 156,
  "pinnedTools": ["memory_recall", "send_message", "search_sharepoint"],
  "retrievedTools": [
    { "name": "upload_to_sharepoint", "score": 0.012, "method": "hybrid" },
    { "name": "findFileOrFolder", "score": 0.011, "method": "vector" },
    { "name": "create_document", "score": 0.009, "method": "bm25" }
  ],
  "modelCap": 64,
  "model": "gemini-2.5-pro"
}
```

## Performance

- **Embedding call**: 1 per agent turn, ~2ms (text-embedding-3-small)
- **BM25 search**: <1ms for 156 documents
- **Vector search**: <1ms brute-force cosine over 156 entries
- **Total overhead**: ~5ms per agent turn
- **Token savings**: 156 tool defs ≈ 50K tokens → 15 tools ≈ 5K tokens = 90% reduction

## Migration Plan

1. Deploy retriever alongside toolSubsets (shadow mode — log what retriever
   would select, but still use toolSubsets for actual calls)
2. Compare: does retriever include tools that toolSubsets dropped?
3. Flip: route through retriever, keep toolSubsets as fallback
4. Remove toolSubsets after 1 week of clean operation

## Why Not Just Use Anthropic's Native Tool Search?

- Only works with Claude models — not GPT, Gemini, or nano models
- Still in beta, ~60% retrieval accuracy per independent testing
- Doesn't solve the root problem: your 156 tools include overlapping
  descriptions that confuse ANY search system without Tool2Vec
- The retriever handles model-agnostic routing AND provides a better
  baseline for native tool search to build on
