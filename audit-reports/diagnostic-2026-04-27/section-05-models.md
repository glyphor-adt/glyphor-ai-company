# Section 5 — Model Routing Reality

Diagnostic audit of `glyphor-ai-company`, snapshot 2026-04-27.

This section answers: *what models are agents actually running?* — separating the
canonical-registry view (`packages/shared/src/models.ts` + `models.config.ts`)
from the live call sites and the cost-tier optimizer.

---

## 5.1  Canonical maps: `ROLE_COST_TIER` and `TIER_MODELS`

There are **two parallel routing surfaces** in `packages/shared/src`. Section 5.2
reconciles them. Both are exported from `packages/shared/src/index.ts`.

### 5.1.1  `TIER_MODELS` (Cost-tier optimizer — `models.ts:630–634`)

| Cost tier | Model id | Provider (per `detectProvider`, `models.ts:443`) | Cloud (per `MODEL_CONFIG.providerRouting`, `models.config.ts:79–84`) |
|-----------|----------|--------|-------|
| `economy` | `model-router` | openai | azure-foundry (Azure AI Foundry router) |
| `standard`| `model-router` | openai | azure-foundry |
| `pro`     | `model-router` | openai | azure-foundry |

Plus a separate constant:

- `EXEC_CHAT_MODEL = 'model-router'` — `models.ts:637`. Used **only** for `task === 'on_demand'` when the role is `pro` (`models.ts:699–700`). With every tier already pointing at `model-router`, this branch is currently a no-op.

> **Finding 5.1.1-A.** All three cost tiers resolve to a single model
> (`model-router`). The CostTier abstraction at `models.ts:627` is structurally
> dead — three names for the same string. The doc-comment at `models.ts:622–625`
> still implies tier differentiation that does not exist.

### 5.1.2  `ROLE_COST_TIER` (`models.ts:640–676`)

Every entry, verbatim:

| Tier (per `models.ts`) | Roles |
|----|----|
| `economy`  | `m365-admin`, `global-admin`, `seo-analyst`, `social-media-manager`, `adi-rose` |
| `standard` | `content-creator`, `design-critic`, `ui-ux-designer`, `frontend-engineer`, `template-architect`, `user-researcher`, `competitive-intel`, `devops-engineer`, `platform-engineer`, `quality-engineer`, `head-of-hr`, `vp-sales`, `vp-design`, `bob-the-tax-pro`, `marketing-intelligence-analyst`, `competitive-research-analyst`, `market-research-analyst` |
| `pro`      | `chief-of-staff`, `cto`, `cfo`, `cpo`, `cmo`, `clo`, `vp-research`, `ops` |

Default for unlisted roles: `'standard'` (`models.ts:696`).

### 5.1.3  `MODEL_CONFIG.tiers` (the *other* tier table — `models.config.ts:14–38`)

This is a **second**, semantically different tier system used by `agent-runtime/src/routing/resolveModel.ts`. Names overlap with `ROLE_COST_TIER` (`standard`) but values do not.

| Tier      | Model id                          | Provider  | Cloud         |
|-----------|-----------------------------------|-----------|---------------|
| `fast`    | `gemini-3.1-flash-lite-preview`   | gemini    | gcp           |
| `default` | `gemini-3.1-flash-lite-preview`   | gemini    | gcp           |
| `standard`| `model-router`                    | openai    | azure-foundry |
| `high`    | `claude-sonnet-4-6`               | anthropic | aws-bedrock   |
| `max`     | `claude-sonnet-4-6` *(was `claude-opus-4-7` until 2026-04-19; demoted because Bedrock account lacks Opus 4.7 entitlement, see `models.config.ts:28–31`)* | anthropic | aws-bedrock |
| `reasoning` | `o4-mini`                       | openai    | azure-foundry |
| `code`    | `deepseek-v3-2`                   | deepseek  | aws-bedrock   |

### 5.1.4  Specialized paths (`models.config.ts:41–55`)

| Path | Model | Cloud |
|------|-------|-------|
| `web_search` | `gpt-5.4-mini` | azure-foundry |
| `embeddings` | `gemini-embedding-001` | gcp |
| `voice` | `gpt-realtime-2025-08-28` | azure-foundry |
| `transcription` | `gpt-4o-transcribe` | azure-foundry |
| `images` | `gpt-image-1.5` | azure-foundry |
| `reflection` | `gpt-5-nano` | azure-foundry |
| `quick_demo_web` | `gpt-5.3-codex` | azure-foundry |
| `code_generation` | `deepseek-v3-2` | aws-bedrock |
| `shadow_eval` | `gemini-3.1-flash-lite-preview` | gcp |
| `deep_research` | `deep-research-pro-preview-12-2025` | gcp |
| `triangulation_judge` | `gpt-5.4` | azure-foundry |

### 5.1.5  Disabled models (`models.config.ts:67–76`)

`gemini-3-pro-preview`, `gemini-2.0-flash-lite`, `gemini-3-flash-preview`,
`gemini-2.5-flash`, `gemini-2.5-flash-lite`, `claude-sonnet-4-5`,
`claude-haiku-4-5`, `claude-opus-4-6`, `claude-sonnet-4-20250514`.

> **Finding 5.1.5-A.** `models.config.ts:71` disables `gemini-2.5-flash-lite`
> while `DEPRECATED_MODELS` (`models.ts:174–175`) maps `gemini-2.5-flash-lite`
> and `gemini-2.5-flash` to **`gemini-3.1-flash-lite-preview`**, which is itself
> a "preview" SKU. The disabled-list is enforced at config-validation time
> (`__tests__/modelsValidation.test.ts:91–99`) but `isDisabled()`
> (`models.config.ts:138`) is not called at the request hot-path in
> `resolveModel()` (`models.ts:423–438`); a stored DB override pointing at a
> disabled id is silently honored.

### 5.1.6  Fallback chains (cross-provider) — `models.ts:206–243`

Selected entries (full table is long):

- `claude-sonnet-4-6` → `gemini-3.1-flash-lite-preview` → `gpt-5.4-mini`
- `claude-opus-4-7`   → `claude-sonnet-4-6` → `gemini-3.1-pro-preview`
- `model-router`      → `gpt-5.4-mini` → `gpt-5-mini` → `gemini-3.1-flash-lite-preview`
- `gemini-3.1-flash-lite-preview` → `gpt-5-mini` → `gpt-5-nano`
- `deepseek-v3-2`     → `gemini-3.1-pro-preview` → `gemini-3.1-flash-lite-preview`

Atlas (ops) is given a Gemini-stripped variant via
`OPS_AGENT_FALLBACK_WHEN_ALL_GEMINI` (`models.ts:249–`) because of "Gemini
tool-schema errors (defer_loading, thought_signature, etc.)" (comment
`models.ts:247`). This is a tactical workaround, not a tested guarantee — only
the chain *existence* is asserted by `modelsValidation.test.ts:101–114`, not the
ops branching.

---

## 5.2  Effective model per role × task type

`optimizeModel(role, task, dbModel?)` — `models.ts:688–704` — is the **only**
function that consumes `ROLE_COST_TIER`/`TIER_MODELS`. It is exported from
`packages/shared/src/index.ts` but **not** wired into the agent runtime's
primary path (`packages/agent-runtime/src/routing/resolveModel.ts` uses
`MODEL_CONFIG.tiers` instead). Direct callers of `optimizeModel`:

```text
$ rg -n "optimizeModel\(" packages services workers scripts
# (no production hits — only the export at packages/shared/src/index.ts)
```

> **Finding 5.2-A.** `optimizeModel` and the cost-tier system that drives it
> appear to be **unreferenced by any runtime**. The lookup chain below is
> therefore the *intended* behavior; the *actual* behavior (Section 5.3) routes
> through `MODEL_CONFIG.tiers` which has different values.

### 5.2.1  Lookup chain (intended)

```
role
  └── ROLE_COST_TIER[role]      (default: 'standard')          # models.ts:696
        └── if task === 'on_demand' && tier === 'pro':
              └── EXEC_CHAT_MODEL                             # models.ts:699-700
        └── else:
              └── TIER_MODELS[tier]                            # models.ts:703
        └── (dbModel override beats everything → resolveModel(dbModel))   # models.ts:694
```

### 5.2.2  Effective model per (role, task) — assuming no DB override

Because `TIER_MODELS.{economy,standard,pro}` and `EXEC_CHAT_MODEL` are all
`model-router`, **every role × every task → `model-router`**. The matrix is
degenerate.

| Role group | task=`on_demand` | task=`scheduled` | task=`orchestrator` |
|---|---|---|---|
| economy roles (`m365-admin`, `global-admin`, `seo-analyst`, `social-media-manager`, `adi-rose`) | `model-router` | `model-router` | `model-router` |
| standard roles (15 listed in §5.1.2) | `model-router` | `model-router` | `model-router` |
| pro roles (`chief-of-staff`, `cto`, `cfo`, `cpo`, `cmo`, `clo`, `vp-research`, `ops`) | `model-router` (via `EXEC_CHAT_MODEL`) | `model-router` (via `TIER_MODELS.pro`) | `model-router` (via `TIER_MODELS.pro`) |
| any unlisted role | `model-router` (defaults to `standard`) | `model-router` | `model-router` |

> Provider for `model-router` is `openai` (`models.ts:445`) and routes through
> Azure Foundry (`models.config.ts:106–113`), which then *internally* picks the
> underlying OpenAI SKU. Glyphor has no signal beyond Foundry billing about
> which model actually answered.

### 5.2.3  What's *actually* effective per role

The agent runtime resolver — `packages/agent-runtime/src/routing/resolveModel.ts`
(per `git show 8163ffd8`) — uses `MODEL_CONFIG.tiers` (§5.1.3), with effective
results:

- Most agents (DB column `company_agents.model`): `model-router` after
  `scripts/migrate-agents.js:15` (`UPDATE … SET model = 'model-router' WHERE model = 'gpt-4o'`).
- DB overrides observed in code/migrations:
  - `claude-sonnet-4-6` for Chief of Staff (`docs/MODEL-SYSTEM-ANALYSIS.md:250`),
  - `deepseek-v3-2` for DevOps & Platform Engineering (`docs/MODEL-SYSTEM-ANALYSIS.md:251–252`).
- Routing config (`routing_config` table) overrides per `docs/MODEL-SYSTEM-ANALYSIS.md:265–270`:
  - `complex_research` → `gemini-3.1-pro-preview`
  - `financial_complex` → `claude-sonnet-4-6`

---

## 5.3  Direct provider client usage (bypassing `resolveModel` / `optimizeModel`)

### 5.3.1  Provider SDK constructors instantiated outside the central client

| File:line | Constructor | Notes |
|---|---|---|
| `packages/company-memory/src/embeddingClient.ts:17` | `new GoogleGenAI({ apiKey })` | Embeddings; legitimate (model = `EMBEDDING_MODEL`). |
| `packages/agent-runtime/src/providers/openai.ts:153` | `new OpenAI({...})` | Provider adapter — central. |
| `packages/agent-runtime/src/providers/gemini.ts:25,29` | `new GoogleGenAI(...)` | Provider adapter — central. |
| `packages/agent-runtime/src/providers/bedrockClient.ts:89` | `new BedrockRuntimeClient(...)` | Provider adapter — central. |
| `packages/agents/src/head-of-hr/tools.ts:567,829` | `new GoogleGenAI({ apiKey })` | **Bypass** — direct Gemini call from HR tool. |
| `packages/agents/src/shared/assetTools.ts:215` | `new GoogleGenAI({ apiKey })` | **Bypass** — asset/image tool. |
| `packages/agents/src/shared/sandboxBuildValidator.ts:247` | `new OpenAI({ apiKey })` | **Bypass** — sandbox validator using OpenAI directly. |
| `packages/agents/src/shared/videoCreationTools.ts:100,171,261,322` | `new GoogleGenAI({ apiKey })` | **Bypass** — Veo/video pipeline calls Gemini API directly (4 instantiations in one file). |

> **Finding 5.3.1-A.** Six call sites in `packages/agents/src/**` bypass the
> agent-runtime adapter and instantiate Gemini/OpenAI clients directly. They
> read `GOOGLE_AI_API_KEY` / OpenAI key from env, not from the central
> credentials helper, and **do not flow through `resolveModel()` or any
> fallback chain**. A Gemini outage will fail these tools hard with no
> automatic OpenAI failover.

### 5.3.2  Direct fetch() to provider HTTP endpoints

| File:line | URL | Bypass type |
|---|---|---|
| `packages/agent-runtime/src/modelClient.ts:421,459` | `https://generativelanguage.googleapis.com/v1beta/interactions` | Gemini "interactions" telemetry endpoint — direct `fetch`. |
| `packages/scheduler/src/strategyLabEngine.ts:2111,2142` | same Gemini interactions endpoint | Duplicate of the modelClient.ts path. |
| `packages/agent-runtime/src/providers/gemini.ts:203,240` | `…/v1beta/models/{model}:predictLongRunning`, `…/v1beta/{operation.name}` | Veo long-running operations; legitimate Gemini-only API. |
| `packages/agent-runtime/src/providers/openai.ts:748` | `https://api.openai.com/v1/images/generations` | **Direct OpenAI image API** — bypasses Azure Foundry routing declared in `MODEL_CONFIG.providerRouting.openai.cloud = 'azure-foundry'` (`models.config.ts:82`). Contradicts the cloud routing contract. |
| `packages/dashboard/src/lib/useVoiceChat.ts:200` | `https://api.openai.com/v1/realtime?model=gpt-realtime-2025-08-28` | **Direct browser→OpenAI** call, not Azure. Hardcoded model id. |
| `packages/voice-gateway/src/realtimeClient.ts:44` | `// POST https://api.openai.com/v1/realtime/sessions` | Comment only; actual implementation should be reviewed. |
| `packages/integrations/src/webSearch.ts:114` | `OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'` | Doc comment at line 7 says "Azure OpenAI / Foundry only (no api.openai.com)" — the constant **violates its own header**. |
| `packages/integrations/src/openai/billing.ts:26` | `https://api.openai.com/v1/organization/costs` | Billing-only; legitimate. |
| `packages/integrations/src/anthropic/billing.ts:11` | `https://api.anthropic.com` | Billing-only; legitimate (header at line 4 explicitly notes it). |
| `packages/graphrag-indexer/logs/indexing-engine.log` (60+ entries) | `…gemini-2.5-flash:generateContent?key=AIzaSy…` | **Live evidence** that GraphRAG is calling `gemini-2.5-flash`, which is on the **disabled** list (`models.config.ts:70`). Also: **API key leaked into the log file** committed to the repo (`AIzaSyBtTi78faXgy5EN7Mrdj0TPR6r2qBCZKc4`, `AIzaSyBIrERx-dTIxoPaKBw_jPCrz6hLwNWKB64`). |

> **Finding 5.3.2-A.** `packages/integrations/src/webSearch.ts:114` and
> `packages/agent-runtime/src/providers/openai.ts:748` and
> `packages/dashboard/src/lib/useVoiceChat.ts:200` all hit `api.openai.com`
> directly while config asserts `openai.cloud === 'azure-foundry'`.
>
> **Finding 5.3.2-B.** `packages/graphrag-indexer/settings.yaml:12` declares
> `gemini-3.1-flash-lite-preview`, but production logs show actual traffic to
> `gemini-2.5-flash` (disabled). Either settings.yaml is not the file being
> read, or there is a separate Python config path.
>
> **Finding 5.3.2-C (security).** Two distinct Google AI API keys are
> visible in `packages/graphrag-indexer/logs/{indexing-engine,prompt-tuning}.log`.
> If those logs are tracked in git, both keys must be revoked. (Out of scope
> for this section — flagged for Section 12 / secrets audit.)

### 5.3.3  `@ai-sdk/*` (Vercel AI SDK) usage

```text
$ rg "from ['\"]@ai-sdk/(openai|google|anthropic|deepseek|amazon-bedrock)" packages services workers skills scripts
# 0 matches
```

The Vercel AI SDK is not used. All providers go through hand-rolled adapters in
`packages/agent-runtime/src/providers/*`.

---

## 5.4  Hardcoded model IDs (string literals outside the registry)

Excluding `packages/shared/src/models.ts` (the registry itself),
`packages/shared/src/models.config.ts`, `packages/integrations/src/anthropic/billing.ts`
(deprecated/billing tables that intentionally list legacy SKUs), and dashboard
build artifacts under `packages/dashboard/dist/`.

### Production code

| File:line | Hardcoded id | Why it's a problem |
|---|---|---|
| `packages/agent-runtime/src/costs/modelRates.ts:11` | `'claude-sonnet-4-5'` | Disabled in `models.config.ts:72`. Cost table still references it. |
| `packages/agent-runtime/src/costs/modelRates.ts:13` | `'claude-haiku-4-5'` | Disabled in `models.config.ts:73`. |
| `packages/agent-runtime/src/costs/modelRates.ts:39` | `'gemini-2.5-flash'` | Disabled in `models.config.ts:70`. |
| `packages/integrations/src/aws/billing.ts:183` | regex `/claude-sonnet-4-5/i` | Used to canonicalize Bedrock invoice rows. Acceptable for *historical* invoices; misleading in current code. |
| `packages/integrations/src/aws/billing.ts:184` | regex `/claude-haiku-4-5/i` | Same. |
| `packages/voice-gateway/src/realtimeClient.ts` (and `dashboard/src/lib/useVoiceChat.ts:200`) | `gpt-realtime-2025-08-28` | Realtime voice. Should reference `REALTIME_MODEL` (`models.ts:188`), not a string literal. |

### Test fixtures

| File:line | Hardcoded id | Status |
|---|---|---|
| `packages/agent-runtime/src/__tests__/contextCompaction.test.ts:13` | `'gemini-2.5-flash': 1_048_576` | Disabled model. |
| `packages/agent-runtime/src/__tests__/contextCompaction.test.ts:15` | `'gpt-4o': 128_000` | Deprecated → `model-router` in `DEPRECATED_MODELS` (`models.ts:138`). |
| `packages/agent-runtime/src/__tests__/memoryConsolidation.test.ts:57` | `getTierModel: vi.fn(() => 'gemini-2.5-flash')` | Mock returns a disabled id; test will pass even after global retirement. |

### Migration / one-shot scripts (intentional historical references)

- `scripts/migrate-agents.js:15,19` — explicit list of legacy ids.
- `scripts/validate-db-models.js:9–19` — denylist of deprecated/disabled ids.
- `db/migrations/20260411150000_replace_claude_sonnet_with_gemini_flash_lite.sql` — see §5.6.

> **Finding 5.4-A.** `packages/agent-runtime/src/costs/modelRates.ts` is a
> **second pricing table** parallel to `SUPPORTED_MODELS[*].inputPer1M /
> outputPer1M` (`models.ts:75–`). It still includes 3 disabled SKUs and is the
> source of cost numbers on at least one runtime path. Two pricing tables for
> the same model = silent drift risk; consolidate to the registry.

---

## 5.5  Cross-provider fallback decisions in tests

Only one test asserts on fallback *cross-provider* invariants:

- `packages/agent-runtime/src/__tests__/modelsValidation.test.ts:101–114`
  asserts that for every primary model whose tier is **not** `economy` /
  `reasoning` / `specialized`, the `FALLBACK_CHAINS` chain contains at least
  one entry whose provider differs from the primary's. This is structural, not
  behavioral — it verifies the *table*, not that any code actually fails over.

- `packages/agent-runtime/src/__tests__/modelsValidation.test.ts:17–22, 27–32`
  assert every fallback model id exists in `SUPPORTED_MODELS` (also structural).

- `packages/agent-runtime/src/__tests__/errorRetry.test.ts:553–572` asserts
  `retry_fallback` events fire after consecutive `overloaded` errors and that
  background calls do **not** trigger fallback (line 297–311). It uses mock
  models — does **not** validate the cross-provider switch end-to-end.

- `packages/agent-runtime/src/__tests__/errorRetry.test.ts:460, 490` assert
  edge cases (no fallback when `enableOverloadFallback === false`; transient
  errors reset the overload counter).

> **Finding 5.5-A.** No test executes a real cross-provider failover (e.g.
> Sonnet 4.6 → Gemini Flash-Lite). The only enforcement is "the table looks
> right." If `getFallbackChain()` is called with a model id that is missing
> from `FALLBACK_CHAINS`, it returns `[]` (`models.ts:466`) and the runtime
> proceeds with no fallback at all. Atlas's ops-specific Gemini-strip path
> (`getOpsFallbackChainExcludingGemini`, `models.ts:464`) has zero direct test
> coverage in `__tests__/`.

Logs were not in scope for this section beyond the GraphRAG evidence already
cited in §5.3.2.

---

## 5.6  The "Apr 11 sonnet → flash-lite" migration

The architecture doc claim (`docs/ARCHITECTURE.md:1255`) referencing
`db/migrations/20260411150000_replace_claude_sonnet_with_gemini_flash_lite.sql`
is **literally accurate**. Verbatim from that migration:

```sql
UPDATE company_agents
SET model = 'gemini-3.1-flash-lite-preview'
WHERE model = 'claude-sonnet-4-6';

UPDATE routing_config
SET model_slug = 'gemini-3.1-flash-lite-preview',
    description = 'CLO contract/compliance review. Manual trigger only.
                   (Gemini Flash-Lite — Claude retired for cost.)'
WHERE route_name = 'legal_review' AND model_slug = 'claude-sonnet-4-6';
```
(`db/migrations/20260411150000_replace_claude_sonnet_with_gemini_flash_lite.sql:4–14`)

### 5.6.1  What was actually affected

**DB column `company_agents.model`:** every agent row whose model was
`claude-sonnet-4-6` was rewritten to `gemini-3.1-flash-lite-preview`. The
migration does not name agents; it is a bulk `WHERE model = 'claude-sonnet-4-6'`.
Per `docs/MODEL-SYSTEM-ANALYSIS.md:250–262` Chief of Staff was later restored
to `claude-sonnet-4-6` (so the migration affected CoS, then was partially
reverted by a later DB change not bundled with this commit).

**`routing_config` table:** only the `legal_review` route was touched (CLO
contract/compliance review).

**Code-level tier/specialized assignments (commit `8163ffd8`, 2026-04-10,
which preceded this DB migration by hours):**
- `tiers.fast`: `gpt-5-nano` → `gemini-3.1-flash-lite-preview`
- `tiers.high`: `gpt-5.4-mini` → `claude-sonnet-4-6` *(this is the **opposite** direction — added Sonnet, not removed it)*
- `tiers.max` introduced: `claude-opus-4-6`
- `tiers.reasoning` introduced: `deepseek-r1`
- `specialized.reflection`: `gpt-5-mini` → `claude-haiku-4-5`
- `specialized.code_generation`: `gemini-3.1-pro-preview` → `deepseek-v3-2`

The current `models.config.ts` reflects a **further revision on 2026-04-19**
(commit `054dbe54`):
- `tiers.max`: `claude-opus-4-7` → `claude-sonnet-4-6` (Bedrock account lacks Opus 4.7 entitlement; see comment at `models.config.ts:28–31`)
- `tiers.reasoning`: `deepseek-r1` → `o4-mini`
- `specialized.reflection`: `claude-haiku-4-5` → `gpt-5-nano` (the very Haiku promotion from `8163ffd8` was reverted 8 days later)

> **Finding 5.6-A.** The "wholesale Sonnet → Flash-Lite" framing in the
> architecture doc applies to the **DB layer only** (one bulk `UPDATE` of
> `company_agents` plus the `legal_review` route). It does not describe the
> code-level tier table, where the 8163ffd8 commit moved the `high` tier the
> *other* direction (gpt-5.4-mini → claude-sonnet-4-6). The migration narrative
> in `docs/ARCHITECTURE.md` and `docs/MODEL-SYSTEM-ANALYSIS.md` is two
> conflicting stories layered on top of each other.
>
> **Finding 5.6-B.** Several settings rolled back within 8 days
> (`reflection: claude-haiku-4-5 → gpt-5-nano`, `max: opus-4-7 → sonnet-4-6`).
> The model-config file changed 4 times in 9 days (2026-04-10, -11, -18, -19).
> There is no changelog inside the file — only `lastReviewedAt`.

### 5.6.2  Quality evals on affected skills/roles

Skills directory does not carry per-skill model pins (`rg "model:" skills/`
returns 2 hits, neither a config). Eval coverage for skills/roles affected by
the migration:

| Affected target | Quality eval present? | Path |
|---|---|---|
| Generic role evals | yes (per-run) | `packages/smoketest/src/layers/layer29-per-run-evaluation.ts` |
| `evalDashboard` aggregator | yes | `packages/scheduler/src/evalDashboard.ts` |
| `chief-of-staff` (Sonnet → Flash-Lite → Sonnet round-trip) | **no skill-specific eval** | searched `scripts/eval-*.ts` and `packages/scheduler/src/evalDashboard.ts` — no CoS-pinned eval |
| `legal_review` route (`clo`) | **no route-specific eval** found | grep for `legal_review` returns only the migration |
| `reflection` specialized path (haiku → nano flip) | covered indirectly by `__tests__/reasoningEngine.test.ts` (mocked) | not a quality eval |
| `code_generation` (Gemini Pro → DeepSeek v3.2) | none model-aware | no `codeGenerationEval.ts` found |
| Triangulation judge (`gpt-5.4`) | judge logic itself runs, but no offline eval validates judgment quality | `scripts/eval-section6-regression.ts` exists but is dashboard-section regression, not LLM-judge regression |

> **Finding 5.6-C.** None of the roles/specialized paths flipped by the
> 2026-04-10 → 2026-04-19 churn have a dedicated quality regression. The CI
> only verifies the *table* (`__tests__/modelsValidation.test.ts`). A change
> from Claude Sonnet 4.6 to Gemini 3.1 Flash-Lite for `legal_review` is at
> least a **15× cost reduction** (`$3 / $15` → `$0.10 / $0.40` per MTok per
> `models.ts:75–76`) and a likely substantial quality drop for contract
> review, but no evaluation gate exists to catch regressions.

---

## 5.7  Summary of findings (Section 5)

| # | Severity | Finding |
|---|---|---|
| 5.1.1-A | Med | All `CostTier` values point to `model-router`; tier system is dead code. |
| 5.1.5-A | High | `isDisabled()` is not enforced at request time, only at config-validation. |
| 5.2-A | Med | `optimizeModel` and `ROLE_COST_TIER` are not referenced by any runtime path. |
| 5.3.1-A | High | 6 agent tools in `packages/agents/src/**` bypass the central provider adapter and have no fallback. |
| 5.3.2-A | Med | At least 3 production paths hit `api.openai.com` directly while config asserts Azure-Foundry routing. |
| 5.3.2-B | High | GraphRAG logs show live traffic to `gemini-2.5-flash` (disabled SKU). settings.yaml says otherwise. |
| 5.3.2-C | **Critical** | Two Google AI API keys present in tracked log files under `packages/graphrag-indexer/logs/`. |
| 5.4-A | Med | `costs/modelRates.ts` is a parallel pricing table containing 3 disabled SKUs. |
| 5.5-A | High | Zero end-to-end cross-provider fallback tests; only structural assertions. |
| 5.6-A | Med | Migration narrative in `ARCHITECTURE.md` conflicts with code-level tier history. |
| 5.6-B | Low | 4 model-config revisions in 9 days, no in-file changelog, partial rollbacks. |
| 5.6-C | High | No quality eval gates the migration-affected roles (especially `legal_review`/CLO). |

---

*Cited paths are relative to repo root unless otherwise stated.*
*Git refs: `8163ffd8` (2026-04-10), `4e3ee33d` (2026-04-10),
`432d6fc7` (2026-04-11), `139323c8` (2026-04-18),
`ff60b8e9` (2026-04-18), `054dbe54` (2026-04-19).*
