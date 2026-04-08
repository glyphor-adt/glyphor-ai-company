-- Broader task → skill routing so advanced-web-creation loads for Mia and other holders
-- when prompts mention deployments, repos, briefs, or generic web work (not only exact legacy phrases).

BEGIN;

INSERT INTO task_skill_map (task_regex, skill_slug, priority)
VALUES
  ('(?i)(normalize[_\\s]?design[_\\s]?brief|design[_\\s]?brief|invoke[_\\s]?web|web[_\\s]?build|plan[_\\s]?website|vercel|github|pull\\s*request|\\bpr\\b|fix\\s+(the\\s+)?(build|deploy|repo)|deployment\\s+failed|failed\\s+build|landing\\s*page|marketing\\s*site|company\\s*website|web\\s*app|single[-\\s]?page|responsive\\s*site|preview\\s*url|production\\s*url)',
   'advanced-web-creation',
   14),
  ('(?i)(email\\s+from\\s+founder|inbox\\s+request|directive\\s+assignment|work\\s*assignment|client\\s+website|build\\s+me\\s+a\\s+site|ship\\s+(a\\s+)?(page|site|app))',
   'advanced-web-creation',
   15),
  ('(?i)(hotfix|patch|css\\s*bug|tailwind|index\\.css|cloudflare|dns|domain\\s+config)',
   'advanced-web-creation',
   16);

COMMIT;
