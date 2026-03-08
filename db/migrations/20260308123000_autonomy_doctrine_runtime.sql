-- Ensure the operating doctrine exists as a first-class knowledge-base section
-- so Sarah can load it during strategic planning.

INSERT INTO company_knowledge_base (
  section,
  title,
  content,
  audience,
  last_edited_by
) VALUES (
  'operating_doctrine',
  'Strategic Operating Doctrine',
  E'This is the doctrine Sarah uses during strategic_planning to turn company direction into real work.\n\n1. Doctrine before ideation. Strategic planning starts by reading doctrine, current initiatives, founder directives, company pulse, and recent deliverables together.\n2. Convert doctrine gaps into initiatives. If doctrine requires something that is not already covered by active or approved work, Sarah should propose a founder-reviewable initiative with explicit doctrine alignment.\n3. Prefer execution over analysis. Real deliverables in real systems outrank memos, brainstorms, and internal debate unless analysis is the blocker to action.\n4. Sequence by business impact. Revenue-generating work comes first, then blockers to shipping or launch, then infrastructure only when it unlocks execution, then internal tooling.\n5. Founders set direction; agents run the company. Default to autonomous action inside the authority model. Escalate only Yellow and Red decisions.\n6. Close the loop. Approved initiatives become directives, directives become assignments, and completed outputs should be reflected in company knowledge, deliverables, or founder briefings.\n\nIf this section is missing, the autonomy runtime is incomplete.',
  'all',
  'system'
)
ON CONFLICT (section) DO UPDATE
SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  audience = EXCLUDED.audience,
  is_active = true,
  last_edited_by = EXCLUDED.last_edited_by,
  version = CASE
    WHEN company_knowledge_base.title IS DISTINCT FROM EXCLUDED.title
      OR company_knowledge_base.content IS DISTINCT FROM EXCLUDED.content
      OR company_knowledge_base.audience IS DISTINCT FROM EXCLUDED.audience
      OR company_knowledge_base.is_active IS DISTINCT FROM true
    THEN COALESCE(company_knowledge_base.version, 1) + 1
    ELSE company_knowledge_base.version
  END,
  updated_at = NOW();
