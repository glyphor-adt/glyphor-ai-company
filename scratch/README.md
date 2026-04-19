# scratch/

One-off diagnostic / query scripts for cost investigation, forensic SQL, and ad-hoc schema checks.

Contents git-ignored (see .gitignore in this dir). Safe to delete files freely.

History of what was in here at 2026-04-19 19:00Z (post Phase-3 cleanup):
- _schema.js                — table column discovery
- _cost_by_task.js          — cost-per-(agent,task) query for any date
- _error_samples.js         — failure-mode sampling
- _today_and_budgets.js     — today's spend + duplicate schedules + budget table
- _pre_cleanup_audit.js     — ids of duplicate rows + poisoned directives preview
- _cleanup_step12.js        — the transactional cleanup script that was actually run
