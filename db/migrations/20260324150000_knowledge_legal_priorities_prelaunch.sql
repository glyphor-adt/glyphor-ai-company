-- CLO-owned legal priorities (Layer 2) for pre-launch / first customer
INSERT INTO company_knowledge_base (
  section,
  title,
  layer,
  audience,
  owner_agent_id,
  last_verified_at,
  is_stale,
  version,
  content,
  is_active,
  review_cadence,
  verified_by,
  change_summary
) VALUES (
  'legal_priorities',
  'Legal Priorities — Pre-Launch',
  2,
  'legal,executive',
  'clo',
  NOW(),
  FALSE,
  1,
  'Pre-launch legal priorities:
1. Terms of Service covering AI-generated content ownership
2. Data Processing Addendum for Slack workspace data access
3. Privacy Policy covering model provider sub-processors
4. Acceptable Use Policy
5. EU AI Act compliance assessment for AI agent classification

Current status: All documents in draft phase. No customer contracts active.
First customer onboarding requires TOS and DPA to be finalized.
Victoria Chase (CLO) owns all legal document preparation.',
  TRUE,
  'monthly',
  'migration:legal_priorities',
  'Seed legal priorities for CLO / executive context'
)
ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  layer = EXCLUDED.layer,
  audience = EXCLUDED.audience,
  owner_agent_id = EXCLUDED.owner_agent_id,
  last_verified_at = EXCLUDED.last_verified_at,
  is_stale = EXCLUDED.is_stale,
  version = COALESCE(company_knowledge_base.version, 1) + 1,
  content = EXCLUDED.content,
  is_active = EXCLUDED.is_active,
  review_cadence = EXCLUDED.review_cadence,
  verified_by = EXCLUDED.verified_by,
  change_summary = EXCLUDED.change_summary,
  updated_at = NOW();
