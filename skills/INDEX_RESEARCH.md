# Research & Intelligence Team Skills — Implementation Index

## Agent → Skill Mapping

| Agent | Role | Reports To | Runner Type | Skills |
|-------|------|------------|-------------|--------|
| Sophia Lin | VP Research & Intelligence | Sarah Chen | OrchestratorRunner | `research-management` (NEW) |
| Lena Park | Competitive Research Analyst | Sophia Lin | TaskRunner | `competitive-intelligence` (NEW, in marketing/) |
| Daniel Okafor | Market Research Analyst | Sophia Lin | TaskRunner | `market-research` (NEW) |

> **Note:** Sophia runs as an **OrchestratorRunner** (OBSERVE→PLAN→DELEGATE→MONITOR→EVALUATE), same tier as CTO, CoS, CLO, and Ops. She is not a sub-team TaskRunner — she orchestrates the research operation.

> **Note:** `competitive-intelligence` lives in `skills/marketing/` because it's shared with Zara Petrov (Marketing Intelligence Analyst). Lena holds the same skill but serves the Research department's strategic needs rather than marketing's competitive monitoring needs. The skill itself defines the Lena vs. Zara distinction.

## Architecture References

**Multi-wave workflow:**
```
Sarah → Sophia (decompose) → Lena + Daniel (parallel research)
  → Sophia (QC, gap-fill, cover memo) → Executive consumer
```
Supported by `merge_research_packet` RPC.

**Research packet schemas:** 15 types in `packetSchemas.ts`:
CompetitorProfiles, MarketData, TechnicalLandscape, IndustryTrends,
CompanyProfile, StrategicDirection, and more.

**Tool files:**
- `researchRepoTools.ts` — 4 tools: persistent research repository with text search, research briefs
- `researchMonitoringTools.ts` — 14 tools: monitors, academic papers, OSS tracking, regulatory, AI benchmarks, synthesis
- `researchTools.ts` — web_search, web_fetch, submit_research_packet
- `competitiveIntelTools.ts` — 7 tools: competitor tracking/profiles, feature comparison, pricing, market landscape

**Strategy Lab integration:**
```
Strategy Lab v2 (strategyLabEngine.ts):
  Phase 1: RESEARCH — Sophia's team gathers data
  Phase 2: ANALYSIS — Executives apply 6 frameworks
    (Ansoff, BCG, Blue Ocean, Porter's, PESTLE, SWOT)
  Phase 3: SYNTHESIS — Sarah merges final deliverable

Deep Dive (deepDiveEngine.ts):
  SCOPE → RESEARCH → ANALYZE → SYNTHESIZE
  Cross-model verified evidence, infographic generation

Analysis Engine (analysisEngine.ts):
  PLAN → SPAWN (temp agents) → EXECUTE → SYNTHESIZE → CLEANUP
  5 analysis types, 3 depth levels
```

**Agent schedules:**
- Sophia: daily research operations run
- Lena: competitive monitoring run
- Daniel: market intelligence run

## Size Comparison

| Skill | Old | New |
|-------|-----|-----|
| research-management | (didn't exist) | ~155 lines, 19 tools |
| market-research | (didn't exist) | ~150 lines, 21 tools |
| competitive-intelligence | (didn't exist) | ~140 lines, 27 tools (in marketing/) |

## Key Design Decisions

**1. Sophia's skill is about orchestration, not research.** The research-management skill focuses on decomposition, QC, cover memos, gap identification, and proactive intelligence. Sophia doesn't do raw research — she makes her analysts' research better and ensures it reaches executives in a form they can act on. The QC checklist (completeness, source quality, accuracy, confidence assessment) is the core of the skill.

**2. Cover memos are specified as a distinct output type.** The skill defines a cover memo structure that tells executives exactly where the value is in a research packet: key findings, attention areas, and data gaps. This is what turns a data dump into executive-ready intelligence.

**3. Daniel's skill teaches sourcing discipline.** Market research quality depends on source quality. The skill defines a 4-tier source hierarchy (Primary → Tier 1 analyst → Tier 2 analyst → News/media → Community) with explicit guidance on when each tier is appropriate and when it isn't. "Never cite a Statista preview page as if you have the full data" — this is the kind of judgment a checklist can't provide.

**4. Market sizing methodology is explicit.** The skill teaches TAM/SAM/SOM with both top-down and bottom-up approaches, then requires triangulation. It explains that a 5x gap between top-down and bottom-up reveals faulty assumptions in one approach, not a wide market.

**5. Proactive research is an explicit responsibility.** Sophia's skill mandates weekly proactive work: `identify_research_gaps`, monitoring for signals that should trigger research (competitor funding, regulatory changes, market shifts), and briefing Sarah when something important happens — without waiting to be asked.

**6. Research repository hygiene is built in.** Both skills emphasize `save_research` with proper tagging and `search_research` before starting new work. The repository is institutional memory — the skills teach agents to maintain it, not just use it.

## File Inventory

```
skills/research/
├── research-management.md      # NEW — Sophia Lin (VP Research)
├── market-research.md          # NEW — Daniel Okafor
└── INDEX.md                    # This file

Also relevant (in marketing/):
├── competitive-intelligence.md # NEW — shared: Lena Park + Zara Petrov
```

## Cross-Team Notes

- `competitive-intelligence` is shared between Research (Lena) and Marketing (Zara). Both directories should reference it. The skill itself defines the distinction: Lena goes deep on strategic profiles for executives; Zara goes wide on marketing signals for the CMO.
- Strategy Lab v2, Deep Dive, and Analysis engines all consume research output. The packet schemas in `packetSchemas.ts` are the interface contract — both skills reference the need to use correct schemas.
- Sophia's output often feeds directly into Sarah's synthesis work. The cover memo format is designed to save Sarah time — she reads 4 sentences, not 40 pages.
