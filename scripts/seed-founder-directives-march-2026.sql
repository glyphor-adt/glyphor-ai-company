-- ============================================================
-- FOUNDER DIRECTIVES — March 2026
-- Issued by: Kristina Denney (CEO)
-- Date: 2026-03-10
-- Routing: Sarah Chen (CoS) for decomposition and dispatch
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- Directive 4: Dashboard & Platform Health Stabilization
-- (FIRST — nothing else works until platform is stable)
-- ────────────────────────────────────────────────────────────

INSERT INTO founder_directives (title, description, priority, category, target_agents, status, due_date)
VALUES (
  'Dashboard & Platform Health Stabilization',
  E'CRITICAL: The diagnostic results show Marcus (CTO) is stuck in a death loop — all recent CTO runs are dying before completing turn 1 and getting reaped. Additionally, the platform has several health issues: history compression is not active (late-turn tokens hitting 200–569K), 45 blocked assignments are clogging the pipeline, and 8 agents have abort rates above 20%. This directive stabilizes the platform.\n\nAssignments:\n1. Marcus (CTO): Diagnose and fix your own death loop first. Most likely cause: MCP engineering server connection timeout or tool initialization failure during pre-turn-1 setup. Fix: add a timeout guard to tool loading that falls back to core tools if MCP init hangs beyond 15 seconds.\n2. Alex (Platform Eng): Verify history compression is active. Check that compressHistory() from historyManager.ts is being called inside the agentic loop in baseAgentRunner.ts before every model call. Add a temporary log to confirm compression is firing. Target: late-turn cumulative should drop from 200–569K to under 100K.\n3. Jordan (DevOps): Run the blocked assignment cleanup for stuck > 48 hours and in_progress > 12 hours. Then deploy the auto-escalation function from the fix plan (stale assignment timeout escalation in workLoop.ts).\n4. Sam (Quality Eng): After Alex confirms history compression is live, run the full diagnostic suite (diagnostics.sql) and report the before/after comparison. Focus on abort_pct by agent, avg_late_turn_input, avg_post_abort_gap_min, and stuck runs count.\n5. Atlas (Ops): Monitor agent health across the next 48 hours post-fix. Flag any agent with abort rate > 15% or any agent with 0 completed runs in a 4-hour window.\n\nSuccess metric: CTO is completing runs (turns > 0, status = completed). History compression is confirmed active with log evidence. Late-turn tokens < 100K. Blocked assignments < 10. Abort rate < 10% for all agents within 48 hours.',
  'critical',
  'engineering',
  ARRAY['cto', 'platform-engineer', 'devops-engineer', 'quality-engineer', 'ops'],
  'active',
  NOW() + INTERVAL '5 days'
);

-- ────────────────────────────────────────────────────────────
-- Directive 1: Establish Brand Voice & Identity System
-- (Second — brand guide must be established before marketing ships)
-- ────────────────────────────────────────────────────────────

INSERT INTO founder_directives (title, description, priority, category, target_agents, status, due_date)
VALUES (
  'Establish Brand Voice & Identity System',
  E'CRITICAL: The Glyphor Brand Guide (GLYPHOR_BRAND_GUIDE.md) is now our source of truth for all branding, voice, tone, messaging, and visual identity. All agents producing external-facing content must conform to it immediately. This directive establishes the brand guide as an operational standard across the company.\n\nAssignments:\n1. Maya (CMO): Review Brand Guide sections 01–04 (Brand Essence, Attributes, Voice & Tone, Messaging Framework). Internalize voice principles, banned patterns, and tone matrix. Update agent brief and all content team briefs. Produce a 1-page "Brand Voice Quick Reference Card" — include banned words list, tone-by-context table, and 3 before/after copy examples.\n2. Mia (VP Design): Review sections 05–07 and 09–12 (Visual Identity, Accessibility, Co-branding, Channel Guidelines, Motion, Agent Identity, Templates). Audit current dashboard against accessibility standards in section 06. Flag any Hyper Cyan text on dark backgrounds below 4.5:1 contrast. Produce a "Brand Compliance Checklist".\n3. Tyler (Content): Take "Still You" campaign copy from section 08 and produce platform-ready versions for LinkedIn (6 posts), X/Twitter (6 tweets), and one long-form blog post titled "Everyone else built a copilot. We built a company." Follow voice principles exactly: present tense, active voice, no banned words, no exclamation marks.\n4. Sofia (Design Critic): Once Mia''s compliance checklist is complete, run it against the current glyphor.ai landing page, dashboard, and Prism v5.6 component set. Report any drift or violations.\n5. Leo (UI/UX): Design 6 social media cards for "Still You" campaign — one per ad. Prism Midnight background. Agency font for "STILL YOU." and the tagline. Hyper Cyan for glyphor wordmark and tagline. Format: square (1080×1080) and landscape (1920×1080).\n\nReference document: GLYPHOR_BRAND_GUIDE.md\n\nSuccess metric: Brand Guide is referenced in all content and design agent briefs. Brand Compliance Checklist exists and has been run against live assets. "Still You" campaign assets are ready for social deployment.',
  'critical',
  'marketing',
  ARRAY['cmo', 'vp-design', 'content-creator', 'design-critic', 'ui-ux-designer'],
  'active',
  NOW() + INTERVAL '7 days'
);

-- ────────────────────────────────────────────────────────────
-- Directive 5: Competitive Landscape Research
-- (Can start in parallel with Directive 1)
-- ────────────────────────────────────────────────────────────

INSERT INTO founder_directives (title, description, priority, category, target_agents, status, due_date)
VALUES (
  'Competitive Landscape Research',
  E'Produce a comprehensive competitive landscape analysis identifying every company building autonomous AI agents, AI workforce platforms, or AI-native company structures. We need to understand who they are, what they claim, what they''ve actually shipped, how they''re funded, and where the gaps and threats are. This directly informs our GTM positioning, investor narrative, and product roadmap.\n\nAssignments:\n1. Sophia (VP Research): Decompose into parallel analyst briefs and orchestrate the multi-wave research flow. Final deliverable: executive-ready report with competitive map, detailed profiles (top 10), gap analysis, threat assessment, and positioning recommendations.\n2. Lena (Competitive Research): Deep-dive profiles on direct competitors — multi-agent AI organizations or AI workforce platforms. For each: claims vs. shipped, funding, team, architecture, pricing, public customers. Use web search extensively.\n3. Daniel Okafor (Market Research): Size the market segments. TAM for autonomous AI workforce? How is market segmented by analysts (Gartner, Forrester, CB Insights)? Identify keywords and categories enterprise buyers use.\n4. Kai Nakamura (Technical Research): Analyze technical architectures of top 5 competitors. Multi-agent orchestration, models, verification/trust, equivalents to our authority tiers, world models, cross-model consensus, knowledge graph.\n5. Amara (Industry Research): Track macro trends — enterprise AI adoption rates, AI workforce spending projections, regulatory landscape (EU AI Act), hiring trends AI vs. traditional roles.\n6. Riya (AI Impact): Assess how frontier model improvements affect competitive landscape. Do better models help us more or single-agent tools more? What capabilities validate or threaten our multi-agent approach?\n7. Daniel Ortiz (Competitive Intel): Set up ongoing monitoring with triggers: new funding rounds, product launches, hiring announcements, customer wins, partnership deals for top 10 competitors. Weekly cadence.\n\nSuccess metric: Executive-ready competitive landscape report delivered. Competitive monitoring system established with weekly cadence. Findings inform updated messaging in Brand Guide and positioning for Slack landing page.',
  'high',
  'general',
  ARRAY['vp-research', 'competitive-research-analyst', 'market-research-analyst', 'technical-research-analyst', 'industry-research-analyst', 'ai-impact-analyst', 'competitive-intel'],
  'active',
  NOW() + INTERVAL '10 days'
);

-- ────────────────────────────────────────────────────────────
-- Directive 3: Slack AI Marketing Department Landing Page
-- (Depends on Directive 1 brand compliance)
-- ────────────────────────────────────────────────────────────

INSERT INTO founder_directives (title, description, priority, category, target_agents, status, due_date)
VALUES (
  'Slack AI Marketing Department Landing Page',
  E'Build a dedicated landing page for Glyphor''s Slack-integrated AI Marketing Department offering. This is our first revenue-generating product — the entry wedge is Slack, with the dashboard at app.glyphor.ai as supporting infrastructure. The landing page needs to convert a marketing leader who is overwhelmed, understaffed, and skeptical of another AI tool.\n\nAssignments:\n1. Mia (VP Design): Own page design. Prism Midnight page with Prism Solar sections. Structure: Hero (headline + subheadline + CTA), How it works (3-step), The team (AI marketing agents with names/titles/avatars), What they do (capabilities grid with real output examples), Pricing (current tiers), FAQ (top 5 objections).\n2. Ava (Frontend): Implement the page. React component, Prism brand system, spectral mesh canvas on hero, staggered entry animations per Section 09 of brand spec. Mobile-responsive.\n3. Ryan (Template Architect): Ensure page conforms to Prism component patterns. Run Brand Compliance Checklist against finished page.\n4. Maya (CMO): Write all page copy following Brand Guide voice principles. Present tense, active voice, specific. No banned words. Each capability needs a concrete example.\n5. Tyler (Content): Write FAQ answers. Voice: confident, direct, no hedging. Address objections head-on.\n\nDepends on: Directive 1 (brand compliance) and benefits from Directive 5 (competitive positioning).\n\nSuccess metric: Landing page live at glyphor.ai/marketing. Lighthouse score > 90 performance, 100 accessibility. Clear communication of product, audience, and differentiation with working CTA.',
  'high',
  'product',
  ARRAY['vp-design', 'frontend-engineer', 'template-architect', 'cmo', 'content-creator'],
  'active',
  NOW() + INTERVAL '10 days'
);

-- ────────────────────────────────────────────────────────────
-- Directive 2: "Still You" Marketing Campaign Launch
-- (Last — depends on brand assets and landing page)
-- ────────────────────────────────────────────────────────────

INSERT INTO founder_directives (title, description, priority, category, target_agents, status, due_date)
VALUES (
  '"Still You" Marketing Campaign Launch',
  E'Launch the "Still You" campaign across social channels with a coordinated content calendar, landing page, and engagement strategy. This is our first major brand campaign and it needs to land with the energy of the Anthropic Super Bowl ads — dry, sarcastic, instantly recognizable.\n\nAssignments:\n1. Maya (CMO): Own the campaign rollout plan. Determine cadence — all 6 ads in one week or stagger over 2? Build content calendar. Start with most universally relatable ads (Ad 1: Marketing Plan, Ad 6: Monday Morning), save sharpest for mid-campaign.\n2. Kai (Social Media): Schedule and publish campaign social cards and copy. Monitor engagement, replies, quote-tweets in real-time. Engage with copilot frustration stories using #stillyou hashtag. Tone: dry, never defensive, never salesy.\n3. Lisa (SEO): Research target keywords for campaign blog post and landing page. Focus on copilot frustration terms: "copilot limitations," "AI assistant not working," "copilot vs autonomous AI," "AI that does the work." Produce keyword brief for Tyler''s blog post.\n4. Tyler (Content): Produce blog post per Directive 1. Draft 3 follow-up pieces for 2 weeks post-launch: "Copilot Fatigue" thought leadership, "What autonomous AI actually means" explainer, "Behind the scenes: how 44 agents run a company" technical narrative.\n5. Leo (UI/UX): Design dedicated campaign mini-site or landing section at glyphor.ai/stillyou with 6 ads as scrollable series. Prism Midnight. Minimal. CTA to main product page.\n\nDepends on: Directive 1 (brand assets) and Directive 3 (landing page).\n\nSuccess metric: All 6 ads published to LinkedIn + X. Blog post live. Campaign landing page live. Engagement tracked and reported daily for first 2 weeks.',
  'high',
  'marketing',
  ARRAY['cmo', 'social-media-manager', 'seo-analyst', 'content-creator', 'ui-ux-designer'],
  'active',
  NOW() + INTERVAL '14 days'
);

COMMIT;
