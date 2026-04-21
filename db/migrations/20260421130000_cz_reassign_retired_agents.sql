-- Reassign CZ tasks owned by retired agent names to active equivalents.
--
-- Context: the 2026-04-18 roster prune retired vp-sales, content-creator,
-- seo-analyst, and social-media-manager. The CZ seed predates the prune and
-- still assigns tasks to the personas rachel/tyler/lisa/kai, which resolve to
-- those retired roles. Runs for these tasks succeed at the runner but the
-- underlying tools hit the runtime policy gate and return "not on the live
-- runtime roster" — the agent produces an apologetic non-answer and the task
-- scores ~2/10 for completeness=0.
--
-- Reassignments (chosen to preserve the spirit of each task):
--   rachel (vp-sales)       -> maya (cmo)         — positioning/GTM/sales strategy
--   tyler  (content-creator)-> maya (cmo)         — marketing content
--   lisa   (seo-analyst)    -> vp-research        — research/competitive intel/SEO analysis
--   kai    (social-media)   -> maya (cmo)         — defensive; kai owns no CZ tasks today
--
-- A pre-flight check in the CZ executor (czProtocolApi.ts) additionally marks
-- any future retired-agent assignment as "unscored (agent retired)" so the
-- same silent-failure can't happen again.

UPDATE cz_tasks
   SET responsible_agent = 'maya'
 WHERE responsible_agent = 'rachel'
   AND created_by = 'seed';

UPDATE cz_tasks
   SET responsible_agent = 'maya'
 WHERE responsible_agent = 'tyler'
   AND created_by = 'seed';

UPDATE cz_tasks
   SET responsible_agent = 'vp-research'
 WHERE responsible_agent = 'lisa'
   AND created_by = 'seed';

UPDATE cz_tasks
   SET responsible_agent = 'maya'
 WHERE responsible_agent = 'kai'
   AND created_by = 'seed';
