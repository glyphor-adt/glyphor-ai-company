-- C.11: Add missing task_skill_map patterns for 7 unrouted task types
-- Identified by fleet audit: orchestrate, strategic_planning (COS), research (analysts),
-- decompose_research, qc_and_package_research, follow_up_research (VP Research)

-- COS orchestration tasks → map to cross-team-coordination and decision-routing
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
VALUES
  ('(?i)(orchestrat|delegate_directive|dispatch|work.?assignment)', 'cross-team-coordination', 18),
  ('(?i)(strategic.?planning|strategy.?cycle|strategy.?review)', 'decision-routing', 16)
ON CONFLICT DO NOTHING;

-- Research analysts' "research" task type → map to their core skills
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
VALUES
  ('(?i)(^research$|research.?task|conduct.?research)', 'competitive-intelligence', 14),
  ('(?i)(^research$|research.?task|conduct.?research)', 'competitive-analysis', 14)
ON CONFLICT DO NOTHING;

-- VP Research orchestration tasks
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
VALUES
  ('(?i)(decompose.?research|research.?decomposition|break.?down.?research)', 'cross-team-coordination', 16),
  ('(?i)(qc.?and.?package|quality.?check.?research|package.?research|research.?qa)', 'cross-team-coordination', 15),
  ('(?i)(follow.?up.?research|research.?follow.?up|gap.?fill)', 'competitive-intelligence', 14)
ON CONFLICT DO NOTHING;
