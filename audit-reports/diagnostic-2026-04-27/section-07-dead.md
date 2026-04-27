# Section 7 — Dead Code, Stale Comments, and Orphans

_Audit window: 2026-04-27. Source files analysed (excl. node_modules / .venv / dist / build / .next): **941**._

## Methodology

- File inventory built from `packages/`, `services/`, `scripts/`, `workers/` (`*.ts`, `*.tsx`, `*.js`, `*.mjs`).
- Excluded: `node_modules`, `.venv`, `.next`, `dist`, `build`, `coverage`, `out`, `.turbo`, `__pycache__`.
- Imports collected via regex on `from "..."` / `require("...")`. Resolved 3,019 of 3,677 specifiers (82%); the rest are external packages or unresolvable aliases.
- **Reachability**: BFS from production entrypoints (services, scripts/, workers/, `packages/*/src/{index,server,main}.ts`, `packages/scheduler/src/server.ts`, `packages/agent-runtime/src/*`, `packages/worker/src/index.ts`, `packages/dashboard/{app,pages,src/app,src/pages}/`, `*.config.*`, `packages/*/scripts|bin/`). Tests treated as separate entrypoint set.
- **Dead** = not reachable from production entrypoints. Test-only reach is flagged separately.
- **Caveats**:
  - Dynamic imports / DB-driven dispatch (e.g., `runDynamicAgent`) are **not** modelled. The 16 non-executive agent folders flagged below may be loaded by such mechanisms; verify before deletion.
  - JSX/TSX side-effect-only renders (Next.js conventions outside `app/`/`pages/`) may register at runtime; treated conservatively.
  - `*.test.ts` / `__tests__/` reachability is computed but **does not** keep code "alive" for purposes of (a).
- **Last-commit dates** retrieved via `git log -1 --format=%cs`. "Last write" reflects working-tree mtime.
- **Stale-comment cutoff (60d)**: blame-based for top-12 marker files; mtime-based proxy for all others.

## Summary

| Bucket | Files |
|---|---:|
| Production-reachable | 754 |
| Test-only reachable | 397 |
| **Definitely dead** (no refs, >30d) | **61** |
| **Probably dead** (test-only OR <30d) | **126** |
| Self-only / orphan (no inbound) | 30 |
| Orphan packages | 2 |

## (a) Definitely Dead

_No inbound references; no test references; last commit > 30 days ago._

| File | LOC | Last commit | Reason flagged |
|---|---:|---|---|
| `packages/agents/src/global-admin/tools.ts` | 1582 | 2026-03-19 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/devops-engineer/tools.ts` | 516 | 2026-03-23 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/quality-engineer/tools.ts` | 312 | 2026-03-26 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/chief-of-staff/domainRouter.ts` | 300 | 2026-03-12 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/FounderBriefing.tsx` | 278 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/platform-engineer/tools.ts` | 252 | 2026-03-24 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/shared/packetSchemas.ts` | 223 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/platform-intel/teamsCards.ts` | 215 | 2026-03-18 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/shared/codexTools.ts` | 190 | 2026-03-16 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/frontend-engineer/tools.ts` | 185 | 2026-03-12 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/competitive-intel/tools.ts` | 163 | 2026-03-22 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/hero-1.tsx` | 159 | 2026-03-23 | unreachable from prod entrypoints; no test refs |
| `packages/scheduler/src/agentLifecycle.ts` | 151 | 2026-03-19 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/ui/glowing-stars.tsx` | 129 | 2026-03-19 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/social-media-manager/tools.ts` | 127 | 2026-03-26 | unreachable from prod entrypoints; no test refs |
| `packages/agent-runtime/src/config/agentEntraRoles.ts` | 123 | 2026-03-18 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/SystemHealth.tsx` | 118 | 2026-03-25 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/design-critic/tools.ts` | 114 | 2026-03-26 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/user-researcher/tools.ts` | 113 | 2026-02-24 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/chief-of-staff/schedule.ts` | 85 | 2026-03-17 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/template-architect/tools.ts` | 81 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/ui/glowing-effect-demo-2.tsx` | 81 | 2026-03-23 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Page.tsx` | 68 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/ui-ux-designer/tools.ts` | 66 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/ui/button.tsx` | 62 | 2026-03-16 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/CanvasGlow.tsx` | 62 | 2026-03-11 | unreachable from prod entrypoints; no test refs |
| `packages/worker/src/queue.ts` | 60 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/multi-step-loader-demo.tsx` | 54 | 2026-03-24 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Header.tsx` | 52 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Button.stories.ts` | 46 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/components/AgentIcon.tsx` | 37 | 2026-02-22 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/lib/glassCard.ts` | 34 | 2026-03-18 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Button.tsx` | 34 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/m365-admin/systemPrompt.ts` | 31 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/shared/src/middleware/auth.ts` | 31 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/global-admin/systemPrompt.ts` | 30 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/head-of-hr/systemPrompt.ts` | 28 | 2026-03-24 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Header.stories.ts` | 28 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/stories/Page.stories.ts` | 26 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/.storybook/main.ts` | 25 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/market-research-analyst/systemPrompt.ts` | 24 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/competitive-research-analyst/systemPrompt.ts` | 22 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/platform-engineer/systemPrompt.ts` | 22 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/devops-engineer/systemPrompt.ts` | 20 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/template-architect/systemPrompt.ts` | 19 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/competitive-intel/systemPrompt.ts` | 17 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/design-critic/systemPrompt.ts` | 17 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/platform-intel/config.ts` | 16 | 2026-03-26 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/user-researcher/systemPrompt.ts` | 16 | 2026-03-20 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/public/sw.js` | 13 | 2026-03-15 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/.storybook/preview.ts` | 12 | 2026-03-09 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-data-server/src/scopes.ts` | 10 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-design-server/src/scopes.ts` | 6 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-engineering-server/src/scopes.ts` | 6 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-marketing-server/src/scopes.ts` | 6 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/competitive-research-analyst/tools.ts` | 5 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/market-research-analyst/tools.ts` | 5 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/mcp-finance-server/src/scopes.ts` | 5 | 2026-03-04 | unreachable from prod entrypoints; no test refs |
| `packages/dashboard/src/lib/supabase.ts` | 4 | 2026-03-01 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/shared/patchHarness.ts` | 2 | 2026-03-11 | unreachable from prod entrypoints; no test refs |
| `packages/agents/src/shared/v4aDiff.ts` | 2 | 2026-03-11 | unreachable from prod entrypoints; no test refs |

## (b) Probably Dead

_No inbound from production paths, but referenced by tests **or** modified within the last 30 days._

| File | LOC | Last commit | Inbound test refs | Reason flagged |
|---|---:|---|:-:|---|
| `packages/agents/src/platform-intel/tools.ts` | 1607 | 2026-04-09 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/m365-admin/tools.ts` | 1022 | 2026-04-09 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/shared/executiveOrchestrationTools.ts` | 836 | 2026-03-30 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/head-of-hr/tools.ts` | 799 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/scheduler/src/czShadowEval.ts` | 762 | 2026-04-26 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/shared/engineeringGapTools.ts` | 732 | 2026-03-23 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/coordinatorMode.test.ts` | 712 | 2026-04-04 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/policyLimits.test.ts` | 636 | 2026-04-07 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/errorRetry.test.ts` | 602 | 2026-04-05 | yes | reachable only via tests |
| `packages/agents/src/shared/emailMarketingTools.ts` | 601 | 2026-03-05 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer16-tools.ts` | 598 | 2026-04-09 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/toolExecutor.test.ts` | 527 | 2026-04-20 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/contextCompaction.test.ts` | 494 | 2026-04-04 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/concurrentToolExecutor.test.ts` | 483 | 2026-04-04 | yes | reachable only via tests |
| `packages/agents/src/shared/teamsOutputTools.ts` | 479 | 2026-04-07 | yes | reachable only via tests |
| `packages/dashboard/src/components/governance/EnterpriseKpiDashboard.tsx` | 476 | 2026-04-17 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer18-tool-access.ts` | 465 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/shared/figmaTools.ts` | 454 | 2026-03-03 | yes | reachable only via tests |
| `packages/scheduler/src/agentDreamConsolidator.ts` | 439 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/shared/entraHRTools.ts` | 430 | 2026-03-11 | yes | reachable only via tests |
| `packages/agents/src/shared/userResearchTools.ts` | 424 | 2026-03-19 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer23-tenant-isolation.ts` | 423 | 2026-03-07 | yes | reachable only via tests |
| `packages/agents/src/shared/storybookTools.ts` | 417 | 2026-03-21 | yes | reachable only via tests |
| `packages/dashboard/src/components/governance/CommandCenter.tsx` | 416 | 2026-04-02 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer11-dashboard.ts` | 397 | 2026-04-07 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/hookLifecycle.test.ts` | 371 | 2026-04-04 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/memoryConsolidation.test.ts` | 354 | 2026-04-04 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer14-migrations.ts` | 353 | 2026-03-17 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer17-mcp-servers.ts` | 330 | 2026-03-16 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/circuitBreaker.test.ts` | 329 | 2026-04-04 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer15-agent-autonomy.ts` | 295 | 2026-03-12 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/awaySummary.test.ts` | 294 | 2026-04-05 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer30-tool-execution.ts` | 294 | 2026-04-05 | yes | reachable only via tests |
| `packages/agents/src/shared/webBuildTools.test.ts` | 289 | 2026-04-12 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/jitContextRetriever.test.ts` | 264 | 2026-04-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/reasoningEngine.test.ts` | 254 | 2026-03-23 | yes | reachable only via tests |
| `packages/scheduler/src/platformIntelApproval.ts` | 247 | 2026-04-07 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/denialTracking.test.ts` | 244 | 2026-04-04 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer27-schema-consistency.ts` | 235 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/shared/memoryTools.safe.ts` | 197 | 2026-04-04 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/redisCache.test.ts` | 194 | 2026-02-27 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer22-reasoning.ts` | 191 | 2026-03-18 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer04-orchestration.ts` | 190 | 2026-03-02 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer05-communication.ts` | 183 | 2026-03-11 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/buildTool.test.ts` | 178 | 2026-04-04 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer28-advancement-rollout.ts` | 175 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer00-infra.ts` | 173 | 2026-03-02 | yes | reachable only via tests |
| `packages/agents/src/platform-intel/run.ts` | 166 | 2026-04-17 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer26-slack-platform.ts` | 161 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer13-m365.ts` | 159 | 2026-03-11 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer24-routing.ts` | 155 | 2026-03-23 | yes | reachable only via tests |
| `packages/agents/src/shared/socialMediaTools.test.ts` | 149 | 2026-03-08 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer20-graphrag.ts` | 148 | 2026-03-06 | yes | reachable only via tests |
| `packages/design-system/src/anti-ai-smell-registry/tokens.ts` | 142 | 2026-04-21 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer25-governance-change-requests.ts` | 140 | 2026-03-16 | yes | reachable only via tests |
| `packages/agents/src/frontend-engineer/run.ts` | 128 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer19-worker.ts` | 128 | 2026-03-06 | yes | reachable only via tests |
| `packages/agents/src/platform-engineer/run.ts` | 127 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer21-world-model.ts` | 127 | 2026-03-06 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer12-voice.ts` | 120 | 2026-03-17 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer06-authority.ts` | 119 | 2026-03-11 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/skillLearning.test.ts` | 117 | 2026-03-12 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/planningPolicy.test.ts` | 116 | 2026-04-09 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer07-intelligence.ts` | 115 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/main.ts` | 112 | 2026-04-05 | yes | reachable only via tests |
| `packages/agents/src/head-of-hr/run.ts` | 109 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer03-heartbeat.ts` | 109 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/ui-ux-designer/run.ts` | 108 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/toolRetriever.test.ts` | 105 | 2026-04-09 | yes | reachable only via tests |
| `packages/agents/src/shared/accessAuditTools.ts` | 105 | 2026-03-16 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/jitContextSelector.test.ts` | 104 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/global-admin/run.ts` | 103 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/modelsValidation.test.ts` | 102 | 2026-04-18 | yes | reachable only via tests |
| `packages/agents/src/shared/figmaAuth.ts` | 101 | 2026-03-03 | yes | reachable only via tests |
| `packages/agents/src/competitive-research-analyst/run.ts` | 99 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/devops-engineer/run.ts` | 99 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/market-research-analyst/run.ts` | 99 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/m365-admin/run.ts` | 98 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer01-data-syncs.ts` | 97 | 2026-04-10 | yes | reachable only via tests |
| `packages/agents/src/template-architect/run.ts` | 96 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/taskOutcomeHarvester.test.ts` | 95 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/platform-intel/systemPrompt.ts` | 93 | 2026-04-06 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/sessionMemoryUpdater.test.ts` | 92 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/quality-engineer/run.ts` | 92 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer10-specialists.ts` | 91 | 2026-03-18 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer02-model-clients.ts` | 90 | 2026-03-02 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer29-per-run-evaluation.ts` | 88 | 2026-03-17 | yes | reachable only via tests |
| `packages/agents/src/design-critic/run.ts` | 87 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/social-media-manager/run.ts` | 85 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/layers/layer09-strategy.ts` | 85 | 2026-03-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/historyManager.test.ts` | 84 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/utils/http.ts` | 84 | 2026-03-06 | yes | reachable only via tests |
| `packages/agents/src/user-researcher/run.ts` | 79 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/utils/report.ts` | 78 | 2026-03-01 | yes | reachable only via tests |
| `packages/agents/src/competitive-intel/run.ts` | 77 | 2026-04-11 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/behavioralFingerprint.test.ts` | 72 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/layers/layer08-knowledge.ts` | 70 | 2026-03-06 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/compaction.test.ts` | 69 | 2026-03-12 | yes | reachable only via tests |
| `packages/smoketest/src/utils/db.ts` | 66 | 2026-03-01 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/domainRouter.test.ts` | 65 | 2026-03-24 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/verificationPolicy.test.ts` | 62 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/shared/contentTools.test.ts` | 61 | 2026-03-08 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/summaryFirstCompaction.test.ts` | 60 | 2026-04-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/dashboardChatEmbeds.test.ts` | 57 | 2026-04-04 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/microCompactor.test.ts` | 54 | 2026-04-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/subtaskRouter.test.ts` | 49 | 2026-03-24 | yes | reachable only via tests |
| `packages/smoketest/src/index.ts` | 49 | 2026-03-06 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/executionPlanning.test.ts` | 41 | 2026-04-02 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/historyCompressor.test.ts` | 39 | 2026-04-04 | yes | reachable only via tests |
| `packages/agents/src/shared/createEvalRunDeps.ts` | 38 | 2026-04-23 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/supervisorWorkloadStallPolicy.test.ts` | 36 | 2026-04-09 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/v4aDiff.test.ts` | 34 | 2026-03-11 | yes | reachable only via tests |
| `packages/smoketest/src/utils/test.ts` | 34 | 2026-03-02 | yes | reachable only via tests |
| `packages/agents/src/ui-ux-designer/systemPrompt.ts` | 31 | 2026-04-04 | no | recent (<30d) but no prod inbound |
| `packages/smoketest/src/utils/gcloud.ts` | 31 | 2026-03-01 | yes | reachable only via tests |
| `packages/smoketest/src/types.ts` | 30 | 2026-03-12 | yes | reachable only via tests |
| `packages/agents/src/shared/__tests__/reactiveTurnBudget.test.ts` | 29 | 2026-04-09 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/tracing.test.ts` | 28 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/frontend-engineer/systemPrompt.ts` | 26 | 2026-04-04 | no | recent (<30d) but no prod inbound |
| `packages/agents/src/quality-engineer/systemPrompt.ts` | 25 | 2026-04-04 | no | recent (<30d) but no prod inbound |
| `packages/agent-runtime/src/__tests__/actionRiskClassifier.test.ts` | 24 | 2026-04-07 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/supervisorDefaults.test.ts` | 20 | 2026-04-08 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/ssrfGuard.test.ts` | 18 | 2026-04-02 | yes | reachable only via tests |
| `packages/agents/src/shared/legalTools.ts` | 17 | 2026-03-05 | yes | reachable only via tests |
| `packages/agents/src/shared/hrTools.ts` | 13 | 2026-03-05 | yes | reachable only via tests |
| `packages/agent-runtime/src/__tests__/taskIdentity.test.ts` | 11 | 2026-03-10 | yes | reachable only via tests |

## (c) Stale Comments / TODOs (>60 days)

Methodology: scanned all source for `TODO|FIXME|XXX|HACK|DEPRECATED|@ts-ignore|eslint-disable` (case-insensitive). 142 markers across 52 files. Two filters applied:

1. **Blame-based** (top-12 marker files, `git blame --line-porcelain`): a line's author-time > 60 days ago.
2. **mtime proxy** (all other files): file last-modified > 60 days ago — flags the file holistically.

### (c.1) Blame-confirmed stale lines

**`packages/agent-runtime/src/providers/openai.ts`** (3 stale)

| Date | SHA | Line |
|---|---|---|
| 2026-02-24 | `068a0a24` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |
| 2026-02-25 | `7fd614b3` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |
| 2026-02-25 | `7d33954f` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |

**`packages/agent-runtime/src/providers/gemini.ts`** (3 stale)

| Date | SHA | Line |
|---|---|---|
| 2026-02-24 | `068a0a24` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |
| 2026-02-24 | `068a0a24` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |
| 2026-02-24 | `068a0a24` | `// eslint-disable-next-line @typescript-eslint/no-explicit-any` |

**`packages/agents/src/competitive-intel/tools.ts`** (1 stale)

| Date | SHA | Line |
|---|---|---|
| 2026-02-22 | `27195001` | `parameters: { source: { type: 'string', description: 'Source (github, hackernews, producthunt, pricing, etc.)', required: true }, subject: {` |

_Most marker-bearing files (e.g., `claudeParityTools.ts`, `models.ts`, `validate-db-models.js`) have all current TODO/FIXME lines authored within the last 60 days — no blame-stale entries._

### (c.2) mtime-stale marker-bearing files (>60d unmodified)

| File | Markers | Last write |
|---|---:|---|
| `packages/dashboard/src/stories/Header.stories.ts` | 2 | 1984-06-22 (Storybook scaffold) |
| `packages/dashboard/src/stories/Button.stories.ts` | 2 | 1984-06-22 (Storybook scaffold) |

_The 1984 timestamp is the Storybook generator default; both files are flagged as Definitely Dead in §(a)._

## (d) Files imported only by themselves or in cycles

_No incoming edges from any other file (excluding self), but the file does have outgoing imports — i.e. it imports things, but nothing imports it._

| File | LOC |
|---|---:|
| `packages/agent-runtime/src/config/agentEntraRoles.ts` | 123 |
| `packages/agents/src/chief-of-staff/domainRouter.ts` | 300 |
| `packages/agents/src/competitive-intel/run.ts` | 77 |
| `packages/agents/src/competitive-research-analyst/run.ts` | 99 |
| `packages/agents/src/design-critic/run.ts` | 87 |
| `packages/agents/src/devops-engineer/run.ts` | 99 |
| `packages/agents/src/frontend-engineer/run.ts` | 128 |
| `packages/agents/src/global-admin/run.ts` | 103 |
| `packages/agents/src/head-of-hr/run.ts` | 109 |
| `packages/agents/src/m365-admin/run.ts` | 98 |
| `packages/agents/src/market-research-analyst/run.ts` | 99 |
| `packages/agents/src/platform-engineer/run.ts` | 127 |
| `packages/agents/src/platform-intel/run.ts` | 166 |
| `packages/agents/src/quality-engineer/run.ts` | 92 |
| `packages/agents/src/shared/createEvalRunDeps.ts` | 38 |
| `packages/agents/src/shared/executiveOrchestrationTools.ts` | 836 |
| `packages/agents/src/shared/memoryTools.safe.ts` | 197 |
| `packages/agents/src/shared/patchHarness.ts` | 2 |
| `packages/agents/src/shared/v4aDiff.ts` | 2 |
| `packages/agents/src/social-media-manager/run.ts` | 85 |
| `packages/agents/src/template-architect/run.ts` | 96 |
| `packages/agents/src/ui-ux-designer/run.ts` | 108 |
| `packages/agents/src/user-researcher/run.ts` | 79 |
| `packages/dashboard/src/components/governance/CommandCenter.tsx` | 416 |
| `packages/dashboard/src/components/governance/EnterpriseKpiDashboard.tsx` | 476 |
| `packages/dashboard/src/components/FounderBriefing.tsx` | 278 |
| `packages/dashboard/src/components/SystemHealth.tsx` | 118 |
| `packages/dashboard/src/lib/supabase.ts` | 4 |
| `packages/dashboard/src/stories/Button.stories.ts` | 46 |
| `packages/dashboard/src/stories/Header.stories.ts` | 28 |

**Notable pattern — non-executive agent runners.** `packages/agents/src/index.ts` exports only **12** of **28** agent folders. The remaining **16** have a `run.ts` that nothing imports:

```
competitive-intel, competitive-research-analyst, design-critic, devops-engineer,
frontend-engineer, global-admin, head-of-hr, m365-admin, market-research-analyst,
platform-engineer, platform-intel, quality-engineer, social-media-manager,
template-architect, ui-ux-designer, user-researcher
```

These agents may be loaded via `runDynamicAgent` (DB-defined per the `index.ts` comment), in which case the file-based runner is genuinely orphaned and should either be deleted or wired into a registry. Their sibling `tools.ts` and `systemPrompt.ts` modules drag along thousands of LOC (see §(a) — `global-admin/tools.ts` alone is 1,582 LOC).

## (e) Exported symbols never imported externally

_A full per-symbol audit was not performed (cost-prohibitive without a TypeScript language-service pass). Heuristic findings:_

- The 60 files in §(a) that ship `export` declarations (most do) export symbols that are by definition never imported.
- `packages/agents/src/shared/packetSchemas.ts` (223 LOC, 2026-03-01) — exports zod schemas referenced nowhere.
- `packages/agents/src/shared/codexTools.ts` (190 LOC, 2026-03-16) — `createCodexTools` factory unused.
- `packages/agents/src/shared/executiveOrchestrationTools.ts` (836 LOC, 2026-03-30) — flagged §(b); reachable only from tests.
- `packages/scheduler/src/agentLifecycle.ts` (151 LOC, 2026-03-19) and `packages/scheduler/src/agentDreamConsolidator.ts` (439 LOC, 2026-04-11) — exported but no inbound from `server.ts` or other scheduler entrypoints.
- `packages/worker/src/queue.ts` (60 LOC, 2026-03-01) — exported queue helper not consumed by `worker/src/index.ts`.
- `packages/agent-runtime/src/config/agentEntraRoles.ts` (123 LOC, 2026-03-18) — config map exported but unread.

_Recommend a follow-up pass with `ts-prune` or `knip` once the package-graph stabilises._

## (f) Entire packages whose only consumers are other dead code

| Package | Files | LOC | Notes |
|---|---:|---:|---|
| `packages/agent-sdk` | 3 | 116 | no inbound from any other package |
| `packages/design-system` | 1 | 142 | no inbound from any other package |

- **`packages/agent-sdk`** — 3 files, 116 LOC. Not imported by any other workspace package. Either pre-public-API scaffolding or a stale extraction; verify intent before keeping.
- **`packages/design-system`** — 1 file, 142 LOC. Not consumed by `dashboard` or any other package. Likely an aborted extraction; the dashboard inlines its own `components/ui/*` instead.

## Recommendations (severity-ranked)

1. **High — agents package bloat.** ~7,000 LOC across 16 non-executive agent folders is unreachable from `packages/agents/src/index.ts`. Either (a) export them, (b) document `runDynamicAgent` as the entrypoint and add an integration test that proves it, or (c) delete.
2. **High — dashboard component graveyard.** 20 dashboard files in DD (`FounderBriefing.tsx` 278 LOC, `hero-1.tsx` 159 LOC, `SystemHealth.tsx` 118 LOC, `CommandCenter.tsx` 416 LOC, `EnterpriseKpiDashboard.tsx` 476 LOC, etc.) — none referenced from the Next.js `app/`/`pages/` tree. Delete or wire up.
3. **Medium — orphan workspace packages.** `agent-sdk` and `design-system` add npm-install latency and TS project-reference noise without consumers.
4. **Medium — scheduler dead modules.** `agentLifecycle.ts`, `agentDreamConsolidator.ts`, `czShadowEval.ts` (762 LOC, recent) are not wired into `server.ts`. Verify they aren't scheduled via Cloud Scheduler HTTP routes (those would not show up in static imports).
5. **Low — TODO hygiene.** Only 7 blame-stale comment lines (>60d) across the top marker files; backlog is healthy. No action required beyond resolving the 3 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` lines in `providers/openai.ts` / `gemini.ts`.
