# Glyphor Knowledge System — Complete Update Checklist

> **Issued by:** Kristina Denney (CEO)
> **Date:** March 13, 2026
> **Purpose:** Single reference for every update needed across the knowledge system
> **Authority:** Operating Doctrine is the canonical source. Everything derives from it.

---

## Status Key

- 🔴 **BLOCKING** — other work is stuck waiting on this
- 🟡 **HIGH** — agents are producing wrong output without this
- 🟢 **MEDIUM** — improves quality but not blocking
- ⚪ **CHECK** — verify whether it exists in live DB before acting

---

## SECTION 1: Kill Conflicting Sources

### 1.1 Deprecate KNOWLEDGE.md 🔴

KNOWLEDGE.md contains the old strategy (Pulse as product, B2C creator target, $15-50/month, Product Hunt launch). The SQL DB now has the correct Doctrine-aligned content. KNOWLEDGE.md is a fallback that feeds agents the wrong plan whenever the primary lookup misses.

**Action:** Replace the entire file contents with:

```markdown
# DEPRECATED — Do not use

All company knowledge is in the company_knowledge_base table.
This file is no longer maintained and contains outdated strategy.

If you are reading this as an agent, use read_company_doctrine
or query the company_knowledge_base table directly.

Deprecated: March 13, 2026 by Kristina Denney (CEO)
```

**Why this blocks:** As long as this file exists with old content, any agent that falls through to it gets told to prepare for a Product Hunt launch of a $15-50/month B2C product. That directly contradicts the 5 active directives you just inserted.

---

### 1.2 Verify What Else Lives Only in KNOWLEDGE.md ⚪

KNOWLEDGE.md defined several tables and data that may or may not be in your live DB. Before deprecating, confirm these exist in the live Supabase instance:

| Table / Data | In KNOWLEDGE.md | In Live DB? | Action if Missing |
|---|---|---|---|
| `founder_bulletins` table + 6 bulletins | Yes | **CHECK** | Create table + insert updated bulletins |
| `company_pulse` table + heartbeat row | Yes | **CHECK** | Create table + insert current snapshot |
| `kg_nodes` (knowledge graph nodes) | Yes (12 nodes) | **CHECK** | Insert if missing — competitive intel depends on these |
| `kg_edges` (knowledge graph edges) | Yes (3 edges) | **CHECK** | Insert if missing |

**Run these checks:**

```sql
-- Do these tables exist?
SELECT table_name FROM information_schema.tables 
WHERE table_name IN ('founder_bulletins', 'company_pulse', 'kg_nodes', 'kg_edges');

-- If they exist, what's in them?
SELECT COUNT(*) FROM founder_bulletins WHERE is_active = true;
SELECT * FROM company_pulse ORDER BY updated_at DESC LIMIT 1;
SELECT COUNT(*) FROM kg_nodes WHERE status = 'active';
```

**If founder_bulletins exist but contain old content**, update them:

- The "Pulse launches first" bulletin must be replaced or deactivated
- The "B2C/prosumer, not enterprise" bulletin must be replaced with SMB focus
- The "Pricing is open at $15-50" bulletin must be replaced with $500-750 range
- The "Product Hunt" references must be removed

**If company_pulse exists**, update the highlights array to reflect current reality:

```sql
UPDATE company_pulse SET
  mrr = 0,
  active_users = 2,
  platform_status = 'degraded',
  company_mood = 'building',
  highlights = ARRAY[
    'AI Marketing Department is the only external product',
    'Pre-revenue: $0 MRR, 0 customers',
    '28 AI agents active, platform health stabilization in progress',
    'Slack-first GTM, $500-750/month target pricing',
    'Brand Guide established, Still You campaign in prep',
    'Competitive landscape research in progress',
    'Bootstrapped: founder-funded, no external investors'
  ],
  updated_at = NOW()
WHERE id = 1;
```

---

### 1.3 Update Brand Guide 🟡

The Brand Guide (GLYPHOR_BRAND_GUIDE.md) is 90% correct on voice, tone, and visual identity. But it has stale data that contradicts the Doctrine:

| What | Currently Says | Should Say |
|---|---|---|
| Agent count (Section 02, Autonomous) | "44 agents operating autonomously across 9 departments" | "28 agents operating autonomously" |
| Agent count (Section 03, Voice) | "44 agents, 24/7, $0 payroll" | "28 agents, 24/7, $0 payroll" |
| Agent count (Section 04, Landing pages) | "44 AI agents. 9 departments. 1 heartbeat." | "28 AI agents. 9 departments. 1 heartbeat." |
| Messaging framework (Section 04) | References enterprise IT, engineering leaders, CFOs as audiences | Add SMB founder-led audience as primary |
| Channel guidelines (Section 09) | No mention of Slack as product surface | Add Slack as primary product channel |
| Channel guidelines (Section 09) | No Instagram or Facebook guidelines | Add IG + FB per the social media standing orders |
| Product references | Doesn't mention AI Marketing Department by name | Add as the product being sold |

**Action:** Find-and-replace "44" with "28" globally. Then update messaging framework to lead with SMB audience. Add Instagram/Facebook to channel guidelines table.

---

## SECTION 2: Load Missing KB Content Into SQL DB

### 2.1 Load Brand Guide Into Agent-Accessible Store 🔴

Maya tried to call `read_company_doctrine` for `GLYPHOR_BRAND_GUIDE.md` and got nothing back. This blocks:
- Directive 1 (Brand Voice & Identity System)
- Directive 3 (Landing Page — depends on Directive 1)
- Directive 5 (Still You Campaign — depends on Directives 1 + 3)

**Action:** Determine where `read_company_doctrine` reads from:

```
Option A: It reads from a file path → place the Brand Guide file in the correct directory
Option B: It reads from a DB table → insert the Brand Guide as a KB row or separate doc table
Option C: It reads from SharePoint → upload the Brand Guide to the correct SharePoint location
```

**Find out which by checking the tool definition:**

```sql
-- Check tool registry for read_company_doctrine
SELECT tool_name, tool_config, description 
FROM tool_registry 
WHERE tool_name = 'read_company_doctrine';
```

Or check the MCP server source code that implements this tool.

Whatever the answer, the Brand Guide must be accessible when an agent calls `read_company_doctrine('GLYPHOR_BRAND_GUIDE.md')`.

---

### 2.2 Add Glossary Section 🟡

Agents leak internal terminology externally. Tyler might mention "Pulse" in a blog post. Rachel might say "Cockpit" in a sales conversation. No agent currently knows which terms are internal-only.

**Action:** Insert into `company_knowledge_base`:

```sql
INSERT INTO company_knowledge_base (section, audience, content) VALUES
('glossary', 'all', E'# Internal Terminology — Never Reference Externally

- **Pulse**: Internal AI video/creative production engine. Powers the AI Marketing Department''s video and image output. NOT a product name customers see. Externally: "your AI marketing department creates videos."
- **Web build engine**: Internal development acceleration engine. Powers internal platform builds. Not sold. Never mentioned externally.
- **Revy / Rêve**: Future roadmap initiative. Not active. Never mentioned externally or in planning.
- **Cockpit**: Internal dashboard at app.glyphor.ai. Agent management, orchestration, governance, cost tracking. Not customer-facing.
- **Ora**: Internal multi-model triangulated chat feature. Fans queries to Claude, Gemini, GPT with a judge model. Internal tool only.
- **Prism**: Brand design system. Prism Midnight (dark) for investor/enterprise. Prism Solar (light) for marketing/web. Internal name — externally just "our design system."
- **Sarah / Marcus / Maya etc.**: AI agent names. These ARE used externally — agents have public identities. "Meet the team" is part of the product experience.
- **AI Marketing Department**: THE product. This IS the external name. Always use this, never "our agent platform" or "our multi-agent system."
- **MCP**: Model Context Protocol. Internal infrastructure term. Never used in customer-facing content.
- **Heartbeat**: The scheduling cycle that triggers agent runs. Internal only.
- **Knowledge Graph / GraphRAG**: Internal intelligence infrastructure. Never referenced externally.
- **Dark Glass**: Internal name for the Cockpit dashboard UI aesthetic. Never referenced externally.
- **Hyper Cyan**: Internal color name (#00E0FF). Never referenced in customer-facing copy.

Rule: If a customer wouldn''t understand the term, don''t use it externally. The customer sees "your AI marketing team" — not orchestration, not multi-agent, not MCP servers.');
```

---

### 2.3 Add Customer Experience Section 🟡

No document anywhere describes what a customer actually experiences. Rachel can't sell it. Maya can't write landing page copy. Ava can't build the onboarding flow. Tyler can't write the FAQ.

**Action:** Insert into `company_knowledge_base`:

```sql
INSERT INTO company_knowledge_base (section, audience, content) VALUES
('customer_experience', 'all', E'# How the AI Marketing Department Works for Customers

## Onboarding (Day 1)
1. Customer adds the Glyphor app to their Slack workspace
2. Onboarding bot asks: company name, website, industry, target audience, brand guidelines (upload), current marketing pain points
3. AI team ingests brand assets and builds initial brand profile
4. Customer receives first content recommendations within hours

## Daily Operation
- AI marketing agents are present in a dedicated Slack channel
- Customer posts requests, approves drafts, gives feedback — all in Slack
- Agents deliver: social posts, blog drafts, email campaigns, video content, SEO reports
- Approvals happen via emoji reactions or threaded replies — no external tools needed

## What the Customer Sees
- Named AI team members with clear roles
- Deliverables posted directly in Slack with preview
- Weekly performance summary
- Monthly content calendar

## What the Customer Does NOT See
- Internal orchestration, agent runner, MCP servers, Cockpit dashboard
- Pulse/internal engine names/internal tool names
- Multi-model routing, cost tracking, authority tiers
- The agent platform architecture

## Objections and Answers
- "Is this just ChatGPT in Slack?" → No. This is a team of specialized agents that coordinate, review each other''s work, and operate continuously. ChatGPT is a single model responding to prompts.
- "Can I just hire a freelancer for less?" → A freelancer costs $2-5K/month for partial coverage. This is a full department at $500-750/month running 24/7.
- "What if I don''t like the output?" → You give feedback in Slack like you would to any team member. The AI team learns your brand voice and improves over time.
- "What happens to my data?" → Your brand assets and content stay in your secure workspace. If you leave, your data goes with you.
- "How is this different from [competitor]?" → See competitive landscape section. Short version: single agents vs. a department.

NOTE: This customer experience is the target. Not all of it is built yet. All product, engineering, and design work should aim toward this experience.');
```

---

### 2.4 Add Tool Inventory Section 🟡

Agents keep saying "tool is down" or "I can't access this" because they don't know what tools are available. Elena's inbox tool was genuinely broken, but Maya's brand guide failure was a content gap, not a tool gap. Agents can't tell the difference without knowing what they have.

**Action:** Insert into `company_knowledge_base`:

```sql
INSERT INTO company_knowledge_base (section, audience, content) VALUES
('tool_inventory', 'all', E'# Tool Inventory — What Agents Can Access

## Internal MCP Servers (10 servers, ~87 tools)
1. **mcp-email-server** — Send/receive email via M365 shared mailboxes. Agents: all executives.
2. **mcp-teams-server** — Read/send Teams messages, channel management. Agents: all.
3. **mcp-engineering-server** — GitHub, CI/CD, deployment tools. Agents: Marcus, Alex, Jordan, Sam.
4. **mcp-legal-server** — Compliance, contracts, IP, tax tools (12 reads + 7 writes). Agents: Victoria, Bob.
5. **mcp-research-server** — Web search, research repository, monitoring tools. Agents: Sophia, Lena, Daniel Okafor.
6. **mcp-finance-server** — Stripe, Mercury, billing APIs. Agents: Nadia.
7. **mcp-marketing-server** — Content management, analytics. Agents: Maya, Tyler, Lisa, Kai, Zara.
8. **mcp-design-server** — Design assets, component library. Agents: Mia, Leo, Ava, Sofia, Ryan.
9. **mcp-hr-server** — Agent management, onboarding. Agents: Jasmine.
10. **mcp-ops-server** — Health monitoring, system diagnostics. Agents: Atlas, Morgan.

## Microsoft Agent 365 MCP Servers (9 servers)
M365 integration tools for Teams, SharePoint, OneDrive, Calendar, etc.
Access varies by agent — check individual agent tool access in the tool registry.

## Standalone Tools
- **read_company_doctrine** — Reads company docs (KB, brand guide, operating doctrine)
- **web_search** — OpenAI Responses API web_search_preview
- **flag_assignment_blocker** — Report blockers on assignments
- **create_sub_team_assignment** — Executives only: assign work to sub-team

## Common Tool Failures and What They Mean
- "Tool returned no content" → The tool worked but the data doesn''t exist. Content gap, not tool gap.
- "Tool is down" / "cannot connect" → MCP server is unreachable. Likely auth token expired or server not running. Escalate to Marcus/Jordan.
- "Permission denied" → You don''t have access to this tool. Check if it''s in your tool registry. If it should be, escalate to Morgan (Global Admin).

## When a Tool Fails
1. Try once more
2. If still failing, check if it''s a content gap (data doesn''t exist) vs infrastructure failure (server down)
3. If infrastructure: flag to Marcus or Jordan via flag_assignment_blocker
4. Do NOT stop all work because one tool failed. Pivot to other available work.');
```

**NOTE:** The server names and agent access lists above are approximate. Verify against your actual MCP server registry and update before inserting. Run:

```sql
SELECT DISTINCT server_name FROM tool_registry ORDER BY server_name;
```

---

### 2.5 Add ICP Deep Profile 🟡

The products section has a one-liner about the ICP. Rachel and Maya need much more to sell and market effectively.

**Action:** Insert into `company_knowledge_base`:

```sql
INSERT INTO company_knowledge_base (section, audience, content) VALUES
('icp_profile', 'all', E'# Ideal Customer Profile — AI Marketing Department

## Demographics
- Company size: 5-50 employees
- Revenue: $500K - $10M/year
- Structure: Founder-led or small leadership team
- Industry: SaaS, e-commerce, professional services, creator economy, local services
- NOT: Enterprise (500+ employees), regulated industries (healthcare, finance, government), complex procurement

## Their Marketing Situation
- No full-time marketing hire, or one overworked generalist
- Founder is doing marketing themselves (poorly, inconsistently)
- Tried freelancers (expensive, unreliable, slow)
- Tried agencies (too expensive, too slow, misaligned incentives)
- May be using Canva/ChatGPT/social scheduling tools as band-aids
- Inconsistent posting cadence — goes weeks without content
- Knows they need marketing but can''t justify $5K+/month for an agency

## Their Tech Stack
- Uses Slack (required for our product)
- Likely also uses: Google Workspace, Notion, HubSpot or similar CRM, Stripe
- Comfortable with SaaS tools, not deeply technical
- Values simplicity — will not adopt something that requires training

## Buying Behavior
- Short decision cycle (days to weeks, not months)
- Founder or marketing lead makes the call, no procurement committee
- Price-sensitive but values output over cost — willing to pay for results
- Will try before committing — needs to see value in first week
- Word-of-mouth driven — if it works, they tell other founders

## What They Care About
- Consistent output they don''t have to manage
- Quality they''re not embarrassed by
- Speed — want results this week, not next quarter
- Simplicity — don''t want to learn another tool or dashboard
- Cost predictability — flat rate, no surprises

## What They Do NOT Care About
- AI architecture, multi-agent systems, orchestration
- How many models we use or which providers
- Our internal tooling or infrastructure
- Technical documentation or API access

## How to Talk to Them
- Lead with the pain: "You know you need marketing but you don''t have time/budget for it"
- Show the solution: "Add your AI marketing team to Slack. Get content today."
- Prove it: specific output examples, not architecture diagrams
- Keep it simple: they want a team, not a tool');
```

---

### 2.6 Add Decision Log 🟢

Prevents agents from re-proposing rejected ideas. Every time you say "no" to something, it should be recorded here so no agent brings it back.

**Action:** Insert into `company_knowledge_base`:

```sql
INSERT INTO company_knowledge_base (section, audience, content) VALUES
('decision_log', 'all', E'# Founder Decision Log — Settled Decisions

These decisions have been made. Do not re-propose, re-open, or work around them.

## Strategy
- Pulse is NOT a standalone product. It is an internal engine. (March 2026)
- The web build engine is NOT a standalone product. It is an internal engine. (March 2026)
- The only external product is the AI Marketing Department. (March 2026)
- Slack is the go-to-market wedge. Teams comes after Slack validation. (March 2026)
- No dashboard as primary product experience. (March 2026, per Operating Doctrine)
- No enterprise sales. SMB only in current phase. (March 2026)
- No paid acquisition. Organic growth only. (March 2026)
- Product Hunt launch was the OLD strategy for Pulse-as-product. That plan is dead. (March 2026)

## Pricing
- Target: $500-750/month flat rate. (March 2026)
- No usage-based pricing. (March 2026, per Operating Doctrine)
- No credit systems. (March 2026, per Operating Doctrine)
- No freemium tier at $15-50/month. That was the old Pulse pricing model, now dead. (March 2026)

## Architecture
- Agent count is 28 active, not 44 or 30. 14 were deleted. (March 2026)
- Agent count in Brand Guide and all materials must say 28. (March 2026)
- KNOWLEDGE.md is deprecated. SQL DB is source of truth. (March 2026)

## Brand
- Never call the internal web build engine "vibe coding." (Standing rule)
- Never use "AI-powered" in external copy. (Per Brand Guide)
- Never call Glyphor a copilot, assistant, or tool. (Per Brand Guide)
- Agent names ARE used externally. They have public identities. (Per Brand Guide)

## What Was Rejected
- TikTok as a launch channel — not where our ICP lives (if decided)
- Customer-facing Cockpit dashboard — internal only (March 2026)
- Multi-department scaling before revenue validation (March 2026, per Operating Doctrine)

Update this log whenever a founder makes a definitive strategic decision.');
```

---

## SECTION 3: Fix Department Context Files

These are already deployed in the repo. Fix the following:

### 3.1 context/finance.md — Already Fixed ✅
- Removed "$1,240 MRR" and "3 customers"
- Now says $0 MRR, pre-revenue

### 3.2 context/sales-cs.md — Already Fixed ✅
- Removed "3 active. ~$1,240 MRR"
- Now says 0 customers, $0 MRR

### 3.3 context/engineering.md 🟡

**Verify and update:**
- Team list matches the 4 surviving engineering agents (Alex, Sam, Jordan, Riley)
- Current priorities reference Platform Health directive
- Tools section lists the actual MCP servers engineering agents have access to
- "When you have no assigned work" section has specific activities
- No references to old product strategy

### 3.4 context/product.md 🟡

**Verify and update:**
- Team: Elena (CPO), Priya (User Research), Daniel Ortiz (Competitive Intel)
- Product being built: AI Marketing Department via Slack (NOT Pulse as standalone product)
- Current priorities: support the 5 active directives
- No references to Product Hunt launch, B2C creator target, or Pulse-as-product

### 3.5 context/design.md 🟡

**Verify and update:**
- Team: Mia (VP Design), Leo (UI/UX), Ava (Frontend), Sofia (Design Critic), Ryan (Template Architect)
- Design system: Prism Midnight + Prism Solar, per Brand Guide
- Current priorities: Landing page design (Directive 3), Still You campaign assets (Directive 5)
- Note that Mia is currently **paused** — verify if intentional

### 3.6 context/operations.md 🟡

**Verify and update:**
- Team: Atlas (Ops), Morgan (Global Admin)
- Current priorities: platform health monitoring, agent health tracking
- Tools: health check cron, system diagnostics
- "When you have no assigned work" section has specific monitoring activities

### 3.7 context/research.md — Already Created ✅
### 3.8 context/legal.md — Already Created ✅

---

## SECTION 4: Fix Agent Briefs

Agent briefs need to be consistent with the Doctrine. The biggest issues:

### 4.1 Audit All 28 Briefs for Stale Strategy References 🟡

**Search every brief file for:**
```bash
cd packages/company-knowledge/briefs/
grep -l "Product Hunt\|B2C\|prosumer\|content creator\|influencer\|\$15\|\$19\|\$29\|\$39\|\$50\|Pulse launch\|pulse.glyphor.ai\|44 agent\|30 agent\|27 agent" *.md
```

Every hit is a brief telling an agent the wrong strategy. Fix each one to reference:
- AI Marketing Department (not Pulse)
- SMB 5-50 employees (not B2C creators)
- $500-750/month (not $15-50/month)
- Slack delivery (not Product Hunt launch)
- 28 agents (not 44/30/27)

### 4.2 Add Output Examples to Critical Briefs 🟡

The single highest-leverage improvement for agent output quality. Add 1-2 concrete examples of good work to each executive brief:

| Agent | Example to Add |
|---|---|
| **Maya (CMO)** | One well-written LinkedIn post in Glyphor brand voice |
| **Marcus (CTO)** | One well-structured platform health report |
| **Nadia (CFO)** | One well-structured cost analysis with specific numbers |
| **Rachel (VP Sales)** | One good prospect outreach message for an SMB |
| **Tyler (Content)** | One blog post opening paragraph in brand voice |
| **Kai (Social Media)** | One social engagement response that's on-brand |

### 4.3 Add Failure Modes to Executive Briefs 🟢

Tell each agent what mistakes they're most likely to make:

| Agent | Failure Modes to Document |
|---|---|
| **Maya** | Using banned words, exclamation marks, leaking internal terms, writing hype copy instead of dry/specific |
| **Marcus** | Over-engineering solutions, proposing infra work that doesn't serve the AI Marketing Dept, not coordinating cost impact with Nadia |
| **Nadia** | Making up numbers instead of querying live data, panicking over small variances, not checking billing sync freshness |
| **Rachel** | Targeting enterprise instead of SMB, quoting final pricing, describing internal architecture to prospects |
| **Tyler** | Using banned words, writing generic AI content instead of Glyphor-specific, mentioning Pulse/internal engine names |
| **Kai** | Using emoji, exclamation marks, defensive tone when engaging with criticism, posting without Maya's review |

---

## SECTION 5: Fix Active Data

### 5.1 Agent Count Discrepancy 🟡

You said 28 agents. DB shows 25 active + 2 paused (cpo, vp-design) = 27 total.

**Action:**
```sql
-- Who's paused?
SELECT agent_role, status FROM company_agents WHERE status = 'paused';

-- Who's missing from the 28?
SELECT agent_role, status FROM company_agents ORDER BY agent_role;
```

Cross-reference against the roster. Either reactivate the paused agents if they should be active, or update all references from 28 to 25 (KB metrics, mission, team_structure).

### 5.2 Products Section Still Says 30 🟡

The `products` KB section still references "30 agents" in the Cockpit description:

```sql
-- Check
SELECT content FROM company_knowledge_base WHERE section = 'products';
-- Fix if it says 30
UPDATE company_knowledge_base 
SET content = REPLACE(content, '30 agents', '28 agents')
WHERE section = 'products';
```

### 5.3 Stale Directives Cleaned ✅
- 12 old directives deactivated
- 5 new directives active
- Platform Health directive inserted

### 5.4 Orphaned ai-impact-analyst Cleaned ✅

---

## SECTION 6: Operational Fixes (From This Session)

### 6.1 Sarah Not Running 🔴

Sarah's heartbeat advances but produces 0 agent_runs rows and 0 assignments. The entire orchestration system is non-functional.

**Diagnosis needed:**
```sql
-- Did Sarah run at all under any status?
SELECT id, status, error, LEFT(result_summary, 300), started_at
FROM agent_runs
WHERE agent_role = 'chief-of-staff'
ORDER BY started_at DESC
LIMIT 10;

-- Is she getting precheck-skipped?
SELECT status, COUNT(*)
FROM agent_runs
WHERE agent_role = 'chief-of-staff'
  AND started_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

If 0 rows: the heartbeat is updating `last_run_at` without invoking the agent runner. Same class of bug as the Cloud Scheduler issue — job exists but isn't wired to execution.

### 6.2 Skipped Precheck Rendering Fix 🟢

Deterministic precheck skips render as red errors in the Activity UI. Patch spec delivered separately (see `patch-skipped-precheck-rendering.md`).

**Files to change:**
- `companyAgentRunner.ts:2417` — stop writing skip reason into `run.error`, use `result_summary` instead
- `Activity.tsx:383` — render `skipped_precheck` as yellow badge, not red error block

### 6.3 Elena's Inbox Tool Down 🟡

Elena (CPO) tried to read her inbox and the tool failed. Either auth token expired or MCP email server is unreachable.

**Check:**
```sql
SELECT id, tool_calls, error 
FROM agent_runs 
WHERE agent_role = 'cpo' 
ORDER BY started_at DESC 
LIMIT 1;
```

### 6.4 Maya's Brand Guide Access 🔴

Maya called `read_company_doctrine('GLYPHOR_BRAND_GUIDE.md')` and got empty. This is Section 2.1 above — the Brand Guide isn't where the tool looks for it.

---

## SECTION 7: Future Architecture (Specs Delivered)

These are not immediate fixes but planned architectural changes. Specs delivered separately.

| Spec | File | Status |
|---|---|---|
| Autonomous Agent Work Loop | `autonomous-agent-work-loop-spec.md` | Ready for implementation |
| Agent Knowledge Gap Assessment | `agent-knowledge-gap-assessment.md` | 15 scenarios ready to run |
| MCP Social Server (FB + IG) | `mcp-social-server-spec.md` | Tokens obtained, ready for build |
| Skipped Precheck UI Fix | `patch-skipped-precheck-rendering.md` | Ready for implementation |

---

## Execution Priority

**Do today (blocks everything):**
1. Deprecate KNOWLEDGE.md (Section 1.1)
2. Load Brand Guide into agent-accessible store (Section 2.1)
3. Diagnose why Sarah isn't running (Section 6.1)

**Do this week:**
4. Insert glossary into KB (Section 2.2)
5. Insert customer experience into KB (Section 2.3)
6. Insert tool inventory into KB (Section 2.4)
7. Insert ICP profile into KB (Section 2.5)
8. Insert decision log into KB (Section 2.6)
9. Update Brand Guide agent count 44→28 (Section 1.3)
10. Verify founder_bulletins/company_pulse/kg_nodes in live DB (Section 1.2)
11. Fix agent count discrepancy — 25 vs 28 (Section 5.1)
12. Audit briefs for stale strategy references (Section 4.1)
13. Verify/update engineering, product, design, operations context files (Section 3.3-3.6)

**Do next week:**
14. Add output examples to executive briefs (Section 4.2)
15. Add failure modes to executive briefs (Section 4.3)
16. Run knowledge gap assessment scenarios (see separate spec)
17. Fix skipped precheck rendering (see separate spec)
18. Begin autonomous work loop implementation (see separate spec)
19. Build mcp-social-server (see separate spec)

---

## Verification Query (Run After All Updates)

```sql
-- Full KB health check
SELECT 
  section, 
  LENGTH(content) as chars,
  CASE 
    WHEN content ILIKE '%Product Hunt%' THEN '⚠️ STALE: Product Hunt ref'
    WHEN content ILIKE '%44 agent%' THEN '⚠️ STALE: 44 agents'
    WHEN content ILIKE '%30 agent%' THEN '⚠️ STALE: 30 agents'
    WHEN content ILIKE '%27 agent%' THEN '⚠️ STALE: 27 agents'
    WHEN content ILIKE '%$1,240%' THEN '⚠️ STALE: old MRR'
    WHEN content ILIKE '%3 customers%' THEN '⚠️ STALE: old customer count'
    WHEN content ILIKE '%prosumer%' THEN '⚠️ STALE: old target market'
    WHEN content ILIKE '%$15%' AND section NOT IN ('competitive_landscape') THEN '⚠️ STALE: old pricing'
    ELSE '✅ OK'
  END as health
FROM company_knowledge_base
WHERE is_active = true
ORDER BY section;

-- Expected: 19 sections (13 original + glossary + customer_experience + 
-- tool_inventory + icp_profile + decision_log + standing_orders), all ✅ OK
```
