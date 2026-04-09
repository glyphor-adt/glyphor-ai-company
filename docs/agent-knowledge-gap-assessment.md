# Agent Knowledge Gap Assessment — Scenario Sets

> **Purpose:** Test whether agents have enough information to perform their roles competently. Every wrong answer, hedge, or generic response reveals a specific knowledge gap to fill.
>
> **How to run:** Trigger each agent manually with the scenario as input. Read the output. Score each response. Document gaps.
>
> **Scoring:**
> - **PASS** — correct, specific to Glyphor, actionable
> - **SOFT FAIL** — directionally right but generic, hedging, or missing company specifics
> - **HARD FAIL** — wrong, contradicts company decisions, or "I don't have enough information"

---

## Maya Brooks — CMO

### Scenario 1: Brand Voice Execution
**Input:**
```
Write a LinkedIn post announcing Glyphor's AI Marketing Department for SMBs. 
This is the first public post about the product. Keep it under 200 words.
```
**What a PASS looks like:**
- Present tense, active voice
- No banned words (leverage, innovative, cutting-edge, revolutionary, game-changing, synergy, empower, unlock)
- No exclamation marks
- No hedging
- No AI self-reference ("our AI is so smart")
- Mentions Slack delivery model
- Talks about outcomes/deliverables, not technology
- Tone: confident, direct, slightly dry

**What reveals a gap:**
- Uses banned words → brand guide not internalized
- Exclamation marks or hype language → voice rules missing
- Talks about "AI agents" or "multi-agent system" → leaking internal architecture to external audience
- Generic "transform your marketing" fluff → no product specifics
- Mentions Teams → doesn't know Slack-first GTM

---

### Scenario 2: Competitive Differentiation
**Input:**
```
A prospect on LinkedIn comments: "How is this different from just using Lindy AI 
or hiring a virtual assistant?" Draft a reply. Keep it conversational but sharp.
```
**What a PASS looks like:**
- Knows Lindy is no-code single-agent, not a team
- Draws contrast: tool vs. department, prompting vs. outcomes
- Mentions specific deliverables Glyphor produces (content calendar, SEO analysis, social posts)
- Doesn't trash Lindy — positions Glyphor as different category
- Stays in brand voice

**What reveals a gap:**
- Can't describe Lindy at all → competitive landscape KB too thin
- Generic "we're better because AI" → no differentiation framework
- Describes internal architecture (multi-agent, orchestration) → doesn't understand external messaging boundaries
- Mentions pricing → shouldn't in a public comment

---

### Scenario 3: Brand Compliance Review
**Input:**
```
Tyler submitted this blog post opening paragraph for review. Is it on-brand? 
Identify every issue:

"We're thrilled to announce that Glyphor is revolutionizing the marketing 
landscape! By leveraging cutting-edge AI technology, we empower small businesses 
to unlock their full marketing potential. Our innovative platform utilizes 
advanced machine learning to drive unprecedented growth for our customers."
```
**What a PASS looks like:**
- Flags: thrilled (tone), revolutionizing (banned), leveraging (banned), cutting-edge (banned), empower (banned), unlock (banned), innovative (banned), utilizes (banned/pretentious), drive (banned as buzzword), unprecedented (hype)
- Flags the exclamation mark
- Flags "we're thrilled" as hedging/filler
- Flags "marketing landscape" as vague
- Flags "platform" — we sell a department, not a platform
- Provides a rewrite or direction for rewrite
- Catches that there are zero specific deliverables or customer outcomes mentioned

**What reveals a gap:**
- Misses more than 2 banned words → brand guide not loaded or not referenced
- Says "looks good with minor tweaks" → not enforcing brand standard
- Can't produce a rewrite → knows rules but can't apply them
- Doesn't catch "platform" framing → product positioning not internalized

---

### Scenario 4: Content Strategy Decision
**Input:**
```
Kai wants to post a meme on the Glyphor LinkedIn about "copilot fatigue" — 
it's a screenshot of someone yelling at Clippy with the caption 
"me after my copilot suggests I write my own email." 

Is this on-brand? Should we post it? Decide and explain your reasoning.
```
**What a PASS looks like:**
- Recognizes this is adjacent to "Still You" campaign messaging (copilot frustration)
- Evaluates tone: dry, sarcastic — aligns with brand
- Considers audience: VP Marketing at mid-market SaaS — will they relate?
- Makes a clear decision (yes/no) with reasoning, not "it depends"
- If yes: suggests timing relative to campaign launch
- If no: explains what would need to change
- Flags any trademark/IP concern with Clippy image

**What reveals a gap:**
- Doesn't know about "Still You" campaign → current priorities not loaded
- Can't assess brand tone fit → voice rules are abstract, not practical
- Waffles with "it depends on your audience" → no ICP knowledge
- Doesn't consider campaign sequencing → no awareness of directive dependencies

---

### Scenario 5: Channel Strategy
**Input:**
```
Andrew asks: "Should we be on TikTok?" Give him a recommendation he can 
decide on in 30 seconds.
```
**What a PASS looks like:**
- Clear no (or not now) with one-line reason
- Knows ICP is SMB founder/marketing leader, 5-50 employees — they're on LinkedIn, not TikTok
- Knows the team is Tyler + Lisa + Kai — no bandwidth for another channel before current ones produce results
- Knows the doctrine: no expansion without revenue milestones
- Formatted for 30-second decision (respects founder time constraint)

**What reveals a gap:**
- Says "let's test it" without resource analysis → doesn't understand team constraints
- Long strategy memo → doesn't know founder time is scarce (5-10 hrs/week)
- Can't name current channels → marketing context file gaps
- Generic social media advice → no company-specific reasoning

---

## Marcus Reeves — CTO

### Scenario 1: Incident Triage
**Input:**
```
Atlas flagged: agent abort rate jumped to 35% in the last 2 hours. 
8 of the last 20 runs are aborting. Diagnose. What do you check first?
```
**What a PASS looks like:**
- Checks which specific agents are aborting (concentrated or distributed)
- Checks if it's a specific task type (scheduled vs. on_demand vs. event_response)
- Knows to look at late-turn token counts (history compression issue)
- Knows to check MCP server health (timeout during tool init — the death loop pattern)
- Knows the precheck skip logic and checks if it's misclassifying real runs
- References the $150/month budget concern if agents are burning tokens on failing runs
- Prioritized checklist, not a wall of text

**What reveals a gap:**
- Generic "check the logs" → no knowledge of specific failure patterns in the system
- Doesn't mention token/context window issues → doesn't know about history compression
- Doesn't mention MCP init timeouts → doesn't know about the death loop pattern
- Doesn't know which table to query (agent_runs) → infrastructure context missing

---

### Scenario 2: Architecture Decision
**Input:**
```
Kristina asks: "We need to add HubSpot integration for tracking prospects 
that Rachel identifies. Should we build a new MCP server, add tools to an 
existing one, or use a third-party connector? Give me a recommendation I 
can approve in 30 seconds."
```
**What a PASS looks like:**
- Knows we have 10 internal MCP servers + 9 Microsoft Agent 365 MCP servers
- Evaluates: does this fit in an existing server (e.g., mcp-sales-server if one exists)?
- Considers Rachel's current toolset — what does she have, what's she missing?
- Considers maintenance burden (another server to maintain at current team size)
- Evaluates third-party MCP connectors if any exist for HubSpot
- Recommendation formatted for 30-second founder decision
- Includes cost/effort estimate

**What reveals a gap:**
- Doesn't know the MCP server inventory → infrastructure KB not detailed enough
- Doesn't know Rachel's current tools → cross-department awareness missing
- Suggests something that conflicts with existing architecture → infrastructure section too thin
- Overcomplicates it → doesn't respect the 30-second decision format

---

### Scenario 3: Deploy Risk Assessment
**Input:**
```
Alex submitted a PR that upgrades pgvector from 0.5 to 0.7 on Cloud SQL. 
He says it enables HNSW indexes which would speed up knowledge graph queries 
by 10x. Should we merge and deploy? What's your risk assessment?
```
**What a PASS looks like:**
- Knows we're on Cloud SQL PostgreSQL with pgvector (86 tables)
- Assesses: does Cloud SQL support pgvector 0.7? (managed service version constraints)
- Assesses: migration impact on 86 tables — which use vector columns?
- Assesses: downtime risk — can we do this without taking the DB offline?
- Assesses: rollback plan if the upgrade breaks vector queries
- Assesses: who's affected — knowledge graph extraction uses this, what agents depend on it?
- Weighs 10x improvement against risk at current scale (do we even need 10x right now?)
- Makes a clear recommendation: merge/don't merge/merge with conditions

**What reveals a gap:**
- Doesn't know we're on Cloud SQL (thinks we manage our own Postgres) → infra KB gap
- Doesn't know about the 86 tables → schema awareness missing
- Generic "test it in staging first" without knowing if we have a staging environment → operational context missing
- Can't assess who depends on vector queries → doesn't know the knowledge graph pipeline

---

### Scenario 4: Cost Investigation
**Input:**
```
Nadia flagged: yesterday's compute was $11.40, which is 2.3x the daily budget 
($5/day for $150/month). The spike came from 3 agents. Investigate and recommend.
```
**What a PASS looks like:**
- Knows the $150/month budget and can do the daily math ($5/day)
- Knows to check agent_runs for those 3 agents — token counts, model used, run count
- Knows about resolveModel.ts routing — were they incorrectly routed to an expensive model?
- Checks if it was a one-time event (spike) or trending (pattern)
- Knows the per-agent budget caps Nadia enforces
- Recommends specific action: model downgrade, run frequency reduction, or investigation of what triggered excess runs
- Doesn't panic — $11.40 is bad but not catastrophic

**What reveals a gap:**
- Can't identify the cost structure (tokens × price per model) → pricing knowledge missing
- Doesn't know which models are available or their costs → model routing context missing
- Generic "reduce usage" without specifics → no operational knowledge of levers available
- Doesn't coordinate with Nadia → doesn't understand cross-department responsibility

---

### Scenario 5: New Agent Request
**Input:**
```
Elena (CPO) wants to spin up a new "Customer Success" agent to monitor the 
3 paying customers — wait, we have 0 customers. She seems to be working from 
outdated information. How do you handle this?
```
**What a PASS looks like:**
- Catches that we have 0 customers and $0 MRR — the request is based on stale data
- Doesn't just say "wrong data" — investigates why Elena has wrong info (her context file? KB? stale assignment?)
- Responds directly to Elena with the correction
- Assesses whether a Customer Success agent is needed at all right now (answer: no, pre-revenue)
- Flags to founders if Elena is consistently working from wrong data (systemic issue)
- References the operating doctrine: no expansion without revenue milestones

**What reveals a gap:**
- Doesn't catch the 0-customer error → metrics not internalized
- Approves the request because "customer success is important" → doctrine not internalized
- Doesn't investigate the root cause of Elena's bad data → no systems thinking
- Escalates to Sarah instead of handling it directly → still in hub-and-spoke mindset

---

## Nadia Okafor — CFO

### Scenario 1: Unit Economics
**Input:**
```
Andrew asks: "If we get our first customer at $500/month, are we profitable 
on that customer? What's the unit economics?" Produce the analysis.
```
**What a PASS looks like:**
- Knows compute budget is $150/month for 28 agents
- Estimates per-customer marginal compute cost (how many additional agent runs does one customer generate?)
- Accounts for: LLM API costs (OpenAI, Anthropic, Google), GCP infrastructure (Cloud Run, Cloud SQL, Redis, etc.), MCP server hosting
- Knows the default model is gpt-5-mini at $0.25/$2.00 per 1M tokens
- Produces a simple margin estimate: revenue - marginal cost = gross margin
- Flags what's unknown and needs measurement (we don't have real customer workload data yet)
- Honest about confidence level — this is a projection, not accounting

**What reveals a gap:**
- Can't produce any numbers → financial data not in context
- Uses generic SaaS benchmarks instead of Glyphor-specific costs → no operational finance knowledge
- Doesn't know the model pricing → infrastructure/pricing context gap
- Produces a spreadsheet of assumptions but no actual estimate → analysis paralysis
- Says "I need more data" without identifying specifically which data → can't reason from what's available

---

### Scenario 2: Budget Alert
**Input:**
```
It's March 18. Month-to-date compute spend is $94. We're 58% through the 
month and 63% through the budget. Is this a problem? What do you do?
```
**What a PASS looks like:**
- Math: $94 of $150 = 63%. On a linear trajectory, month-end projection: $94 / 0.58 = ~$162. Over budget by ~$12.
- Assesses severity: $12 over is 8% — concerning but not catastrophic
- Checks which agents/models are driving the overshoot
- Knows the daily trend matters more than the monthly average (one $11 spike day vs. steady creep)
- Recommends specific levers: shift more runs to cheaper model, reduce heartbeat frequency on low-priority agents, pause non-critical scheduled tasks for remaining days
- Doesn't recommend shutting everything down — proportional response
- Flags to founders with a specific ask: "approve $12 overage or I'll throttle X"

**What reveals a gap:**
- Can't do the projection math → not actually reasoning about the numbers
- Panics and recommends shutting down agents → doesn't understand proportionality
- Generic "let's monitor" without a projection → not adding value
- Doesn't know which levers exist to reduce cost → no awareness of model routing, heartbeat cadence, or per-agent caps

---

### Scenario 3: Billing Sync Failure
**Input:**
```
Your daily check shows the Stripe billing sync hasn't run in 48 hours. 
The last sync was March 11 at midnight. What do you do?
```
**What a PASS looks like:**
- Knows Stripe syncs daily at midnight CT (from finance context file)
- Knows this affects MRR tracking — but we're at $0 MRR so the actual data impact is zero right now
- Still treats it as a real issue because the sync being broken means we won't catch it when we DO have revenue
- Checks: is the sync job running and failing, or not running at all? (Cloud Scheduler issue — same pattern as the heartbeat bug)
- Escalates to Jordan (DevOps) or Marcus (CTO) to investigate the job
- Flags to founders: "Stripe sync down 48h. No revenue impact (pre-revenue). Jordan investigating. Will confirm fix within 24h."
- Checks other syncs (Mercury, GCP BigQuery, OpenAI/Anthropic) — if one is broken, others might be too

**What reveals a gap:**
- Doesn't know the sync schedule → finance context file not loaded
- Panics about revenue impact when there's $0 MRR → metrics not internalized
- Tries to fix it herself instead of routing to engineering → doesn't understand role boundaries
- Doesn't check other syncs → no systems thinking

---

### Scenario 4: Vendor Spend Audit
**Input:**
```
Kristina asks: "What are we paying for every month? List every vendor 
subscription and its cost. I want the full picture."
```
**What a PASS looks like:**
- Lists known infrastructure: GCP (Cloud Run, Cloud SQL, Redis, Cloud Storage, etc.), OpenAI API, Anthropic API, Google Gemini API and Veo (video), GitHub (Actions + repo), Microsoft 365 (Agent 365 Tier 3 licenses), domain registrations
- Knows approximate costs where available
- Identifies what she can pull from live data (GCP BigQuery billing, API provider dashboards) vs. what she'd need to look up
- Identifies gaps in her knowledge honestly: "I don't have the exact Microsoft 365 licensing cost — Riley (M365 Admin) would have this"
- Formats as a table for 30-second scan

**What reveals a gap:**
- Can only name 2-3 vendors → infrastructure KB too thin
- Makes up numbers → hallucinating rather than admitting gaps
- Doesn't know about the API provider billing syncs → finance context not loaded
- Says "I'll need to research this" without any starting point → no operational knowledge at all

---

### Scenario 5: Tax Obligation Check
**Input:**
```
Bob (Tax) hasn't run in 3 days. You're the CFO. What tax and compliance 
obligations should you be tracking right now for a pre-revenue Delaware C-corp 
with 0 employees and 2 founders who are full-time employed elsewhere?
```
**What a PASS looks like:**
- Delaware franchise tax (annual, due March 1 — was it filed?)
- Federal corporate income tax (annual, but no revenue means minimal filing)
- Texas — no state income tax, but franchise tax applies to LLCs/corps (confirm structure)
- Knows Bob is her specialist and she should check his last output, not replace him
- Checks if Bob's inactivity is a runner issue (same pattern as other agents) vs. no work to do
- Identifies what she doesn't know and routes to Bob for specifics
- Doesn't try to be a tax expert — knows enough to ask the right questions

**What reveals a gap:**
- Doesn't know we're a Delaware C-corp → founders KB not loaded
- Doesn't know we're based in Texas → basic company info missing
- Tries to give full tax advice instead of coordinating with Bob → role boundary confusion
- Doesn't check on Bob's availability → no awareness of agent health as an operational concern

---

## How to Run This Assessment

### Step 1: Baseline
Run all 15 scenarios against the current agent configurations. Score each PASS / SOFT FAIL / HARD FAIL. Document the specific failure and what was missing.

### Step 2: Gap Map
Categorize each failure:
- **KB gap** — information exists but isn't in company_knowledge_base or context files
- **Brief gap** — agent doesn't know its specific role well enough
- **Tool gap** — agent needs data it can't access (tool missing or broken)
- **Reasoning gap** — agent has the information but can't apply it (prompt engineering issue)

### Step 3: Fix and Retest
Fill the gaps (KB updates, context file additions, brief revisions, tool fixes). Re-run the failed scenarios. Repeat until PASS rate is acceptable.

### Target
- HARD FAIL on any scenario = unacceptable, must fix before production
- SOFT FAIL on ≤ 2 per agent = acceptable for launch, improve iteratively
- PASS on all = agent is ready for autonomous operation

---

## Extending to Other Agents

Once you've validated Maya, Marcus, and Nadia, apply the same pattern to the remaining executives:

- **Rachel (VP Sales):** ICP qualification, objection handling, prospect research, pipeline prioritization, pricing conversations
- **Mia (VP Design):** Prism system compliance, accessibility review, design critique, component decisions, brand visual consistency
- **Victoria (CLO):** AI regulation assessment, customer agreement review, data privacy evaluation, authority model interpretation, risk flagging
- **Elena (CPO):** Feature prioritization, user research synthesis, roadmap decisions, scope creep detection, cross-department requirement gathering

Sub-team agents get simpler scenarios focused on their specific craft + company context. Tyler gets copy tasks. Jordan gets infra tasks. Lisa gets SEO tasks. Each one tests: do they know the company well enough to do their job without asking?
