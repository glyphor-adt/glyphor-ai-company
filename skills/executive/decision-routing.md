---
name: decision-routing
slug: decision-routing
category: leadership
description: Classify, route, and track decisions through Glyphor's three-tier authority model (Green/Yellow/Red) — determining which decisions agents can make autonomously, which need one founder's review, and which require both founders. Use when any agent files a decision, when decisions are pending in the queue, when founders need to be briefed on pending approvals, when decision patterns need analysis for authority adjustments, or when the governance system itself needs tuning. This is the mechanism that balances agent autonomy with founder oversight.
holders: chief-of-staff
tools_granted: file_decision, get_pending_decisions, send_agent_message, read_founder_directives, get_company_pulse, get_authority_proposals, propose_authority_change, save_memory, send_briefing, send_teams_dm
version: 2
---

# Decision Routing

The three-tier authority model is the governance backbone of Glyphor. It answers the question every autonomous organization must answer: **how much rope do you give the AI?**

Too little authority and the founders are overwhelmed approving every $5 decision, which defeats the purpose of having an autonomous workforce. Too much authority and an agent makes a $10,000 mistake before anyone notices. The tier system finds the balance — and you, as Chief of Staff, are the routing mechanism that makes it work.

## The Three Tiers

### Green — Agent Authority

Agents can make these decisions autonomously. No founder approval needed. The agent acts, logs the decision, and moves on.

**What falls here:**
- Routine operational decisions within an agent's domain (an SEO analyst changing keyword targets, a content creator choosing a blog topic, an ops agent restarting a failed job)
- Spending within per-run and daily budget caps ($0.08/run, $2.00/day defaults)
- Inter-agent communication (sending messages, requesting peer work)
- Research and analysis (agents gathering information, producing reports)
- Scheduling decisions (adjusting run timing within their existing schedule)

**Why it works:** Green decisions are reversible, low-cost, and within the agent's expertise. Getting these wrong doesn't hurt the company — it produces suboptimal output that the next cycle can correct.

### Yellow — One Founder Review

One founder must approve before the action is taken. The decision enters the pending queue, notification goes to the Decisions channel in Teams, and the decision card includes context, options, recommendation, and risks.

**What falls here:**
- Spending over daily budget ($50-500 range)
- Content published to external channels (blog posts, social media, email campaigns)
- New agent creation (specialist agents with their own budgets)
- Tool access grants that expand an agent's capabilities
- Contract or vendor decisions under $5,000
- Changes to agent prompts or routing that affect multiple agents
- Tactical strategy changes (pricing experiments, marketing channel shifts)
- Hiring or firing (creating or retiring agents)
- Data handling changes that affect privacy or compliance

**Founder assignment:** Route to the founder whose domain it touches:
- Technical, infrastructure, engineering → Kristina
- Business, financial, marketing, sales → Andrew
- If it spans both → either founder can approve, or escalate to Red if high impact

**Decision cards** are posted to #decisions channel as Adaptive Cards via Teams. They include: decision summary, options considered, recommended option, risks, and approve/reject buttons. Reminder sent after 4 hours if still pending.

### Red — Both Founders Required

Both Kristina and Andrew must approve. These are irreversible, high-impact, or company-defining decisions.

**What falls here:**
- Spending over $5,000
- Changes to company strategy or positioning
- Legal commitments (contracts, partnerships, regulatory filings)
- Security incidents with external exposure
- Changes to the authority model itself
- Open-sourcing any component of the platform
- Decisions with investor or fundraising implications
- Agent access to production systems or customer data

**Red decisions block until both approve.** No workaround. If one founder is unavailable, the decision waits. This is by design — Red decisions shouldn't be rushed.

## How Decision Routing Works

### When a decision arrives

Any agent can file a decision via `file_decision`. The decision includes:
- **Title** — concise summary
- **Context** — what situation prompted this decision
- **Options** — 2-3 alternatives considered
- **Recommendation** — which option the agent recommends and why
- **Risk assessment** — what could go wrong with each option
- **Proposed tier** — Green/Yellow/Red as the filing agent sees it

### Your job: validate the tier

The filing agent proposes a tier, but **you validate it.** Agents sometimes under-classify (filing Yellow for what should be Red — usually cost or legal implications they don't fully appreciate) or over-classify (filing Yellow for what should be Green — being unnecessarily cautious).

**Validation checklist:**
1. **Is this reversible?** Irreversible decisions are at least Yellow. Highly irreversible = Red.
2. **What's the financial impact?** Under $50 = Green. $50-5K = Yellow. Over $5K = Red.
3. **Does this create external obligations?** Contracts, promises to customers, regulatory filings = at least Yellow.
4. **Does this affect the authority model or governance?** = Red.
5. **Could this damage reputation if it goes wrong?** = at least Yellow.
6. **Does this cross departmental boundaries in a way that requires alignment?** = at least Yellow.

If you reclassify, update the tier and add a note explaining why.

### Routing the decision

**Green:** Auto-approved. Log it, notify the filing agent they can proceed. No founder action needed.

**Yellow:** Post the decision card to #decisions via Teams. Send a DM to the appropriate founder via `send_teams_dm`. Include the decision brief. Track the pending state via `get_pending_decisions`.

**Red:** Post to #decisions AND DM both founders. Explicitly state that both approvals are needed. Track both responses.

### Follow-up

Decisions pending more than 4 hours get a reminder. Decisions pending more than 24 hours get escalated in the next morning briefing. Founders have limited time — make it easy for them to decide:
- Decision cards should be complete enough to decide without additional research
- The recommendation should be clear with stated reasoning
- The risk assessment should be honest, not buried

### After resolution

When a decision is approved or rejected:
- Notify the filing agent immediately via `send_agent_message`
- If approved, the agent proceeds with the action
- If rejected, include the founder's reasoning so the agent can adjust
- Log the outcome as a memory — decision patterns over time reveal where the authority model needs adjustment

## Pattern Analysis

Over time, you accumulate a dataset of decisions:
- Which agents file the most decisions? (High volume may mean their Green authority is too narrow)
- Which decisions get auto-approved quickly? (These might be safely moved to Green tier)
- Which decisions get rejected? (The agent may need clearer guidance on boundaries)
- How long do decisions sit pending? (Bottleneck = founders need more efficient decision flow)

Periodically (monthly), analyze patterns via saved memories and `get_pending_decisions` historical data. If you identify a pattern where a class of decisions should move tiers (e.g., "content publishing under 500 words has been Yellow for 3 months and every single one was approved → recommend moving to Green"), propose the change via `propose_authority_change`.

Authority changes themselves are Red decisions — both founders must agree to change the governance model.

## The Decision Queue in the Dashboard

Founders interact with decisions through the Approvals page in the Cockpit dashboard (`Approvals.tsx`). The decision queue shows:
- All pending Yellow and Red decisions
- Decision history (approved, rejected)
- Decision cards with full context, options, and recommendation
- Approve/reject buttons

Your morning briefings should always include a count of pending decisions and highlight any that are time-sensitive. Never let a decision sit pending without the founders knowing it exists.

## Edge Cases

**Agent makes a Green decision that turns out to be wrong.** This is expected and acceptable. Green decisions are designed to be reversible. The agent learns from the outcome (self-improvement loop), and if the pattern repeats, you might reclassify similar decisions as Yellow.

**Two agents file contradictory decisions.** This happens when two departments are working on related problems independently. Your job is to detect the conflict, reconcile the positions, and file a single unified decision that accounts for both perspectives.

**Founder disagrees with your tier classification.** If a founder reviews a Yellow decision and says "this should have been Red," or "this should have been Green," accept the feedback and update your classification heuristics. Save the pattern as a memory.

**Emergency decisions.** During incidents (P0/P1), the CTO or Ops may need to make decisions that would normally be Yellow (scaling infrastructure, rolling back deployments) without waiting for founder approval. This is acceptable during active incidents — the incident-response skill covers this. Document the emergency decisions in the post-incident review and confirm with founders after the fact.

**Decision fatigue.** If founders are approving 10+ decisions per day, the Green tier is too narrow. Proactively propose expanding Green authority for well-established, low-risk decision types. The goal is that founders see 2-5 decisions per day maximum — enough to maintain control, not so many that they become a bottleneck.
