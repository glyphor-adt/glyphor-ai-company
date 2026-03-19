-- Seed GTM knowledge eval scenarios for Marketing Department agents + chief-of-staff
-- Each agent needs at minimum 3 scenarios: happy path, edge case, missing context

INSERT INTO agent_eval_scenarios (agent_role, scenario_name, input_prompt, pass_criteria, fail_indicators, knowledge_tags, tenant_id)
VALUES
-- chief-of-staff scenarios
('chief-of-staff', 'task_delegation_quality',
 'We need a full competitive analysis of our top 3 competitors delivered by Friday.',
 'breaks task into subtasks, assigns to appropriate agents, sets deadline context',
 'attempts to do research itself, assigns all tasks to same agent, no deadline propagation',
 ARRAY['delegation', 'planning', 'deadline_management'],
 '00000000-0000-0000-0000-000000000000'),

('chief-of-staff', 'ambiguous_request_handling',
 'Fix the marketing.',
 'asks clarifying question, identifies ambiguity explicitly',
 'proceeds without clarification, makes assumptions without stating them',
 ARRAY['ambiguity_resolution', 'communication'],
 '00000000-0000-0000-0000-000000000000'),

('chief-of-staff', 'cross_department_coordination',
 'We need a product launch plan that covers marketing, engineering readiness, and customer success prep.',
 'identifies three departments, creates parallel workstreams, establishes coordination checkpoint',
 'sequential only, misses a department, no coordination mechanism',
 ARRAY['cross_department', 'coordination', 'launch_planning'],
 '00000000-0000-0000-0000-000000000000'),

-- content-creator scenarios (replace existing if any, or add new)
('content-creator', 'brand_voice_adherence',
 'Write a LinkedIn post announcing our new AI Marketing Department product.',
 'professional tone, clear value proposition, call to action',
 'generic AI content, no product specifics, wrong channel format',
 ARRAY['brand_voice', 'linkedin', 'product_messaging'],
 '00000000-0000-0000-0000-000000000000'),

('content-creator', 'missing_brief_handling',
 'Write content.',
 'requests brief or context, identifies missing information',
 'produces generic content without asking, ignores missing context',
 ARRAY['brief_handling', 'ambiguity_resolution'],
 '00000000-0000-0000-0000-000000000000'),

('content-creator', 'multi_format_awareness',
 'Create content for our product launch across email, LinkedIn, and Twitter.',
 'adapts format per channel, appropriate length per channel, consistent messaging',
 'identical content across channels, wrong format for channel',
 ARRAY['multi_channel', 'format_adaptation', 'content_strategy'],
 '00000000-0000-0000-0000-000000000000'),

-- seo-analyst scenarios
('seo-analyst', 'keyword_strategy',
 'What keywords should we target for our AI Marketing Department product?',
 'identifies intent categories, considers competition, maps to funnel stage',
 'generic keyword list, no intent analysis, no competitive context',
 ARRAY['keyword_research', 'intent_analysis', 'competitive_seo'],
 '00000000-0000-0000-0000-000000000000'),

('seo-analyst', 'technical_seo_awareness',
 'Our blog posts are not ranking despite good content. What should we check?',
 'mentions technical factors, prioritizes actionable items, asks for access to data',
 'only content recommendations, no technical diagnosis',
 ARRAY['technical_seo', 'diagnosis', 'ranking_factors'],
 '00000000-0000-0000-0000-000000000000'),

('seo-analyst', 'metrics_interpretation',
 'Our organic traffic dropped 30% last month.',
 'asks for more data, identifies possible causes systematically, requests Search Console data',
 'single cause assumption, no data request, immediate solution without diagnosis',
 ARRAY['analytics', 'traffic_analysis', 'diagnosis'],
 '00000000-0000-0000-0000-000000000000'),

-- social-media-manager scenarios
('social-media-manager', 'platform_strategy',
 'We want to build our social presence. Where should we focus for B2B SaaS?',
 'recommends LinkedIn priority, explains rationale, mentions content cadence',
 'recommends TikTok/Instagram first, no B2B context, no cadence recommendation',
 ARRAY['platform_selection', 'b2b_strategy', 'social_planning'],
 '00000000-0000-0000-0000-000000000000'),

('social-media-manager', 'engagement_response',
 'A prospect commented on our LinkedIn post asking how our product differs from Salesforce Agentforce.',
 'professional response, addresses differentiation, moves toward conversation',
 'generic response, no competitive differentiation, ignores the opportunity',
 ARRAY['engagement', 'competitive_positioning', 'lead_generation'],
 '00000000-0000-0000-0000-000000000000'),

('social-media-manager', 'content_calendar_planning',
 E'Plan next month''s social content for our product launch.',
 'creates structured calendar, varies content types, aligns with launch date',
 'no structure, single content type, no launch alignment',
 ARRAY['content_calendar', 'planning', 'launch_support'],
 '00000000-0000-0000-0000-000000000000')

ON CONFLICT DO NOTHING;
