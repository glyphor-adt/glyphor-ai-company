# Founder Directives — March 2026

> **Issued by:** Kristina Denney (CEO)
> **Date:** March 10, 2026
> **Routing:** Sarah Chen (CoS) for decomposition and dispatch

---

## Directive 1: Establish Brand Voice & Identity System

**Priority:** CRITICAL
**Assigned to:** Maya Brooks (CMO) + Mia Tanaka (VP Design)
**Supporting:** Tyler Reed (Content), Sofia Marchetti (Design Critic), Leo Vargas (UI/UX)
**Deadline:** 7 days
**Reference document:** `GLYPHOR_BRAND_GUIDE.md`

### Objective

The Glyphor Brand Guide is now our source of truth for all branding, voice, tone, messaging, and visual identity. All agents producing external-facing content must conform to it immediately. This directive establishes the brand guide as an operational standard across the company.

### Assignments

1. **Maya (CMO):** Review the Brand Guide sections 01–04 (Brand Essence, Attributes, Voice & Tone, Messaging Framework) and internalize the voice principles, banned patterns, and tone matrix. Update your agent brief and all content team briefs to reference this document. Produce a 1-page "Brand Voice Quick Reference Card" that content-producing agents can use as a cheat sheet — include the banned words list, tone-by-context table, and 3 before/after copy examples showing bad patterns rewritten in brand voice.

2. **Mia (VP Design):** Review sections 05–07 and 09–12 (Visual Identity, Accessibility, Co-branding, Channel Guidelines, Motion, Agent Identity, Templates). Audit the current dashboard against the accessibility standards in section 06. Flag any Hyper Cyan text on dark backgrounds that falls below 4.5:1 contrast. Produce a "Brand Compliance Checklist" that design agents can run against any deliverable.

3. **Tyler (Content):** Take the "Still You" campaign copy from section 08 and produce platform-ready versions for LinkedIn (6 posts, one per ad), X/Twitter (6 tweets, one-liner format per ad), and one long-form blog post titled "Everyone else built a copilot. We built a company." The blog post should expand on the campaign's thesis — copilot fatigue is real, here's what autonomous operation actually looks like. Follow the voice principles exactly: present tense, active voice, no banned words, no exclamation marks.

4. **Sofia (Design Critic):** Once Mia's compliance checklist is complete, run it against the current glyphor.ai landing page, dashboard, and the Prism v5.6 component set. Report any drift or violations.

5. **Leo (UI/UX):** Design 6 social media cards for the "Still You" campaign — one per ad. Prism Midnight background. Agency font for "STILL YOU." and the tagline. Hyper Cyan for the glyphor wordmark and tagline. Format: square (1080×1080) and landscape (1920×1080). Reference section 08 visual treatment spec.

### Success metric

Brand Guide is referenced in all content and design agent briefs. Brand Compliance Checklist exists and has been run against live assets. "Still You" campaign assets are ready for social deployment.

---

## Directive 2: "Still You" Marketing Campaign Launch

**Priority:** HIGH
**Assigned to:** Maya Brooks (CMO)
**Supporting:** Kai Johnson (Social Media), Lisa Chen (SEO), Tyler Reed (Content), Leo Vargas (UI/UX)
**Deadline:** 14 days
**Depends on:** Directive 1 (brand assets must be ready)

### Objective

Launch the "Still You" campaign across social channels with a coordinated content calendar, landing page, and engagement strategy. This is our first major brand campaign and it needs to land with the energy of the Anthropic Super Bowl ads — dry, sarcastic, instantly recognizable.

### Assignments

1. **Maya (CMO):** Own the campaign rollout plan. Determine the cadence — do we drop all 6 ads in one week or stagger over 2 weeks? Build the content calendar. The campaign should build to a crescendo: start with the most universally relatable ads (Ad 1: Marketing Plan, Ad 6: Monday Morning), save the sharpest ones for mid-campaign.

2. **Kai (Social Media):** Schedule and publish the campaign social cards and copy produced by Tyler and Leo. Monitor engagement, replies, and quote-tweets in real-time. Engage with copilot frustration stories that align with our #stillyou hashtag. Tone: dry, never defensive, never salesy. If someone shares their own "Still You" moment, respond with something like "sounds like you need a department, not a copilot."

3. **Lisa (SEO):** Research and recommend target keywords for the campaign blog post and landing page. Focus on terms people use when they're frustrated with copilots: "copilot limitations," "AI assistant not working," "copilot vs autonomous AI," "AI that does the work." Produce a keyword brief for Tyler's blog post.

4. **Tyler (Content):** Produce the blog post per Directive 1. Additionally, draft 3 follow-up content pieces for the 2 weeks post-launch: a "Copilot Fatigue" thought leadership piece, a "What autonomous AI actually means" explainer, and a "Behind the scenes: how 44 agents run a company" technical narrative.

5. **Leo (UI/UX):** Beyond the social cards from Directive 1, design a dedicated campaign mini-site or landing section at glyphor.ai/stillyou with the 6 ads displayed as a scrollable series. Prism Midnight. Minimal — let the copy breathe. End with a CTA to the main product page.

### Success metric

All 6 ads published to LinkedIn + X. Blog post live. Campaign landing page live. Engagement tracked and reported daily for first 2 weeks.

---

## Directive 3: Slack AI Marketing Department Landing Page

**Priority:** HIGH
**Assigned to:** Mia Tanaka (VP Design)
**Supporting:** Ava Chen (Frontend), Ryan Park (Template Architect), Maya Brooks (CMO), Tyler Reed (Content)
**Deadline:** 10 days

### Objective

Build a dedicated landing page for Glyphor's Slack-integrated AI Marketing Department offering. This is our first revenue-generating product — the entry wedge is Slack, with the dashboard at app.glyphor.ai as supporting infrastructure. The landing page needs to convert a marketing leader who is overwhelmed, understaffed, and skeptical of another AI tool.

### Assignments

1. **Mia (VP Design):** Own the page design. This is a Prism Midnight page with Prism Solar sections for contrast. Structure:
   - Hero: One headline, one subheadline, one CTA. "Your AI marketing department lives in Slack." Sub: "Content, SEO, social, analytics — running 24/7 without the headcount." CTA: "Get started."
   - How it works: 3-step visual. Step 1: Connect to Slack. Step 2: Set your strategy. Step 3: Your AI marketing team ships.
   - The team: Show the AI marketing agents (Maya, Tyler, Lisa, Kai) with names, titles, and avatars. "Meet your team."
   - What they do: Grid of capabilities — content creation, SEO analysis, social scheduling, competitive monitoring, campaign analytics. Each with a specific example of real output, not a vague description.
   - Pricing: Tiers as defined by current product pricing.
   - FAQ: Address the top 5 objections (is this another chatbot? what if it produces bad content? how do I maintain brand voice? does it integrate with our tools? what does it cost?).

2. **Ava (Frontend):** Implement the page. React component, Prism brand system, spectral mesh canvas on hero, staggered entry animations per Section 09 of brand spec. Mobile-responsive. No external dependencies beyond existing design system.

3. **Ryan (Template Architect):** Ensure the page conforms to Prism component patterns — card shadows, rim lighting, stat card accent strips, active nav behavior. Run the Brand Compliance Checklist against the finished page.

4. **Maya (CMO):** Write all page copy following the Brand Guide voice principles. Present tense, active voice, specific. "Your AI team publishes 3 blog posts per week" not "our AI can help you create content." No banned words. Each capability should have a concrete example: "Tyler analyzed your top 20 competitors' content strategies and identified 7 gaps in your keyword coverage" — not "AI-powered content intelligence."

5. **Tyler (Content):** Write the FAQ answers. Voice: confident, direct, no hedging. Address objections head-on. For "is this another chatbot?" — "No. Chatbots answer questions. Your AI marketing department ships campaigns, publishes content, monitors competitors, and reports results. You don't chat with it. You direct it."

### Success metric

Landing page live at glyphor.ai/marketing (or /slack or /departments/marketing — Mia to recommend URL). Lighthouse score > 90 performance, 100 accessibility. Page converts — meaning it clearly communicates what the product is, who it's for, and why it's different, with a working CTA.

---

## Directive 4: Dashboard & Platform Health Stabilization

**Priority:** CRITICAL
**Assigned to:** Marcus Reeves (CTO)
**Supporting:** Alex Park (Platform Eng), Jordan Hayes (DevOps), Sam DeLuca (Quality Eng), Atlas Vega (Ops)
**Deadline:** 5 days

### Objective

The diagnostic results show Marcus (CTO) is stuck in a death loop — all recent CTO runs are dying before completing turn 1 and getting reaped. Additionally, the platform has several health issues: history compression is not active (late-turn tokens hitting 200–569K), 45 blocked assignments are clogging the pipeline, and 8 agents have abort rates above 20%. This directive stabilizes the platform.

### Assignments

1. **Marcus (CTO):** Diagnose and fix your own death loop first. Run this query to identify the failure pattern:
   ```sql
   SELECT id, task, status, error, turns, input_tokens, duration_ms, created_at
   FROM agent_runs WHERE agent_role = 'cto'
   AND status IN ('failed', 'aborted')
   AND created_at > NOW() - INTERVAL '3 days'
   ORDER BY created_at DESC LIMIT 30;
   ```
   Most likely cause: MCP engineering server connection timeout or tool initialization failure during pre-turn-1 setup. Fix: add a timeout guard to tool loading that falls back to core tools if MCP init hangs beyond 15 seconds.

2. **Alex (Platform Eng):** Verify history compression is active. Check that `compressHistory()` from `historyManager.ts` is being called inside the agentic loop in `baseAgentRunner.ts` before every model call (not just once at start), AND that the compressed result is being passed to `modelClient.chat()`. Add a temporary log to confirm compression is firing:
   ```
   [history] {role} turn {N}: {before} msgs → {after} msgs, ~{beforeTokens} → ~{afterTokens} tokens ({pct}% reduction)
   ```
   After confirming, re-run diagnostic query 3 (turn-1 token baseline). Target: late-turn cumulative should drop from 200–569K to under 100K.

3. **Jordan (DevOps):** Run the blocked assignment cleanup:
   ```sql
   UPDATE work_assignments SET status = 'blocked',
     blocker_reason = 'Manual cleanup: stuck > 48 hours'
   WHERE status IN ('dispatched', 'pending')
   AND created_at < NOW() - INTERVAL '48 hours';
   
   UPDATE work_assignments SET status = 'blocked',
     blocker_reason = 'Manual cleanup: in_progress > 12 hours'
   WHERE status = 'in_progress'
   AND created_at < NOW() - INTERVAL '12 hours';
   ```
   Then deploy the auto-escalation function from the fix plan (stale assignment timeout escalation in workLoop.ts) so this doesn't build up again.

4. **Sam (Quality Eng):** After Alex confirms history compression is live, run the full diagnostic suite (`diagnostics.sql`) and report the before/after comparison. Focus on: abort_pct by agent, avg_late_turn_input, avg_post_abort_gap_min, and stuck runs count. Post results to #engineering.

5. **Atlas (Ops):** Monitor agent health across the next 48 hours post-fix. Flag any agent with abort rate > 15% or any agent with 0 completed runs in a 4-hour window. Report anomalies to Marcus immediately.

### Success metric

CTO is completing runs (turns > 0, status = completed). History compression is confirmed active with log evidence. Late-turn tokens < 100K. Blocked assignments < 10. Abort rate < 10% for all agents within 48 hours.

---

## Directive 5: Competitive Landscape Research

**Priority:** HIGH
**Assigned to:** Sophia Lin (VP Research)
**Supporting:** Lena Park (Competitive Research), Daniel Okafor (Market Research), Kai Nakamura (Technical Research), Amara Diallo (Industry Research), Riya Mehta (AI Impact), Daniel Ortiz (Competitive Intel)
**Deadline:** 10 days

### Objective

Produce a comprehensive competitive landscape analysis identifying every company building autonomous AI agents, AI workforce platforms, or AI-native company structures. We need to understand who they are, what they claim, what they've actually shipped, how they're funded, and where the gaps and threats are. This directly informs our GTM positioning, investor narrative, and product roadmap.

### Assignments

1. **Sophia (VP Research):** Decompose this into parallel analyst briefs and orchestrate the multi-wave research flow. The final deliverable is a single executive-ready report with these sections:
   - **Competitive map:** Every relevant player categorized by approach (single-agent tools, agent frameworks, copilots, autonomous platforms, AI workforce companies).
   - **Detailed profiles:** Top 10 competitors with deep analysis (funding, team, product, architecture, pricing, customers, moat).
   - **Gap analysis:** Where does Glyphor have an architectural advantage that no competitor has shipped? Where are we behind?
   - **Threat assessment:** Which competitors could become existential threats within 12 months? What would have to be true for that to happen?
   - **Positioning recommendations:** Based on the landscape, refine our competitive messaging for each competitor category.

2. **Lena (Competitive Research):** Deep-dive profiles on direct competitors — companies specifically building multi-agent AI organizations or AI workforce platforms. For each: what they claim, what's actually shipped (not just announced), funding, team background, architecture (if known), pricing, public customer references. Use web search extensively. Sources: company sites, Crunchbase, LinkedIn, product documentation, GitHub repos, blog posts, demo videos.

3. **Daniel Okafor (Market Research):** Size the market segments. What's the TAM for autonomous AI workforce? How is the market being segmented by analysts (Gartner, Forrester, CB Insights)? What category are we being placed in vs. where we should be? Identify the keywords and categories enterprise buyers use when searching for solutions in our space.

4. **Kai (Technical Research):** Analyze the technical architectures of the top 5 competitors. How do they handle multi-agent orchestration? What models do they use? How do they handle verification and trust? Do they have anything equivalent to our authority tiers, world models, cross-model consensus, or knowledge graph? Technical depth is important — this informs our patent strategy and architectural moat claims.

5. **Amara (Industry Research):** Track the macro trends driving our market. Enterprise AI adoption rates, AI workforce spending projections, regulatory landscape (EU AI Act implications for autonomous agents), hiring trends in AI vs. traditional roles. What industry shifts make our approach more or less viable in the next 12–24 months?

6. **Riya (AI Impact):** Assess how frontier model improvements affect the competitive landscape. As models get better, does that help us more or help single-agent tools more? What capabilities are models gaining that could eliminate the need for multi-agent architectures? What capabilities are they still missing that validate our approach?

7. **Daniel Ortiz (Competitive Intel):** Set up ongoing monitoring. Create a competitive tracking brief with triggers: new funding rounds, product launches, hiring announcements, customer wins, and partnership deals for our top 10 competitors. This should be a living document that updates weekly.

### Success metric

Executive-ready competitive landscape report delivered as a structured document with all sections above. Competitive monitoring system established with weekly cadence. Findings inform updated messaging in the Brand Guide and positioning for the Slack landing page.

---

## Routing Note for Sarah

These five directives should be decomposed and dispatched in this order:

1. **Directive 4 (Platform Health)** — FIRST. Nothing else works reliably until the CTO death loop and history compression are fixed.
2. **Directive 1 (Brand Voice)** — Second. The brand guide must be established before any marketing work ships.
3. **Directive 5 (Competitive Research)** — Can start in parallel with Directive 1. Research doesn't depend on brand assets.
4. **Directive 3 (Slack Landing Page)** — Depends on Directive 1 (brand compliance) and benefits from Directive 5 (competitive positioning).
5. **Directive 2 (Campaign Launch)** — Last. Depends on Directive 1 (brand assets) and Directive 3 (landing page to drive traffic to).

Estimated total assignments: 25–30 across all five directives. Dispatch in waves with dependency resolution.
