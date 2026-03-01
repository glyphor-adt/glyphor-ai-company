# How Strategy Research Is Produced

> How Glyphor's AI agent team researches, reasons, verifies, and delivers strategic intelligence.

---

## Overview

Strategy research at Glyphor is produced by a **multi-agent, multi-wave pipeline** where specialized research analysts gather data, executive-perspective agents analyze it, and a reasoning engine verifies the output before delivery. Every piece of research carries source citations, confidence scores, and a full audit trail of the reasoning process.

Three distinct research products are produced:

| Product | Purpose | Depth |
|---------|---------|-------|
| **Strategic Analyses** | Multi-perspective SWOT reports driven by a specific question | Quick / Standard / Deep |
| **Deep Dives** | Comprehensive 8-area research on a company or market | 40+ web searches, full report |
| **Chain of Thought (CoT) Analyses** | Decision reasoning with structured decomposition | Full audit trail |

---

## 1. Strategic Analyses — Multi-Perspective Intelligence

### How It Works

The Analysis Engine (`packages/scheduler/src/analysisEngine.ts`) takes a strategic question and runs it through three phases:

```
QUESTION  →  Plan  →  Execute (parallel)  →  Synthesize  →  REPORT
```

**Phase 1 — Plan:** The question is broken into research threads, each assigned to an executive perspective.

**Phase 2 — Execute:** All threads run in parallel via direct model calls. Each perspective gets a tailored prompt and depth instruction.

**Phase 3 — Synthesize:** Thread results are merged into a structured SWOT report with prioritized recommendations.

### Analysis Types & Perspectives

Each analysis type is evaluated by a specific set of agents chosen for their domain relevance:

| Analysis Type | Perspectives |
|---------------|-------------|
| Market Opportunity | CMO, VP Sales, CFO, CPO |
| Competitive Landscape | Competitive Intel, CTO, CMO, VP Sales |
| Product Strategy | CPO, CTO, User Researcher, VP Design |
| Growth Diagnostic | CMO, VP Sales, VP Customer Success, CFO |
| Risk Assessment | CFO, CTO, Ops, Chief of Staff |

### Depth Levels

| Depth | Instruction |
|-------|-------------|
| **Quick** | Concise 2–3 paragraph analysis |
| **Standard** | Thorough analysis with supporting reasoning |
| **Deep** | Exhaustive, deeply researched analysis with data references and edge cases |

### Output Format

Every analysis produces:
- **Summary** — executive-level overview
- **SWOT matrix** — strengths, weaknesses, opportunities, threats
- **Recommendations** — prioritized action items (high / medium / low)
- **Thread details** — the raw perspective-level research for drill-down

### Status Flow

```
planning → executing → synthesizing → completed | failed
```

---

## 2. Deep Dives — Comprehensive Company & Market Research

### How It Works

A Deep Dive is a structured research report covering **8 research areas** with **5 web searches per area** (40+ total searches). The process flows through 5 stages:

```
scoping → researching → analyzing → synthesizing → completed
```

**Scoping:** Define the target (company, market, technology) and determine the 8 research areas.

**Researching:** Execute web searches across all research areas using `web_search` and `web_fetch` tools. Each source is captured with URL, title, snippet, and publication date.

**Analyzing:** Research packets are submitted by specialist analysts and validated against quality standards.

**Synthesizing:** All findings are combined into a comprehensive report with SWOT analysis, financial data, competitive positioning, recommendations, roadmap, and ROI analysis.

### Research Team

Deep dives are staffed by a dedicated research team under the VP of Research (Sophia Lin):

| Analyst | Name | Focus Area | Packet Type |
|---------|------|-----------|-------------|
| Competitive Research Analyst | Lena Park | Competitors, pricing, reviews | `competitor_profiles` |
| Market Research Analyst | Daniel Okafor | TAM/SAM, financials, funding data | `market_data` |
| Technical Research Analyst | Kai Nakamura | APIs, tech stacks, technical moats | `technical_landscape` |
| Industry Research Analyst | Amara Diallo | PESTLE, regulation, macro trends | `industry_trends` |

### Research Tools

Each analyst has access to:

- **`web_search(query, num_results, time_range)`** — Returns title, URL, snippet, and date for each result
- **`web_fetch(url, max_length)`** — Extracts and returns page text (HTML stripped)
- **`search_news(query, num_results)`** — News-specific search for recent coverage
- **`submit_research_packet(analysis_id, packet_type, data, sources, confidence_level, data_gaps, conflicting_data)`** — Atomically merges findings into the analysis record via database RPC

### Quality Standards

The VP of Research validates every research packet against strict criteria:

| Domain | Minimum Standard |
|--------|-----------------|
| **Competitive** | 5+ competitors with pricing from product pages + reviews checked |
| **Market** | TAM from reputable source (Gartner, Statista) + methodology + multiple estimates |
| **Technical** | APIs verified from official docs, specific models identified, moats with evidence |
| **Industry** | All PESTLE categories covered, current regulation (2025–2026), trend evidence cited |

If a packet fails QC, the VP Research triggers follow-up research to fill gaps.

### Output

The final deep dive report includes:
- Full strategic report (SWOT, financials, competitive analysis)
- Actionable recommendations with roadmap
- ROI analysis
- Source citations with confidence scores
- AI-generated visual infographic (`visual_image` field)
- Verification summary with flagged claims and corrections

---

## 3. Chain of Thought (CoT) Analyses — Decision Reasoning

### How It Works

CoT analyses provide a structured reasoning audit trail for strategic decisions. Every analysis passes through 5 stages:

```
planning → decomposing → mapping → analyzing → validating → completed
```

### The Reasoning Protocol

Every agent that performs strategic work wraps its internal reasoning in a structured XML block before producing its final output:

```xml
<reasoning>
  <approach>How the agent approached this task and why</approach>
  <tradeoffs>Key tradeoffs considered</tradeoffs>
  <risks>Risks identified with the chosen approach</risks>
  <alternatives>Alternatives rejected and why</alternatives>
</reasoning>
```

This reasoning block is:
- **Captured** by the platform for quality review and decision auditing
- **Not shown** to founders in standard views (available in agent detail drill-downs)
- **Stored** alongside the output for provenance tracking

### Data Honesty Rule

All agents operate under a non-negotiable data honesty rule:

- If a tool returns null, empty, or "no data" — the agent must say so explicitly and stop
- Agents never invent, assume, or extrapolate metrics, activity, or statuses
- Agents never fabricate companies, prospects, deals, customers, or pipeline opportunities
- If asked about something with no data, the agent responds: *"I have no data on that right now — [tool name] returned nothing."*

### Thinking-Enabled Tasks

Certain high-stakes tasks are flagged for extended reasoning with longer timeouts (90s vs. 30s standard):

- Morning briefings
- End-of-day summaries
- Orchestration runs
- Daily cost checks
- Weekly usage analysis
- Weekly content planning

These tasks run with `thinkingEnabled: true` across multiple model families.

---

## 4. The Reasoning Engine — Multi-Pass Verification

The Reasoning Engine (`packages/agent-runtime/src/reasoningEngine.ts`) wraps every strategic output in a multi-pass verification pipeline before it reaches the dashboard.

### Verification Passes

Each output can go through up to 6 types of verification:

| Pass Type | What It Checks |
|-----------|---------------|
| **Self-Critique** | Logical errors, unsupported claims, gaps |
| **Consistency Check** | Internal contradictions, conflicts with context |
| **Factual Verification** | Accuracy of claims, unverifiable statements |
| **Goal Alignment** | Whether output matches the task objectives and agent role |
| **Cross-Model Consensus** | Independent assessment from multiple AI models |
| **Value Analysis** | Practical value and actionability of the output |

### How Verification Works

```
Agent Output
     ↓
┌─────────────────────────────────────────────┐
│  Pass 1: Self-Critique         → confidence │
│  Pass 2: Consistency Check     → confidence │
│  Pass 3: Factual Verification  → confidence │
│  Pass 4: Goal Alignment        → confidence │
│  Pass 5: Cross-Model Consensus → confidence │
│  Pass 6: Value Analysis        → confidence │
└─────────────────────────────────────────────┘
     ↓
Overall Confidence (geometric mean of all passes)
     ↓
  confidence ≥ threshold? → ✅ Verified
  confidence < threshold? → 🔄 Revision (up to 2 attempts)
```

### Cross-Model Consensus

For high-stakes outputs, the engine runs the same verification across up to 3 different models in parallel:

| Model | Tier |
|-------|------|
| Gemini 3 Flash Preview | Fast / cost-effective verification |
| GPT-5.2 | Mid-tier independent check |
| Claude Opus 4.6 | High-fidelity verification |

The consensus of all three models determines whether the output is trustworthy.

### Budget Guards

Verification has a configurable budget ceiling. If the reasoning budget is exhausted, remaining passes are skipped and the output proceeds with partial verification. This prevents runaway costs on routine tasks.

### Auto-Revision

If any pass returns confidence below the minimum threshold and includes actionable suggestions, the engine automatically revises the output (up to 2 revision attempts) and re-verifies.

### Value Gate

Before executing expensive tasks, the engine runs a lightweight **value assessment**:

| Score | Meaning | Action |
|-------|---------|--------|
| 0.0–0.3 | Low value (redundant or trivial) | Abort |
| 0.3–0.6 | Moderate value | Simplify execution |
| 0.6–1.0 | High value | Proceed with full execution |

This prevents wasting compute on tasks that won't yield useful output.

---

## 5. Collective Intelligence — How Agents Build on Each Other

Research doesn't happen in isolation. Agents share knowledge through a 5-layer memory architecture:

| Layer | Name | What It Stores |
|-------|------|---------------|
| 1 | **Company Pulse** | Real-time company state: MRR, status, team mood |
| 2 | **Shared Episodes** | Cross-agent episodic memory (pgvector 768-dim semantic search) |
| 3 | **Organizational Knowledge** | Promoted insights by category: cross-functional, causal links, policies, constraints, capabilities, risks, opportunities |
| 4 | **Shared Procedures** | Reusable playbooks (proposed → active → deprecated) with tracked success rates |
| 5 | **Agent World Model** | Per-agent self-awareness: strengths, weaknesses, task-type scores, prediction accuracy |

When an analyst discovers a critical insight during research, they can **promote it to organizational knowledge** where it becomes available to all agents via `promote_to_org_knowledge()`.

---

## 6. Knowledge Graph Integration

The GraphRAG indexer (`packages/graphrag-indexer/`) continuously builds a knowledge graph from two sources:

1. **Company documentation** — indexed from `docs/` and the SharePoint knowledge base
2. **Agent outputs** — completed assignments and research reports are indexed for entity extraction

The pipeline:
```
Source Documents → Auto-Tune Extraction → Entity/Relationship Indexing → kg_nodes / kg_edges tables
```

Research agents can query this knowledge graph via graph tools to find connections between entities, identify patterns across previous research, and ground their analysis in the company's accumulated knowledge.

---

## 7. End-to-End Research Flow

Putting it all together, here's how a strategic question becomes a verified research deliverable:

```
┌──────────────────────────────────────────────────────────────┐
│  1. INTAKE                                                    │
│     Question arrives (dashboard, directive, or scheduled)     │
│                           ↓                                   │
│  2. DECOMPOSITION                                             │
│     VP Research / Chief of Staff breaks question into briefs  │
│     Routes packets to appropriate analysts                    │
│                           ↓                                   │
│  3. PARALLEL RESEARCH (Wave 1)                                │
│     Lena → competitor_profiles                                │
│     Daniel → market_data                                      │
│     Kai → technical_landscape                                 │
│     Amara → industry_trends                                   │
│     (Each: web_search → web_fetch → submit_research_packet)   │
│                           ↓                                   │
│  4. QUALITY CHECK                                             │
│     VP Research validates sources, methodology, confidence    │
│     Flags gaps & conflicting data → triggers follow-up        │
│                           ↓                                   │
│  5. EXECUTIVE ANALYSIS (Wave 2)                               │
│     CPO / CFO / CMO / CTO apply strategic frameworks          │
│     Each wraps reasoning in <reasoning> XML blocks            │
│                           ↓                                   │
│  6. SYNTHESIS                                                 │
│     Chief of Staff combines all perspectives                  │
│     Builds SWOT, recommendations, roadmap                     │
│                           ↓                                   │
│  7. VERIFICATION                                              │
│     Reasoning Engine runs multi-pass verification             │
│     Cross-model consensus (Gemini + GPT + Claude)             │
│     Auto-revision if confidence below threshold               │
│                           ↓                                   │
│  8. DELIVERY                                                  │
│     Dashboard: Strategy Lab → Deep Dives / Analyses / CoT     │
│     Source citations, confidence scores, verification summary │
│     Reasoning blocks available for audit drill-down           │
└──────────────────────────────────────────────────────────────┘
```

---

## Database Tables

| Table | Purpose | Status Flow |
|-------|---------|-------------|
| `strategy_analyses` | Multi-wave analysis pipeline | planning → researching → analyzing → synthesizing → deepening → completed |
| `deep_dives` | Comprehensive research reports | scoping → researching → analyzing → synthesizing → completed |
| `cot_analyses` | Decision reasoning audit | planning → decomposing → mapping → analyzing → validating → completed |
| `agent_world_model` | Agent self-awareness | Updated via grades + reflection |
| `shared_episodes` | Cross-agent episodic memory | pgvector 768-dim, tagged by domain |
| `shared_procedures` | Reusable playbooks | proposed → active → deprecated |
| `decision_chains` | Provenance tracking | directive → agents → cost → outcome |

---

## Key Source Files

| Component | File |
|-----------|------|
| Analysis Engine | `packages/scheduler/src/analysisEngine.ts` |
| Reasoning Engine | `packages/agent-runtime/src/reasoningEngine.ts` |
| Reasoning XML Extraction | `packages/agent-runtime/src/reasoning.ts` |
| VP Research Orchestration | `packages/agents/src/vp-research/run.ts` |
| Research Tools (web_search, etc.) | `packages/agents/src/shared/researchTools.ts` |
| Collective Intelligence Tools | `packages/agents/src/shared/collectiveIntelligenceTools.ts` |
| Deep Dive Schema | `supabase/migrations/20260227100012_deep_dive_tables.sql` |
| CoT Schema | `supabase/migrations/20260227100008_cot_analyses.sql` |
| Strategy Lab v2 | `supabase/migrations/20260227100027_strategy_lab_v2.sql` |
| World Model Architecture | `supabase/migrations/20260227100034_world_model_architecture.sql` |
