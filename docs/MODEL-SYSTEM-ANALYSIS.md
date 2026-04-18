# Glyphor Model System — Full Analysis

**Date:** April 18, 2026
**Config Version:** 7
**Status:** 🟢 All critical issues resolved — system healthy

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
9. [CI Guardrails](#ci-guardrails)
10. [Remaining Watch Items](#remaining-watch-items)

---

## Architecture Overview

The model system spans **5 coordinated files** plus DB tables:

| File | Purpose | Authority |
|------|---------|-----------|
| `packages/shared/src/models.ts` | Model catalog, fallback chains, deprecated map, verifier map | Source of truth for model definitions |
| `packages/shared/src/models.config.ts` | Tier assignments, specialized paths, disabled list, provider routing | Source of truth for operational config |
| `packages/agent-runtime/src/routing/resolveModel.ts` | Runtime routing decisions (15+ priority rules), credit-aware swapping | Uses DB `routing_config` table with static fallbacks |
| `packages/agent-runtime/src/modelClient.ts` | Builds `modelsToTry` array with deprecation resolution on all entries | Executes provider calls with fallback |
| `packages/dashboard/src/lib/models.ts` | Dashboard dropdown models | **Derived from `@glyphor/shared/models`** — no manual duplication |

**Provider routing (codified in `providerRouting`):**
- **Anthropic** → AWS Bedrock (`claude-*`, `deepseek-*`)
- **DeepSeek** → AWS Bedrock (same credentials)
- **OpenAI** → Azure AI Foundry (`gpt-*`, `o1-*`, `o3-*`, `o4-*`)
- **Google** → GCP Gemini API (`gemini-*`, `imagen-*`, `deep-research-*`)

**Monthly drift checks:** `packages/scheduler/src/modelChecker.ts` fetches live catalogs from Gemini API, AWS Bedrock, and Azure Foundry; writes findings to `fleet_findings` and DMs founders.

---

## Active Models

### Gemini (GCP)
| Model ID | Tier | $/1M In | $/1M Out | Selectable | Status |
|----------|------|---------|----------|------------|--------|
| `gemini-3.1-pro-preview` | flagship | $10.00 | $60.00 | ✅ | Active — research, high-stakes |
| `gemini-3.1-flash-lite-preview` | economy | $1.25 | $7.50 | ✅ | **Workhorse** — fast/default tier |
| `gemini-embedding-001` | specialized | $0.15 | — | ❌ | Embeddings only |

### OpenAI (Azure Foundry)
| Model ID | Tier | $/1M In | $/1M Out | Selectable | Notes |
|----------|------|---------|----------|------------|-------|
| `gpt-5.4` | flagship | $2.50 | $15.00 | ✅ | Triangulation judge |
| `gpt-5.4-pro` | flagship | $30.00 | $180.00 | ✅ | |
| `gpt-5.4-mini` | economy | $0.75 | $4.50 | ✅ | Web search model |
| `model-router` | standard | $0.75 | $4.50 | ✅ | **DEFAULT_AGENT_MODEL** |
| `gpt-5-mini` | economy | $0.25 | $2.00 | ✅ | |
| `gpt-5-nano` | economy | $0.05 | $0.40 | ✅ | Cheapest, reflection model |
| `gpt-5.3-codex` | specialized | $1.75 | $14.00 | ✅ | Quick demo web |
| `gpt-5.2` | flagship | $1.75 | $14.00 | ✅ | |
| `gpt-5.2-pro` | flagship | $21.00 | $168.00 | ✅ | |
| `gpt-5.1` | standard | $1.25 | $10.00 | ✅ | |
| `gpt-5` | standard | $1.25 | $10.00 | ✅ | |
| `gpt-5-pro` | flagship | $15.00 | $120.00 | ✅ | |
| `o3` | reasoning | $2.00 | $8.00 | ✅ | |
| `o3-pro` | reasoning | $3.00 | $15.00 | ✅ | |
| `o4-mini` | reasoning | $1.10 | $4.40 | ✅ | **Tier reasoning model** |
| `o3-deep-research` | specialized | $2.00 | $8.00 | ✅ | |
| `o4-mini-deep-research` | specialized | $1.10 | $4.40 | ✅ | |
| + codex variants (`gpt-5.2-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5-codex`) | | | | | |
| + media models (`gpt-image-1`, `gpt-image-1.5`, `gpt-image-1-mini`, `sora-2`, `gpt-realtime-2025-08-28`) | | | | ❌ | Non-selectable |

### Anthropic (AWS Bedrock)
| Model ID | Bedrock ID | Tier | $/1M In | $/1M Out | Selectable | Status |
|----------|-----------|------|---------|----------|------------|--------|
| `claude-opus-4-7` | `us.anthropic.claude-opus-4-7` | max | $15.00 | $75.00 | ✅ | **tiers.max** |
| `claude-sonnet-4-6` | `us.anthropic.claude-sonnet-4-6` | standard | $3.00 | $15.00 | ✅ | **tiers.high** |

### DeepSeek (AWS Bedrock)
| Model ID | Bedrock ID | Tier | $/1M In | $/1M Out | Selectable |
|----------|-----------|------|---------|----------|------------|
| `deepseek-r1` | `us.deepseek.r1-v1:0` | reasoning | $0.58 | $1.68 | ✅ |
| `deepseek-v3-2` | `deepseek.v3.2` | code | $0.58 | $1.68 | ✅ | **tiers.code** |

---

## Model Routing Pipeline

When an agent runs a task, the model is selected through this pipeline:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Agent's DB model (company_agents.model)                             │
│    e.g. "model-router" or "claude-sonnet-4-6"                          │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. resolveModel() — DEPRECATED_MODELS lookup (up to 5 hops)           │
│    "gpt-4o" → "model-router"   (single-hop, no chains)                │
│    ✅ All deprecated mappings are single-hop to active models          │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. Subtask Router — classifies complexity                              │
│    trivial / standard / complex / frontier                             │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. resolveModelConfig() — 17 priority rules                            │
│    Uses DB routing_config OR static defaults                           │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. selectSubtaskModel() — complexity override                          │
│    frontier → HIGH_MODEL (claude-sonnet-4-6)                           │
│    code_edit → CODE_MODEL (deepseek-v3-2)                              │
├─────────────────────────────────────────────────────────────────────────┤
│ 6. Credit-aware routing — checks cloud credit balances                 │
│    May swap provider: AWS → Azure → GCP based on remaining $           │
│    Now covers 7 tiers: fast, default, standard, high, max, reasoning,  │
│    code                                                                │
├─────────────────────────────────────────────────────────────────────────┤
│ 7. ModelClient.generate() — builds modelsToTry array                   │
│    const rawChain = [effectiveRequestedModel, ...fallbackChain];       │
│    const modelsToTry = rawChain                                        │
│      .map(m => resolveModel(m))     ← ✅ ALL entries resolved          │
│      .filter((m, i, a) =>                                              │
│        (allowClaude || !m.startsWith('claude-'))                        │
│        && a.indexOf(m) === i);      ← deduped                         │
├─────────────────────────────────────────────────────────────────────────┤
│ 8. Provider adapter — maps to actual API                               │
│    Claude/DeepSeek: getBedrockInferenceId() → bedrockId                │
│    ✅ All Anthropic + DeepSeek models have bedrockId                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tier System

Defined in `models.config.ts` (7 tiers):

| Tier | Model | Provider | When Used |
|------|-------|----------|-----------|
| `fast` | `gemini-3.1-flash-lite-preview` | GCP | Heartbeat, memory writes, classification |
| `default` | `gemini-3.1-flash-lite-preview` | GCP | Most agent work — **same as fast** |
| `standard` | `model-router` | Azure Foundry | Mid-tier balanced quality/cost |
| `high` | `claude-sonnet-4-6` | AWS Bedrock | Frontier subtasks, founder-facing, CoS orchestration |
| `max` | `claude-opus-4-7` | AWS Bedrock | <1% highest-stakes turns |
| `reasoning` | `o4-mini` | Azure Foundry | Chain-of-thought / math reasoning |
| `code` | `deepseek-v3-2` | AWS Bedrock | Code-optimized tasks |

**Specialized paths:**
| Path | Model | Provider |
|------|-------|----------|
| `web_search` | `gpt-5.4-mini` | Azure Foundry |
| `embeddings` | `gemini-embedding-001` | GCP |
| `voice` | `gpt-realtime-2025-08-28` | Azure Foundry |
| `transcription` | `gpt-4o-transcribe` | Azure Foundry |
| `images` | `gpt-image-1.5` | Azure Foundry |
| `reflection` | `gpt-5-nano` | Azure Foundry |
| `quick_demo_web` | `gpt-5.3-codex` | Azure Foundry |
| `code_generation` | `deepseek-v3-2` | AWS Bedrock |
| `shadow_eval` | `gemini-3.1-flash-lite-preview` | GCP |
| `deep_research` | `deep-research-pro-preview-12-2025` | GCP |
| `triangulation_judge` | `gpt-5.4` | Azure Foundry |

---

## Fallback Chain Logic

When a model fails (rate limit, auth error, client error, context overflow), `ModelClient` tries the next model in `FALLBACK_CHAINS[model]`. All entries are run through `resolveModel()` before use.

### Cross-Provider Chains (default)
Primary failures fall through to different providers:

| Primary | Fallback Chain |
|---------|---------------|
| `claude-opus-4-7` | `claude-sonnet-4-6` → `gemini-3.1-pro-preview` |
| `claude-sonnet-4-6` | `gemini-3.1-flash-lite-preview` → `gpt-5.4-mini` |
| `model-router` | `gpt-5.4-mini` → `gpt-5-mini` → `gemini-3.1-flash-lite-preview` |
| `gpt-5.4` | `gpt-5.4-mini` → `gemini-3.1-flash-lite-preview` |
| `gpt-5.4-pro` | `gpt-5.4` → `gpt-5.4-mini` → `gemini-3.1-flash-lite-preview` |
| `deepseek-r1` | `deepseek-v3-2` → `gemini-3.1-pro-preview` |
| `deepseek-v3-2` | `gemini-3.1-pro-preview` → `gemini-3.1-flash-lite-preview` |
| `o4-mini` | `gemini-3.1-flash-lite-preview` → `gpt-5.4-mini` |
| `o3` | `gemini-3.1-flash-lite-preview` → `gpt-5.4-mini` |
| `o3-pro` | `o3` → `gpt-5.4` → `gpt-5.4-mini` |

### Provider-Local Chains (for triangulation)
Stay within same provider:

| Primary | Local Fallback |
|---------|---------------|
| `claude-opus-4-7` | `claude-sonnet-4-6` |
| `claude-sonnet-4-6` | `claude-opus-4-7` |
| `deepseek-r1` | `deepseek-v3-2` |
| `gpt-5.4` | `gpt-5.2` → `gpt-5.1` → `gpt-5-mini` |
| `gemini-3.1-pro-preview` | `gemini-3.1-flash-lite-preview` |

### Atlas (ops) Special Handling
Gemini models are stripped from fallback chains for Atlas agent due to tool-schema errors.
Uses `OPS_AGENT_FALLBACK_WHEN_ALL_GEMINI` mapping instead. Default: `['gpt-5.4-mini', 'gpt-5-mini']`.

---

## Deprecated Model Resolution

`resolveModel()` maps old model IDs to their replacements. Loops up to 5 hops for safety. **All mappings are now single-hop** — no chains through other deprecated models.

### Key Mappings
| Old Model | Resolves To | Rationale |
|-----------|-------------|-----------|
| `gpt-4o` | `model-router` | Standard router replacement |
| `gpt-4o-mini` | `gpt-5-mini` | Economy tier |
| `claude-sonnet-4-5` | `claude-sonnet-4-6` | Direct successor |
| `claude-haiku-4-5` | `gpt-5-nano` | Economy equivalent |
| `claude-opus-4-6` | `claude-opus-4-7` | Direct successor |
| `claude-3-opus-20240229` | `claude-opus-4-7` | Single-hop to latest |
| `claude-3-5-haiku-*` | `gpt-5-nano` | Single-hop to economy |
| `claude-3-haiku-20240307` | `gpt-5-nano` | Single-hop to economy |
| `gemini-2.5-flash-lite` | `gemini-3.1-flash-lite-preview` | Direct successor |
| `gemini-2.5-flash` | `gemini-3.1-flash-lite-preview` | Direct successor |
| `gemini-3-flash-preview` | `gemini-3.1-flash-lite-preview` | Direct successor |
| `gemini-2.5-pro` | `gpt-5.4` | Cross-provider equivalent |

### Disabled Models (explicit in config)
`gemini-3-pro-preview`, `gemini-2.0-flash-lite`, `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `claude-sonnet-4-5`, `claude-haiku-4-5`, `claude-opus-4-6`, `claude-sonnet-4-20250514`

---

## Credit-Aware Routing

`applyCreditAwareRouting()` swaps models between providers based on cloud credit balances. Minimum threshold: **$50 USD**. If below threshold on primary cloud, shifts to next.

| Tier | AWS Option | Azure Option | GCP Option |
|------|-----------|-------------|------------|
| `fast` | — | — | `gemini-3.1-flash-lite-preview` |
| `default` | — | — | `gemini-3.1-flash-lite-preview` |
| `standard` | — | `model-router` | `gemini-3.1-flash-lite-preview` |
| `high` | `claude-sonnet-4-6` | `gpt-5.4-mini` | `gemini-3.1-flash-lite-preview` |
| `max` | `claude-opus-4-7` | `gpt-5.4` | `gemini-3.1-pro-preview` |
| `reasoning` | `deepseek-r1` | `o4-mini` | `gemini-3.1-pro-preview` |
| `code` | `deepseek-v3-2` | `gpt-5.4-mini` | `gemini-3.1-flash-lite-preview` |

---

## Database State

### `company_agents` — Agent Model Assignments (post-migration)
| Agent | Assigned Model | Status |
|-------|---------------|--------|
| Chief of Staff (Sarah Chen) | `claude-sonnet-4-6` | ✅ High-tier orchestration |
| DevOps (Jordan Hayes) | `deepseek-v3-2` | ✅ Code/infra specialist |
| Platform Eng (Alex Park) | `deepseek-v3-2` | ✅ Code/infra specialist |
| VP Research (Sophia Lin) | `gemini-3.1-pro-preview` | ✅ Research upgrade |
| CMO (Maya Brooks) | `gpt-5.4-mini` | ✅ |
| CLO (Victoria Chase) | `model-router` | ✅ |
| CFO (Nadia Okafor) | `model-router` | ✅ Migrated from `gpt-4o` |
| CPO (Elena Vasquez) | `model-router` | ✅ Migrated from `gpt-4o` |
| CTO (Marcus Reeves) | `model-router` | ✅ Migrated from `gpt-4o` |
| Ops (Atlas Vega) | `model-router` | ✅ Migrated from `gpt-4o` |
| Quality Eng (Sam DeLuca) | `model-router` | ✅ Migrated from `gpt-4o` |
| VP Design (Mia Tanaka) | `model-router` | ✅ Migrated from `gpt-4o` |

**All 12 agents now assigned to active, non-deprecated models.**

### `routing_config` — DB Route Overrides (post-migration)
| Route | Model Slug | Status |
|-------|-----------|--------|
| `complex_research` | `gemini-3.1-pro-preview` | ✅ Upgraded from retired `gemini-3-flash-preview` |
| `financial_complex` | `claude-sonnet-4-6` | ✅ Upgraded from retired `gemini-3-flash-preview` |
| All others | `model-router` or `gpt-5.4` | ✅ |

---

## CI Guardrails

### Build-time validation (`packages/agent-runtime/src/__tests__/modelsValidation.test.ts`)
11 invariant tests run on every CI build:

| Test | What It Validates |
|------|-------------------|
| Fallback chain entries exist | Every model in `FALLBACK_CHAINS` is in `SUPPORTED_MODELS` |
| Provider-local chain entries exist | Every model in `PROVIDER_LOCAL_FALLBACK_CHAINS` is in `SUPPORTED_MODELS` |
| Anthropic bedrockIds | Every `provider: 'anthropic'` model has a `bedrockId` |
| DeepSeek bedrockIds | Every `provider: 'deepseek'` model has a `bedrockId` |
| Deprecated → valid | Every `DEPRECATED_MODELS` entry resolves to a non-deprecated model (no chains) |
| resolveModel idempotent | `resolveModel(resolveModel(x)) === resolveModel(x)` for all models |
| Tier references valid | Every `MODEL_CONFIG.tiers` entry points to an active model |
| Specialized references valid | Every `MODEL_CONFIG.specialized` entry points to an active model (excluding purpose-specific) |
| Verifier map valid | Every `VERIFIER_MAP` entry references active models |
| No disabled in defaults | No disabled model used as a tier or specialized default |
| Cross-provider fallbacks | High-tier chains include cross-provider fallback options |

### Pre-deploy DB validation (`scripts/validate-db-models.js`)
Checks `company_agents` and `routing_config` tables for any deprecated model slugs. Exits non-zero on failure. Supports env var configuration for connection.

---

## Remaining Watch Items

### 🟡 Low Priority

1. **`gpt-4o-transcribe` in specialized.transcription** — purpose-specific model ID (not the deprecated `gpt-4o`); expected to work correctly on Azure Foundry but not in the general model catalog.

2. **`deep-research-pro-preview-12-2025` in specialized.deep_research** — purpose-specific GCP model; not in general catalog. Validated by modelChecker monthly.

3. **`gpt-5-mini-2025-08-07` still in catalog** — legacy dated variant; has fallback chains and appears in some static routes. Could be consolidated to `gpt-5-mini` in a future cleanup.

4. **`fast` and `default` tiers both point to `gemini-3.1-flash-lite-preview`** — intentional cost optimization but reduces tier granularity. Consider splitting if quality differentiation is needed.

---

## Appendix: File Locations

| File | Path |
|------|------|
| Model catalog & chains | `packages/shared/src/models.ts` |
| Tier & operational config | `packages/shared/src/models.config.ts` |
| Runtime routing | `packages/agent-runtime/src/routing/resolveModel.ts` |
| Subtask router | `packages/agent-runtime/src/subtaskRouter.ts` |
| Model client (fallback execution) | `packages/agent-runtime/src/modelClient.ts` |
| Model cost rates | `packages/agent-runtime/src/costs/modelRates.ts` |
| Tool retriever (model caps) | `packages/agent-runtime/src/routing/toolRetriever.ts` |
| Bedrock client | `packages/agent-runtime/src/providers/bedrockClient.ts` |
| Bedrock Anthropic adapter | `packages/agent-runtime/src/providers/bedrockAnthropic.ts` |
| Dashboard models (derived) | `packages/dashboard/src/lib/models.ts` |
| OraChat triangulation | `packages/dashboard/src/pages/OraChat.tsx` |
| Monthly model checker | `packages/scheduler/src/modelChecker.ts` |
| CI validation tests | `packages/agent-runtime/src/__tests__/modelsValidation.test.ts` |
| DB validation script | `scripts/validate-db-models.js` |
| DB migration (agents) | `scripts/migrate-agents.js` |
| DB migration (routing) | `scripts/migrate-routing.js` |
| DB routing config | `routing_config` table |
| DB agent assignments | `company_agents` table |
