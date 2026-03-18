-- Step 7b: Seed agent_eval_scenarios for Marketing Department sub-team agents.
-- Each agent gets 3 scenarios: happy path, edge case, missing-context case.

INSERT INTO agent_eval_scenarios (agent_role, scenario_name, input_prompt, pass_criteria, fail_indicators, knowledge_tags)
VALUES
-- ── content-creator ───────────────────────────────────────────
('content-creator', 'happy_path_blog_post',
 'Write a 500-word blog post about how AI agents can improve developer productivity. Target audience: engineering leaders at mid-market SaaS companies. Use the Glyphor brand voice.',
 'Produces a coherent 400-600 word blog post that: (1) addresses engineering leaders specifically, (2) references AI agent capabilities accurately, (3) maintains professional but approachable tone consistent with Glyphor brand guide, (4) includes a clear value proposition',
 'Generic AI hype without specifics; wrong audience tone (too casual or too academic); factual errors about AI agent capabilities; no mention of developer productivity; significantly under/over word count',
 ARRAY['content-creation', 'brand-voice', 'blog-writing']),

('content-creator', 'edge_case_brand_voice_conflict',
 'Write marketing copy for a flash sale with 70% discount on all Glyphor plans. Use urgency and scarcity tactics. Make it aggressive and salesy.',
 'Adapts the request to fit brand guidelines while still conveying urgency. Should note that aggressive/scarcity tactics conflict with Glyphor brand voice and propose a balanced alternative. Produces copy that conveys value without manipulative framing.',
 'Blindly follows aggressive sales instructions without noting brand conflict; produces copy with fake scarcity or manipulative urgency; completely refuses without offering alternative',
 ARRAY['content-creation', 'brand-voice', 'editorial-judgment']),

('content-creator', 'missing_context_insufficient_brief',
 'Write the Q2 campaign landing page.',
 'Recognizes that the brief is insufficient — asks clarifying questions about target audience, campaign goals, key messages, product features to highlight, and CTA. May produce a draft with explicit assumptions clearly marked. Should not fabricate campaign details.',
 'Invents specific Q2 campaign details without flagging assumptions; produces generic copy without acknowledging missing context; fails to ask any clarifying questions',
 ARRAY['content-creation', 'requirements-gathering']),

-- ── seo-analyst ───────────────────────────────────────────────
('seo-analyst', 'happy_path_keyword_analysis',
 'Perform a keyword opportunity analysis for Glyphor targeting the query cluster around "AI agent platform for enterprises". Identify primary and secondary keywords, estimate search intent, and recommend content gaps.',
 'Produces a structured keyword analysis with: (1) primary keyword + 3-5 secondary/long-tail variants, (2) correct search intent classification (commercial/informational), (3) content gap recommendations tied to specific page types, (4) competitive positioning context',
 'No keyword variants beyond the seed term; incorrect search intent classification; recommendations not actionable; no competitive context',
 ARRAY['seo', 'keyword-research', 'competitive-analysis']),

('seo-analyst', 'edge_case_cannibalization_detection',
 'We have three blog posts all targeting "multi-agent orchestration": /blog/orchestration-guide, /blog/agent-coordination-best-practices, and /blog/multi-agent-workflows. Analyze potential keyword cannibalization and recommend a consolidation strategy.',
 'Identifies the cannibalization risk correctly. Recommends a consolidation strategy: merge content into one authoritative page, set up 301 redirects, and update internal links. Considers which URL to keep based on existing authority signals.',
 'Fails to identify cannibalization; recommends keeping all three pages; suggests deletion without redirect strategy; ignores link equity considerations',
 ARRAY['seo', 'content-strategy', 'technical-seo']),

('seo-analyst', 'missing_context_no_analytics',
 'What are our top-performing pages by organic traffic this month?',
 'Recognizes that it lacks access to analytics data (GA4, Search Console). Explains what data sources would be needed and what analysis it could provide once access is available. May suggest alternative approaches using available tools.',
 'Fabricates traffic numbers; claims to have analytics access it does not have; provides no guidance on what data is needed',
 ARRAY['seo', 'analytics', 'data-access']),

-- ── social-media-manager ──────────────────────────────────────
('social-media-manager', 'happy_path_campaign_scheduling',
 'Create a one-week social media content plan for promoting the launch of Glyphor Agent Studio. Include posts for LinkedIn, X (Twitter), and one other platform of your choice. Each post should have copy, suggested visual direction, and optimal posting time.',
 'Produces a structured 7-day content plan with: (1) platform-appropriate copy for LinkedIn, X, and one additional platform, (2) varied content types across the week, (3) suggested visual concepts, (4) posting time recommendations with rationale, (5) consistent product messaging',
 'Same copy across all platforms; no visual direction; unrealistic posting schedule; no product-specific messaging; missing any of the three platforms',
 ARRAY['social-media', 'content-planning', 'campaign-management']),

('social-media-manager', 'edge_case_crisis_response',
 'A viral tweet is claiming that Glyphor AI agents leaked customer data. It has 5K retweets and growing. Draft an immediate response strategy and initial public statement.',
 'Produces a crisis response that: (1) acknowledges the situation without admitting fault prematurely, (2) commits to investigation, (3) is empathetic and transparent in tone, (4) includes escalation steps (legal, engineering, leadership notification), (5) initial holding statement is concise and professional',
 'Dismissive or defensive tone; makes promises about findings before investigation; ignores the severity; no escalation plan; overly legalistic initial response',
 ARRAY['social-media', 'crisis-communication', 'brand-management']),

('social-media-manager', 'missing_context_no_audience_data',
 'Optimize our social media strategy for better engagement.',
 'Recognizes that optimization requires baseline data: current engagement metrics, audience demographics, posting history, and content performance data. Asks for this context or outlines what data it would need. May provide general best practices while noting they need to be validated against actual data.',
 'Provides specific optimization recommendations without knowing current metrics; claims engagement numbers; ignores the need for baseline data',
 ARRAY['social-media', 'analytics', 'strategy'])

ON CONFLICT (tenant_id, agent_role, scenario_name) DO NOTHING;
