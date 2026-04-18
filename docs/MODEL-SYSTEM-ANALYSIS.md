# Glyphor Model System — Full Analysis

**Date:** April 18, 2026
**Status:** 🔴 Multiple critical issues identified

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Active Models](#active-models)
3. [Model Routing Pipeline](#model-routing-pipeline)
4. [Tier System](#tier-system)
5. [Fallback Chain Logic](#fallback-chain-logic)
6. [Deprecated Model Resolution](#deprecated-model-resolution)
7. [Credit-Aware Routing](#credit-aware-routing)
8. [Database State](#database-state)
9. [Issues Found](#issues-found)
10. [Recommended Fixes](#recommended-fixes)

---

## Architecture Overview

The model system spans **4 files** that should be in sync but aren't:

| File | Purpose | Authority |
|------|---------|-----------|
| `packages/shared/src/models.config.ts` | Tier assignments, specialized paths, disabled list | Claims to be "THE ONLY FILE YOU EDIT" |
| `packages/shared/src/models.ts` | Model catalog, fallback chains, deprecated map, verifier map | Actual source of truth for most logic |
| `packages/agent-runtime/src/routing/resolveModel.ts` | Runtime routing decisions (15+ priority rules) | Uses DB `routing_config` table with static fallbacks |
| `packages/dashboard/src/lib/models.ts` | Dashboard dropdown models | **Manually duplicated** — NOT derived from shared |

**Provider routing:**
- **Gemini** → Google AI API (GCP, `GOOGLE_AI_API_KEY`)
- **OpenAI** → Azure AI Foundry (`AZURE_FOUNDRY_API`, `AZURE_FOUNDRY_ENDPOINT`)
- **Anthropic** → AWS Bedrock (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- **DeepSeek** → AWS Bedrock (same credentials as Anthropic)

---

## Active Models

### Gemini (GCP)
| Model ID | Tier | $/1M In | $/1M Out | Selectable | Status |
|----------|------|---------|----------|------------|--------|
| `gemini-3.1-pro-preview` | flagship | $10.00 | $60.00 | ✅ | Active |
| `gemini-3.1-flash-lite-preview` | economy | $1.25 | $7.50 | ✅ | **Workhorse** — default/fast tier |
| `gemini-2.5-flash-lite` | economy | $0.50 | $2.00 | ✅ | Active |
| `gemini-3-flash-preview` | standard | $2.50 | $15.00 | ❌ | Retired (cost), **still in DB routing_config** |
| `gemini-2.5-flash` | standard | $1.50 | $12.50 | ❌ | Retired (cost) |

### OpenAI (Azure Foundry)
| Model ID | Tier | $/1M In | $/1M Out | Selectable | Notes |
|----------|------|---------|----------|------------|-------|
| `gpt-5.4` | flagship | $2.50 | $15.00 | ✅ | Triangulation default |
| `gpt-5.4-pro` | flagship | $30.00 | $180.00 | ✅ | |
| `gpt-5.4-mini` | economy | $0.75 | $4.50 | ✅ | Web search model |
| `model-router` | standard | $0.75 | $4.50 | ✅ | **DEFAULT_AGENT_MODEL** |
| `gpt-5-mini` | economy | $0.25 | $2.00 | ✅ | `gpt-4o` resolves here |
| `gpt-5-nano` | economy | $0.05 | $0.40 | ✅ | Cheapest |
| `o3` | reasoning | $2.00 | $8.00 | ✅ | |
| `o3-pro` | reasoning | $3.00 | $15.00 | ✅ | |
| `o4-mini` | reasoning | $1.10 | $4.40 | ✅ | |
| + 10 more codex/legacy variants | | | | | |

### Anthropic (AWS Bedrock)
| Model ID | Bedrock ID | Tier | $/1M In | $/1M Out | Selectable | Status |
|----------|-----------|------|---------|----------|------------|--------|
| `claude-opus-4-6` | `us.anthropic.claude-opus-4-6` | max | $5.00 | $25.00 | ✅ | Active — `tiers.max` |
| `claude-sonnet-4-6` | `us.anthropic.claude-sonnet-4-6` | standard | $3.00 | $15.00 | ✅ | Active — `tiers.high` |
| `claude-sonnet-4-5` | `us.anthropic.claude-sonnet-4-5` | standard | $3.00 | $15.00 | ❌ | 🔴 **DEPRECATED but still in fallback chains, dashboard, and OraChat** |
| `claude-haiku-4-5` | `us.anthropic.claude-haiku-4-5` | economy | $1.00 | $5.00 | ❌ | 🔴 **RETIRED but still in models.config.ts as `reflection` model and in dashboard** |

### DeepSeek (AWS Bedrock)
| Model ID | Bedrock ID | Tier | $/1M In | $/1M Out | Selectable |
|----------|-----------|------|---------|----------|------------|
| `deepseek-r1` | `us.deepseek.r1-v1:0` | reasoning | $0.58 | $1.68 | ✅ |
| `deepseek-v3-2` | `deepseek.v3.2` | code | $0.58 | $1.68 | ✅ |

---

## Model Routing Pipeline

When an agent runs a task, the model is selected through this pipeline:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Agent's DB model (company_agents.model)                             │
│    e.g. "gpt-4o"                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. resolveModel() — DEPRECATED_MODELS lookup                           │
│    "gpt-4o" → "gpt-5-mini"                                            │
│    ⚠️  ONLY runs on PRIMARY model, NOT on fallback chain entries       │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. Subtask Router — classifies complexity                              │
│    trivial / standard / complex / frontier                             │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. resolveModelConfig() — 17 priority rules                            │
│    Uses DB routing_config OR static defaults                           │
│    Can escalate to different tier based on capabilities                 │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. selectSubtaskModel() — complexity override                          │
│    frontier → HIGH_MODEL (claude-sonnet-4-6)                           │
│    code_edit → CODE_MODEL (deepseek-v3-2)                              │
├─────────────────────────────────────────────────────────────────────────┤
│ 6. Credit-aware routing — checks cloud credit balances                 │
│    May swap provider: AWS → Azure → GCP based on remaining $           │
├─────────────────────────────────────────────────────────────────────────┤
│ 7. ModelClient.generate() — builds modelsToTry array                   │
│    [primary, ...FALLBACK_CHAINS[primary]]                              │
│    ⚠️  Fallback entries are NOT run through resolveModel()             │
│    ⚠️  Disabled/deprecated models in chains → passed raw to providers  │
├─────────────────────────────────────────────────────────────────────────┤
│ 8. Provider adapter — maps to actual API                               │
│    Claude models: getBedrockInferenceId() → bedrockId or raw string    │
│    ⚠️  Missing bedrockId → raw string sent to Bedrock → 400 error     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tier System

Defined in `models.config.ts`:

| Tier | Model | Provider | When Used |
|------|-------|----------|-----------|
| `fast` | `gemini-3.1-flash-lite-preview` | GCP | Heartbeat, memory writes, classification |
| `default` | `gemini-3.1-flash-lite-preview` | GCP | Most agent work — **same as fast** |
| `high` | `claude-sonnet-4-6` | AWS Bedrock | Frontier subtasks, founder-facing, CoS orchestration |
| `max` | `claude-opus-4-6` | AWS Bedrock | <1% highest-stakes turns |
| `reasoning` | `deepseek-r1` | AWS Bedrock | Chain-of-thought / math reasoning |

**Specialized paths:**
| Path | Model | Provider |
|------|-------|----------|
| `web_search` | `gpt-5.4-mini` | Azure Foundry |
| `embeddings` | `gemini-embedding-001` | GCP |
| `voice` | `gpt-realtime-2025-08-28` | Azure Foundry |
| `transcription` | `gpt-4o-transcribe` | Azure Foundry |
| `images` | `gpt-image-1.5` | Azure Foundry |
| `reflection` | 🔴 `claude-haiku-4-5` | AWS Bedrock — **RETIRED MODEL** |
| `code_generation` | `deepseek-v3-2` | AWS Bedrock |
| `shadow_eval` | `gemini-3.1-flash-lite-preview` | GCP |
| `deep_research` | `deep-research-pro-preview-12-2025` | GCP |

---

## Fallback Chain Logic

When a model fails (rate limit, auth error, client error, context overflow), `ModelClient` tries the next model in `FALLBACK_CHAINS[model]`.

### Cross-Provider Chains (default)
Primary failures fall through to different providers:

| Primary | Fallback Chain |
|---------|---------------|
| `claude-sonnet-4-6` | `gemini-3.1-flash-lite-preview` → `gpt-5.4-mini` |
| `claude-opus-4-6` | `claude-sonnet-4-6` → `gemini-3.1-pro-preview` |
| `claude-sonnet-4-5` | `claude-sonnet-4-6` → `gemini-3.1-flash-lite-preview` |
| `model-router` | `gpt-5.4-mini` → `gpt-5-mini-2025-08-07` → `gemini-3.1-flash-lite-preview` |
| `gpt-5.4` | `gpt-5.4-mini` → `gpt-5-mini-2025-08-07` → `gemini-3.1-flash-lite-preview` |
| `deepseek-r1` | `deepseek-v3-2` → `gemini-3.1-pro-preview` |

### Provider-Local Chains (for triangulation)
Stay within same provider:

| Primary | Local Fallback |
|---------|---------------|
| `claude-opus-4-6` | `claude-sonnet-4-6` |
| `claude-sonnet-4-6` | `claude-opus-4-6` |
| `claude-sonnet-4-5` | `claude-sonnet-4-6` |

### Atlas (ops) Special Handling
Gemini models are stripped from fallback chains for Atlas agent due to tool-schema errors.
Uses `OPS_AGENT_FALLBACK_WHEN_ALL_GEMINI` mapping instead.

### Critical Design Flaw: No Deprecation Check on Fallbacks

```typescript
// modelClient.ts line 119 — ONLY the primary model is resolved
const policyModel = resolveModel(request.model);  // ✅ Checks deprecated

// modelClient.ts line 170 — Fallback chain used RAW
let fallbackChain = getFallbackChain(effectiveRequestedModel);  // ❌ No resolveModel()

// modelClient.ts line 175 — Deprecated models passed directly to providers
const modelsToTry = [effectiveRequestedModel, ...fallbackChain];  // ❌ claude-sonnet-4-5 goes to Bedrock
```

---

## Deprecated Model Resolution

`resolveModel()` maps old model IDs to their replacements. **Only runs on the primary model.**

### Problematic Mappings (still point to deprecated models)
| Old Model | Maps To | Problem |
|-----------|---------|---------|
| `claude-3-5-haiku-20241022` | 🔴 `claude-sonnet-4-5` | Maps TO a deprecated model |
| `claude-3-5-haiku-latest` | 🔴 `claude-sonnet-4-5` | Maps TO a deprecated model |
| `claude-3-opus-20240229` | 🔴 `claude-sonnet-4-5` | Maps TO a deprecated model |
| `claude-3-haiku-20240307` | 🔴 `claude-sonnet-4-5` | Maps TO a deprecated model |
| `claude-sonnet-4-5` | `claude-sonnet-4-6` | Correct but should be removed from catalog |

---

## Credit-Aware Routing

`applyCreditAwareRouting()` can swap models between providers based on cloud credit balances:

| Tier | AWS Option | Azure Option | GCP Option |
|------|-----------|-------------|------------|
| `high` | `claude-sonnet-4-6` | `gpt-5.4-mini` | `gemini-3.1-flash-lite-preview` |
| `max` | `claude-opus-4-6` | `gpt-5.4` | `gemini-3.1-pro-preview` |
| `reasoning` | `deepseek-r1` | `o4-mini` | `gemini-3.1-pro-preview` |
| `fast` | — | — | `gemini-3.1-flash-lite-preview` |
| `default` | — | — | `gemini-3.1-flash-lite-preview` |

Minimum credit threshold: $50 USD. If below threshold on primary cloud, shifts to next.

---

## Database State

### `company_agents` — Agent Model Assignments
| Agent | Assigned Model | Resolved To | Problem |
|-------|---------------|------------|---------|
| CFO (Nadia Okafor) | `gpt-4o` | `gpt-5-mini` | 🟡 Stale DB value |
| Chief of Staff (Sarah Chen) | `gpt-4o` | `gpt-5-mini` | 🟡 Stale DB value |
| CLO (Victoria Chase) | `model-router` | `model-router` | ✅ |
| CMO (Maya Brooks) | `gpt-5.4-mini` | `gpt-5.4-mini` | ✅ |
| CPO (Elena Vasquez) | `gpt-4o` | `gpt-5-mini` | 🟡 Stale DB value |
| CTO (Marcus Reeves) | `gpt-4o` | `gpt-5-mini` | 🟡 Stale DB value |
| DevOps (Jordan Hayes) | `gpt-4o` | `gpt-5-mini` | 🟡 Stale DB value |
| Ops (Atlas Vega) | `gpt-4o` | `gpt-5-mini` | 🟡 Stale DB value |
| Platform Eng (Alex Park) | `gpt-4o` | `gpt-5-mini` | 🟡 Stale DB value |
| Quality Eng (Sam DeLuca) | `gpt-4o` | `gpt-5-mini` | 🟡 Stale DB value |
| VP Design (Mia Tanaka) | `gpt-4o` | `gpt-5-mini` | 🟡 Stale DB value |
| VP Research (Sophia Lin) | `gemini-3.1-flash-lite-preview` | `gemini-3.1-flash-lite-preview` | ✅ |

**9 of 12 agents are assigned `gpt-4o` which is deprecated.** This works because `resolveModel()` maps it to `gpt-5-mini`, but the DB is misleading.

### `routing_config` — DB Route Overrides
| Route | Model Slug | Problem |
|-------|-----------|---------|
| `complex_research` | 🔴 `gemini-3-flash-preview` | **Retired model** — `resolveModel()` maps to `gemini-3.1-flash-lite-preview` but route was set before retirement |
| `financial_complex` | 🔴 `gemini-3-flash-preview` | **Same problem** |
| All others | `model-router` or `gpt-5.4` | ✅ OK |

---

## Issues Found

### 🔴 Critical (Causing Failures NOW)

1. **Fallback chains don't run `resolveModel()`** — deprecated/disabled models in `FALLBACK_CHAINS` are passed raw to providers. When `claude-sonnet-4-6` fails and falls back to `claude-sonnet-4-5`, it goes to Bedrock with no valid bedrockId → `The provided model identifier is invalid` → **887 errors in 24 hours**.

2. **`models.config.ts` has `reflection: 'claude-haiku-4-5'`** — a retired model. Any agent using the reflection path will fail.

3. **DB `routing_config` has `gemini-3-flash-preview`** for `complex_research` and `financial_complex` routes — a retired model. Saved by `resolveModel()` at end of routing, but routing decision is still wrong (maps to flash-lite instead of a research-grade model).

### 🟡 Medium (Correctness / Maintenance Debt)

4. **Dashboard `models.ts` lists `claude-sonnet-4-5` and `claude-haiku-4-5`** as selectable options — users can assign agents to deprecated models.

5. **Dashboard `OraChat.tsx` triangulation defaults to `claude-sonnet-4-5`** — will fail on Bedrock.

6. **9 of 12 agents still assigned `gpt-4o` in DB** — functionally resolved by `resolveModel()` but misleading. Should be updated.

7. **`DEPRECATED_MODELS` chains through deprecated models**: `claude-3-5-haiku-20241022` → `claude-sonnet-4-5` → `claude-sonnet-4-6` (two-hop chain that works but is fragile).

8. **`models.config.ts` says "THE ONLY FILE YOU EDIT"** but `models.ts` has its own fallback chains, verifier maps, and model definitions that must also be edited. The "single config" claim is false.

9. **`models.config.ts` provider config references Vertex AI for Claude** (`vertexAI.owns: ['claude-']`) but Claude is actually routed through **AWS Bedrock** in runtime. Config is stale/misleading.

10. **`gpt-5-mini-2025-08-07` is in `models.config.ts` disabled list** but is actively used in many fallback chains and `STATIC_ROUTES` — contradictory.

### 🟢 Low (Cosmetic / Future)

11. **Dashboard `models.ts` is manually duplicated** from `shared/models.ts` — no auto-generation. Will drift.

12. **`gpt-4o-transcribe` referenced in `TRANSCRIPTION_MODEL`** — `gpt-4o` is deprecated but this is a specialized model ID that may be different.

---

## Recommended Fixes

### Immediate (Stop the bleeding)

1. **Add `resolveModel()` to fallback chain entries** in `modelClient.ts`:
   ```typescript
   const modelsToTry = [effectiveRequestedModel, ...fallbackChain]
     .map(m => resolveModel(m))  // ← ADD THIS
     .filter((modelId, idx, arr) => ...);
   ```

2. **Remove `claude-sonnet-4-5` and `claude-haiku-4-5`** from:
   - `SUPPORTED_MODELS` catalog (or keep only for pricing history)
   - All `FALLBACK_CHAINS` entries
   - All `PROVIDER_LOCAL_FALLBACK_CHAINS` entries
   - `VERIFIER_MAP`
   - Dashboard `models.ts`
   - OraChat triangulation defaults

3. **Fix `models.config.ts` reflection model**: `claude-haiku-4-5` → `gemini-3.1-flash-lite-preview` or `gpt-5-nano`

4. **Fix DB `routing_config`**: Update `complex_research` and `financial_complex` from `gemini-3-flash-preview` to `gemini-3.1-pro-preview`

### Short-term (Next deploy)

5. **Update 9 agents from `gpt-4o`** to `model-router` in DB:
   ```sql
   UPDATE company_agents SET model = 'model-router' WHERE model = 'gpt-4o';
   ```

6. **Fix `DEPRECATED_MODELS` two-hop chains**: Point `claude-3-5-haiku-*` directly to `claude-sonnet-4-6`

7. **Add `claude-opus-4-7`** to `SUPPORTED_MODELS` if available, with proper `bedrockId`

### Medium-term (Architecture)

8. **Auto-generate dashboard models** from `@glyphor/shared` — eliminate the manual duplicate
9. **Validate fallback chains at build time** — CI check that every model in a chain exists in `SUPPORTED_MODELS` and has a `bedrockId` if `provider === 'anthropic'`
10. **Reconcile `models.config.ts` vs `models.ts`** — either make config truly authoritative or remove the false claim

---

## Appendix: File Locations

| File | Path |
|------|------|
| Model catalog & chains | `packages/shared/src/models.ts` |
| Tier config | `packages/shared/src/models.config.ts` |
| Runtime routing | `packages/agent-runtime/src/routing/resolveModel.ts` |
| Subtask router | `packages/agent-runtime/src/subtaskRouter.ts` |
| Model client | `packages/agent-runtime/src/modelClient.ts` |
| Bedrock client | `packages/agent-runtime/src/providers/bedrockClient.ts` |
| Bedrock Anthropic adapter | `packages/agent-runtime/src/providers/bedrockAnthropic.ts` |
| Dashboard models | `packages/dashboard/src/lib/models.ts` |
| OraChat | `packages/dashboard/src/pages/OraChat.tsx` |
| DB routing config | `routing_config` table |
| DB agent assignments | `company_agents` table |
