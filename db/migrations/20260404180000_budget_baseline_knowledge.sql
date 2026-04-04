-- Canonical budget / economics baseline for completion-gate and fleet briefings.
-- Agents load via read_company_knowledge(section_key: 'budget_baseline').

BEGIN;

INSERT INTO company_knowledge_base (
  section,
  title,
  content,
  layer,
  audience,
  owner_agent_id,
  review_cadence,
  last_verified_at,
  verified_by,
  auto_expire,
  is_stale,
  is_active,
  version,
  change_summary
)
VALUES (
  'budget_baseline',
  'Economics & spend baseline (pre-launch)',
  $kb$STATUS: PRE-REVENUE / PRE-LAUNCH — baseline for ops and Nexus fleet briefings.

**Explicit baseline (company-approved framing)**
- MRR: $0 (expected until launch).
- Revenue / subscriptions: none — founders fund operations.
- **Infrastructure + AI compute:** treat GCP billing + model API usage as the primary variable cost bucket. Use live tools (get_financials, GCP billing sync, scheduler economics metrics) for current-month spend — do not invent dollars.
- **Target guardrail (planning only, not a contractual cap):** internal discussion target ~USD 150/mo compute for steady-state dev/staging when idle; real spend must come from billing tools.
- **Agent run economics:** use agent_runs / scheduler economics-overview metrics for average cost per completed run when gate or CFO tasks ask for a unit economics snapshot.

**How to use this section**
- Nexus / platform-intel: cite this section as the **organizational baseline** after calling read_company_knowledge with section_key budget_baseline, then reconcile with the latest tool pull (e.g. get_financials or economics API) when the task requires **current** numbers.
- If tools return no rows or errors: state **Blocker:** name the tool + error; do not fabricate totals.

**Owner:** CFO — update when launch pricing, budgets, or founder-approved targets change.$kb$,
  3,
  'executive,finance,operations',
  'cfo',
  'monthly',
  NOW(),
  'system:seed-budget-baseline',
  FALSE,
  FALSE,
  TRUE,
  1,
  'Seed budget_baseline for completion gate + fleet reporting'
)
ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  layer = EXCLUDED.layer,
  audience = EXCLUDED.audience,
  owner_agent_id = EXCLUDED.owner_agent_id,
  review_cadence = EXCLUDED.review_cadence,
  last_verified_at = EXCLUDED.last_verified_at,
  verified_by = EXCLUDED.verified_by,
  auto_expire = EXCLUDED.auto_expire,
  is_stale = FALSE,
  is_active = TRUE,
  version = COALESCE(company_knowledge_base.version, 1) + 1,
  change_summary = EXCLUDED.change_summary,
  updated_at = NOW();

COMMIT;
