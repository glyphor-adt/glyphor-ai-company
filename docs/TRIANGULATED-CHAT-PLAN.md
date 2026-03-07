# Triangulated Chat — Implementation Plan

Build a multi-model triangulated chat feature for the Glyphor AI Cockpit dashboard. Every user query fans out to Claude Opus 4.6, Gemini 3.1 Pro, and GPT-5.4 in parallel, then a judge model (Claude Sonnet 4.6) scores all three responses and picks the best one with a confidence score.

## Architecture Context

This is a monorepo at `glyphor-ai-company/`. The existing codebase already has:

- **`packages/agent-runtime/src/modelClient.ts`** — Multi-provider LLM facade. Call `modelClient.generate({ model, messages, systemPrompt, maxOutputTokens, tools, thinking, thinkingLevel, reasoning_effort })` and it auto-routes to the correct provider adapter via `ProviderFactory`.
- **`packages/agent-runtime/src/providers/geminiAdapter.ts`** — Handles `thinkingLevel` ('LOW'|'MEDIUM'|'HIGH') for Gemini 3.x models, thought signatures, Google Search grounding.
- **`packages/agent-runtime/src/providers/openaiAdapter.ts`** — Handles `reasoning_effort` ('low'|'medium'|'high') for GPT-5.x, web search tool.
- **`packages/agent-runtime/src/providers/anthropicAdapter.ts`** — Uses `@anthropic-ai/vertex-sdk` with GCP IAM auth (region `us-east5`, no API key). Handles `thinking: { type: 'enabled', budget_tokens: N }` for extended thinking.
- **`packages/agent-runtime/src/jitContextRetriever.ts`** — Semantic search across `company_knowledge`, `agent_memory`, `kg_nodes` tables.
- **`packages/agent-runtime/src/contextDistiller.ts`** — Compresses retrieved context into focused briefings via `gemini-3-flash-preview`. Redis-cached.
- **`packages/agent-runtime/src/reasoningEngine.ts`** — Existing multi-pass verification and cross-model consensus (can reference for patterns).
- **`packages/agent-runtime/src/documentExtractor.ts`** — Extracts text from .docx/.pptx/.xlsx uploads.
- **`packages/scheduler/src/server.ts`** — Express server with 60+ endpoints. Add new routes here.
- **`packages/scheduler/src/dashboardApi.ts`** — PostgREST-compatible CRUD for 70+ whitelisted tables.
- **`packages/dashboard/src/pages/Chat.tsx`** — Existing 1:1 agent chat. Do NOT modify this. The triangulated chat is a separate page.
- **`packages/dashboard/src/pages/GroupChat.tsx`** — Existing multi-agent chat. Do NOT modify this either.
- **`packages/dashboard/src/App.tsx`** — React Router with 21 routes. Add new route here.
- **`packages/dashboard/src/components/Layout.tsx`** — Sidebar navigation. Add nav item here.
- **`packages/shared/src/models.ts`** — LLM model definitions and pricing constants.
- **Cloud SQL (PostgreSQL)** with `chat_messages` table: columns `agent_role`, `role` (user|agent), `content`, `user_id`, `created_at`, `attachments` (JSONB), `conversation_id`, `responding_agent`.
- **`agent_runs` table** for run tracking/observability.

Auth: Claude goes through Vertex AI (IAM auth, service account `glyphor-agent-runner` with `roles/aiplatform.user`). Gemini uses `GOOGLE_AI_API_KEY` env var. OpenAI uses `OPENAI_API_KEY` env var. All secrets already in GCP Secret Manager and deployed to Cloud Run.

## Models to Use (March 2026 current)

| Role | Model ID | Provider | Price (input/output per 1M tokens) |
|------|----------|----------|-------------------------------------|
| Primary (streams to UI) | `claude-opus-4-6-20260205` | Anthropic via Vertex AI | $5.00 / $25.00 |
| Validator 1 | `gemini-3.1-pro-preview` | Google AI | $2.00 / $12.00 |
| Validator 2 | `gpt-5.4` | OpenAI | $2.50 / $15.00 |
| Judge | `claude-sonnet-4-6-20260217` | Anthropic via Vertex AI | $3.00 / $15.00 |
| Router (query classifier) | `gemini-3-flash-preview` | Google AI | $0.50 / $3.00 |

**Critical asymmetry:** Gemini 3.1 Pro max output is 64,000 tokens. Claude and GPT support 128,000. Cap Gemini's `maxOutputTokens` accordingly.

---

## Step 1: Shared types and config

Create `packages/shared/src/triangulation.ts`:

Export these types and constants:

```ts
export type QueryTier = 'SIMPLE' | 'STANDARD' | 'DEEP';

export const TRIANGULATION_MODELS = {
  primary: 'claude-opus-4-6-20260205',
  validator1: 'gemini-3.1-pro-preview',
  validator2: 'gpt-5.4',
  judge: 'claude-sonnet-4-6-20260217',
  router: 'gemini-3-flash-preview',
} as const;

export const TRIANGULATION_TIMEOUTS = {
  standard: 30_000,
  deep: 90_000,
  judge: 30_000,
  router: 5_000,
} as const;

export interface ProviderScores {
  accuracy: number;
  completeness: number;
  reasoning: number;
  relevance: number;
  actionability: number;
  total: number;
}

export interface Divergence {
  claim: string;
  providersAgree: string[];
  providerDisagrees: string[];
  likelyCorrect: string;
}

export interface TriangulationResult {
  tier: QueryTier;
  selectedProvider: 'claude' | 'gemini' | 'openai';
  selectedResponse: string;
  confidence: number;
  consensusLevel: 'high' | 'moderate' | 'low' | 'n/a';
  reasoning: string;
  scores: Record<string, ProviderScores | null>;
  divergences: Divergence[];
  allResponses: Record<string, string>;
  cost: { perProvider: Record<string, number>; total: number };
  latencyMs: Record<string, number>;
}
```

Add pricing entries to `packages/shared/src/models.ts` for the 5 models listed above if not already present. Format: `{ input: N, output: N }` per 1M tokens.

Export from `packages/shared/src/index.ts`.

---

## Step 2: Query router

Create `packages/agent-runtime/src/triangulation/queryRouter.ts`.

This classifies incoming messages as SIMPLE, STANDARD, or DEEP using the cheapest model (Gemini Flash). Use the existing `ModelClient` — do not create new HTTP clients.

```ts
import { ModelClient } from '../modelClient';
import type { QueryTier } from '@glyphor/shared';

const ROUTER_PROMPT = `You are a query complexity classifier.
SIMPLE — Greetings, single-fact lookups, clarifications.
STANDARD — Analysis, research, content generation, substantive questions.
DEEP — Multi-step reasoning, strategic analysis, financial modeling, critical decisions.
Respond with ONLY: SIMPLE, STANDARD, or DEEP.`;

export async function classifyQuery(
  message: string,
  modelClient: ModelClient,
  overrides?: { forceDeep?: boolean; forceTriangulation?: boolean }
): Promise<QueryTier> {
  if (overrides?.forceDeep) return 'DEEP';
  if (overrides?.forceTriangulation) return 'STANDARD';
  try {
    const result = await modelClient.generate({
      model: 'gemini-3-flash-preview',
      messages: [{ role: 'user', content: message }],
      systemPrompt: ROUTER_PROMPT,
      maxOutputTokens: 10,
    });
    const tier = result.text.trim().toUpperCase();
    return ['SIMPLE', 'STANDARD', 'DEEP'].includes(tier) ? tier as QueryTier : 'STANDARD';
  } catch {
    return 'STANDARD';
  }
}
```

---

## Step 3: Parallel fan-out

Create `packages/agent-runtime/src/triangulation/fanOut.ts`.

Calls all 3 models in parallel using existing `ModelClient`. Each gets identical system prompt and RAG context.

```ts
export interface ProviderResponse {
  provider: 'claude' | 'gemini' | 'openai';
  text: string;
  latencyMs: number;
  tokenUsage: { input: number; output: number; thinking: number };
  status: 'success' | 'error';
  error?: string;
}
```

Implementation:

1. Build 3 `modelClient.generate()` calls with model IDs from `TRIANGULATION_MODELS`.
2. For each, pass the same `systemPrompt` (with RAG context appended) and `messages`.
3. Configure thinking per tier per provider:
   - `STANDARD` tier: no extended thinking on any provider.
   - `DEEP` tier:
     - Claude: `thinking: { type: 'enabled', budget_tokens: 20000 }`
     - Gemini: `thinkingLevel: 'HIGH'`
     - OpenAI: `reasoning_effort: 'high'`
   - These are existing fields on the `ModelClient.generate()` request object — the adapters already handle them.
4. Cap Gemini's `maxOutputTokens` at `Math.min(requestedMax, 64000)`.
5. Wrap each in a timeout via `AbortController` + `setTimeout`. Use `TRIANGULATION_TIMEOUTS.standard` or `.deep` based on tier.
6. Execute all 3 with `Promise.allSettled()`.
7. Map results: fulfilled → extract text + token usage from `UnifiedModelResponse`. Rejected → error response.

For web search: if `enableWebSearch` is true, add the appropriate tool to each provider's request. Claude uses `{ type: 'web_search_20250305', name: 'web_search' }` in `tools`. Gemini uses Google Search grounding. OpenAI uses `{ type: 'web_search_preview' }`. Check how each adapter currently handles search tools and follow the same pattern.

For attachments (images/PDFs): the adapters handle multimodal differently. Build the message content array per provider:
- Claude: `[{ type: 'image', source: { type: 'base64', media_type, data } }, { type: 'text', text: query }]`
- Gemini: `parts: [{ inlineData: { mimeType, data } }, { text: query }]`
- OpenAI: `[{ type: 'image_url', image_url: { url: 'data:mime;base64,data' } }, { type: 'text', text: query }]`

For PDFs on OpenAI (which doesn't support native PDF): use `documentExtractor.ts` to extract text server-side and inject as text content instead.

---

## Step 4: Judge scoring

Create `packages/agent-runtime/src/triangulation/judge.ts`.

Sends all 3 responses to Claude Sonnet 4.6 for evaluation. Uses `ModelClient.generate()` with model `claude-sonnet-4-6-20260217`.

Judge system prompt (include this verbatim in the file):

```
You are a response quality evaluator. You receive a user query and three AI responses labeled A, B, C.

1. Score each response (0-100) on: accuracy, completeness, reasoning, relevance, actionability.
2. Identify divergences where responses disagree on specific claims.
3. Select the best response.
4. Assign confidence (0-100): all agree = 85-100, 2 of 3 agree = 60-84, all disagree = 30-59.

Respond in JSON only (no markdown fences):
{
  "selected": "A" | "B" | "C",
  "confidence": <0-100>,
  "consensus_level": "high" | "moderate" | "low",
  "reasoning": "<why>",
  "scores": {
    "A": { "accuracy": N, "completeness": N, "reasoning": N, "relevance": N, "actionability": N, "total": N },
    "B": { ... }, "C": { ... }
  },
  "divergences": [
    { "claim": "<claim>", "agree": ["A","B"], "disagree": ["C"], "likely_correct": "<assessment>" }
  ]
}
```

The user prompt for the judge call:

```
## User Query
{original query}

## Response A (Claude Opus 4.6)
{claude response or "[UNAVAILABLE]" if that provider failed}

## Response B (Gemini 3.1 Pro)
{gemini response or "[UNAVAILABLE]"}

## Response C (GPT-5.4)
{openai response or "[UNAVAILABLE]"}

Evaluate now.
```

Map A→claude, B→gemini, C→openai when building the result.

Fallback logic (critical — do not skip):
- If judge returns valid JSON → use it.
- If JSON parse fails → return claude's response, confidence=55, consensusLevel='moderate'.
- If judge call fails entirely → same fallback.
- If only 1 provider succeeded → return that response, confidence=50, no judge call needed.
- If 0 providers succeeded → throw error (caller handles).

---

## Step 5: Cost calculator

Create `packages/agent-runtime/src/triangulation/costCalculator.ts`.

Import pricing from `@glyphor/shared/models`. For each provider response, calculate:
```
cost = (inputTokens / 1_000_000) * pricing.input
     + ((outputTokens + thinkingTokens) / 1_000_000) * pricing.output
```

Thinking tokens are billed as output tokens on all 3 providers. Sum router + 3 providers + judge for total.

---

## Step 6: RAG context builder

Create `packages/agent-runtime/src/triangulation/ragContext.ts`.

Wraps existing `jitContextRetriever.ts` and `contextDistiller.ts`. Runs ONCE before fan-out. Result gets appended to system prompt for all 3 providers identically.

```ts
export async function buildTriangulationContext(
  query: string,
  db: Pool,
  redisCache: RedisCache,
  modelClient: ModelClient,
): Promise<{ contextBlock: string; totalTokens: number }>
```

1. Call `jitContextRetriever.retrieve()` with the query. This searches `company_knowledge`, `agent_memory`, `kg_nodes` using pgvector embeddings.
2. If result exceeds ~4000 tokens, call `contextDistiller.distill()` to compress.
3. Format as: `--- INTERNAL KNOWLEDGE ---\n[Source 1: ...]\ncontent\n[Source 2: ...]\ncontent\n--- END ---`
4. Return the block + token count.
5. If retrieval fails or returns nothing, return `{ contextBlock: '', totalTokens: 0 }`.

---

## Step 7: Main orchestrator

Create `packages/agent-runtime/src/triangulation/orchestrator.ts`.

Wires steps 2-6 together:

```ts
export async function triangulate(
  message: string,
  options: {
    systemPrompt: string;
    enableWebSearch?: boolean;
    enableDeepThinking?: boolean;
    enableInternalSearch?: boolean;
    attachments?: Array<{ name: string; mimeType: string; base64: string }>;
    maxOutputTokens?: number;
    onChunk?: (text: string) => void; // for streaming primary model
  },
  deps: { modelClient: ModelClient; db: Pool; redisCache: RedisCache }
): Promise<TriangulationResult>
```

Flow:
1. `classifyQuery(message, deps.modelClient, { forceDeep: options.enableDeepThinking })` → tier
2. If `enableInternalSearch`: `buildTriangulationContext(message, deps.db, deps.redisCache, deps.modelClient)` → contextBlock
3. Build full system prompt = `options.systemPrompt + contextBlock`
4. If tier is `SIMPLE`: call only `modelClient.generate()` with `TRIANGULATION_MODELS.primary`. Return result with confidence=75, consensusLevel='n/a', no scores, no divergences.
5. If tier is `STANDARD` or `DEEP`: `fanOut(message, systemPrompt, tier, deps.modelClient, options)` → 3 ProviderResponses
6. `runJudge(message, responses, deps.modelClient)` → scored result
7. `calculateCost(routerUsage, responses, judgeUsage)` → cost breakdown
8. Assemble and return `TriangulationResult`

Create `packages/agent-runtime/src/triangulation/index.ts` as barrel export for everything in this directory.

---

## Step 8: SSE streaming endpoint

Create `packages/scheduler/src/triangulationEndpoint.ts`.

Add route in `packages/scheduler/src/server.ts`:
```ts
import { handleTriangulatedChat } from './triangulationEndpoint';
app.post('/chat/triangulate', handleTriangulatedChat);
```

The endpoint handler:

```ts
export async function handleTriangulatedChat(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const { message, features, attachments, conversationId, userId } = req.body;
  // features: { deepThinking?: boolean, webSearch?: boolean, internalSearch?: boolean }
```

SSE events to emit (format: `data: JSON\n\n`):
- `{ type: 'tier', tier: 'STANDARD' }` — immediately after classification
- `{ type: 'chunk', text: '...' }` — each streamed token from primary model
- `{ type: 'provider_complete', provider: 'gemini' }` — when each validator finishes
- `{ type: 'judge_start' }` — when judge evaluation begins
- `{ type: 'result', data: TriangulationResult }` — final result
- `{ type: 'error', message: '...' }` — on failure

For streaming Claude: the `AnthropicAdapter` supports streaming via Vertex SDK. When calling `modelClient.generate()` for the primary model, pass the `onChunk` callback from the orchestrator. Inside the adapter, use `stream: true` on the Anthropic API call and emit `content_block_delta` events as `{ type: 'chunk' }` SSE events through the response.

If streaming isn't straightforward through ModelClient, an alternative: call the primary model non-streaming but emit the full response as one large chunk once it arrives. Then emit the validators and judge results. This is simpler but users won't see text appear incrementally.

**Persist messages** after triangulation completes:
1. Save user message to `chat_messages` (role='user', agent_role='intelligence', conversation_id, user_id).
2. Save agent response to `chat_messages` (role='agent', agent_role='intelligence', content=selectedResponse, conversation_id).
3. Add a `metadata` JSONB column to `chat_messages` if it doesn't exist: `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;`
4. Store the full `TriangulationResult` in `metadata` so the frontend can render the confidence panel on historical messages.
5. Log to `agent_runs` table: agent_role='intelligence', task='triangulated_chat', cost/tokens/duration from the result.

Default system prompt for the triangulated chat:
```
You are Eaton Strategic Intelligence, an AI research and analysis assistant for Glyphor.
You have access to internal company knowledge, financial data, competitive intelligence,
and strategic analysis. Provide accurate, well-sourced responses. When using internal
knowledge, cite sources by number. Be direct and actionable.
```

---

## Step 9: Dashboard chat page

Create `packages/dashboard/src/pages/IntelligenceChat.tsx`.

This is a new page at route `/intelligence`. Do NOT modify `Chat.tsx` or `GroupChat.tsx`.

**Basic structure:**
- Full-height flex column: header, scrollable message area, input area
- Message list with auto-scroll (useRef + scrollIntoView on new messages)
- User bubbles right-aligned, assistant bubbles left-aligned
- Textarea input: Enter sends, Shift+Enter newlines, auto-resize up to 160px

**Feature toggle bar** between messages and input:
- 3 pill buttons: Deep Thinking (red when on, clock icon), Web Search (cyan when on, search icon), Knowledge Base (green when on, database icon, **default ON**)
- File upload button (paperclip icon) — opens file picker for `image/*,.pdf,.txt,.csv,.docx,.xlsx`
- Paste handler on textarea: detect `image/*` clipboard items, add to attachments
- Attachment preview chips above input with ✕ remove buttons

**SSE consumer:**
```ts
const response = await fetch(`${import.meta.env.VITE_SCHEDULER_URL}/chat/triangulate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: input, features, attachments, conversationId, userId }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  // Split on double newlines, parse each "data: {...}" line
  // Handle each event type: tier, chunk, provider_complete, judge_start, result, error
}
```

**Streaming state:** Track via `useState<'idle' | 'streaming' | 'validating' | 'evaluating' | 'complete'>`.
- `streaming`: show pulsing dots below message, append chunks to message content
- `validating`: show checkmarks as validators complete ("✓ Gemini" "✓ GPT-5.4")
- `evaluating`: show spinner "Triangulating responses..."
- `complete`: show the TriangulationPanel

**History:** Load existing messages from `chat_messages` where `agent_role='intelligence'` on page mount. Use the existing dashboard API pattern: `GET ${SCHEDULER_URL}/api/chat-messages?agent_role=eq.intelligence&conversation_id=eq.${id}&order=created_at.asc`.

**Triangulation panel** (render below each assistant message where `metadata?.tier !== 'SIMPLE'`):
- Collapsed: SVG confidence ring (0-100, cyan/yellow/red), consensus label, cost badge, expand chevron
- Expanded: 3 provider score bars (horizontal, 0-100, selected one in cyan with ★), click to expand 5 dimension scores, divergence cards with yellow left border showing agree/disagree providers
- "View recommended response" toggle — only shows when judge picked a non-Claude provider. Swaps displayed message content between primary and recommended.

Add route in `App.tsx`:
```tsx
<Route path="/intelligence" element={<IntelligenceChat />} />
```

Add nav item in `Layout.tsx` sidebar under the Communications section. Use a distinctive icon (triangles or prism shape) and label "Intelligence".

**Styling:** Use existing Tailwind classes and Glyphor brand tokens from `index.css`. Match the dark/light mode theming already in place. Do not add new CSS files.

---

## Step 10: Migration and deploy

**Database migration** (run manually or via deploy script):
```sql
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
```

**Build verification:**
```bash
npx turbo build  # all 8 packages must succeed
```

**Deploy:** Push to `main` triggers the existing CI/CD pipeline in `.github/workflows/deploy.yml`. No new secrets needed — Claude uses Vertex IAM, Gemini and OpenAI keys already deployed.

**Smoke test after deploy:**
1. Navigate to `/intelligence` in the dashboard
2. Send a simple message ("hi") — should get a fast response with no triangulation panel (SIMPLE tier)
3. Send a substantive question ("Compare Eaton's segment revenue trends over the past 3 quarters") — should stream Claude, show validator checkmarks, show evaluating spinner, then render the triangulation panel with confidence score
4. Enable Deep Thinking and send a complex question — should take longer, show higher confidence
5. Upload an image or PDF — should be processed by all 3 providers
6. Check Operations > Activity Log — should see `intelligence` / `triangulated_chat` entries with cost tracking

---

## Key Constraints

- **Do not modify existing chat pages** (`Chat.tsx`, `GroupChat.tsx`, `Comms.tsx`). The triangulated chat is a new, separate feature.
- **Do not modify `modelClient.ts` or any provider adapter.** Use them as-is through `modelClient.generate()`.
- **Do not create new HTTP clients.** All model calls go through `ModelClient` → `ProviderFactory` → adapter.
- **Do not add new GCP secrets.** Claude uses existing Vertex AI IAM. Gemini and OpenAI use existing env vars.
- **All new backend code goes under `packages/agent-runtime/src/triangulation/`** (the engine) and `packages/scheduler/src/triangulationEndpoint.ts` (the SSE endpoint).
- **All new frontend code goes in `packages/dashboard/src/pages/IntelligenceChat.tsx`** and optionally a `TriangulationPanel.tsx` component.
- **Use `Promise.allSettled`** for parallel model calls — never `Promise.all`. One failure must not kill the others.
- **Every fallback path must be handled.** Router fails → default STANDARD. Provider fails → triangulate with survivors. Judge fails → prefer Claude, confidence=55. All fail → error to UI.
