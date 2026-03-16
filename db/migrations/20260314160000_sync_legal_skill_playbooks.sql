-- Sync Legal team skill playbooks from markdown source files.
-- Sources:
--   skills/legal/legal-review.md
--   skills/legal/compliance-monitoring.md
--   skills/legal/ip-management.md

BEGIN;

WITH skill_payload (slug, name, category, description, methodology, tools_granted, version) AS (
  VALUES
    (
      'legal-review',
      'legal-review',
      'legal',
      'Analyze contracts, commercial agreements, terms of service, privacy policies, and legal obligations before execution, then route risk-rated legal decisions to founders.',
      $legal_review$
# Legal Review

Run each legal review through a structured risk framework:
1. Classify agreement type, value, and operational exposure.
2. Analyze liability, indemnification, IP, data/privacy, termination, and AI-specific clauses.
3. Assign Green/Yellow/Red risk with explicit rationale.
4. Produce decision-ready recommendations with clause-level actions.
5. Coordinate execution through DocuSign only after approval.

Nothing gets signed until legal review is complete.
      $legal_review$,
      ARRAY[
        'get_contracts',
        'get_contract_renewals',
        'create_contract_review',
        'flag_contract_issue',
        'create_signing_envelope',
        'send_template_envelope',
        'check_envelope_status',
        'list_envelopes',
        'resend_envelope',
        'void_envelope',
        'web_search',
        'web_fetch',
        'read_file',
        'create_or_update_file',
        'get_file_contents',
        'upload_to_sharepoint',
        'save_memory',
        'send_agent_message',
        'file_decision'
      ]::text[],
      2
    ),
    (
      'compliance-monitoring',
      'compliance-monitoring',
      'legal',
      'Track evolving regulatory obligations, run framework audits, maintain compliance checklists, and escalate legal/compliance gaps before enforcement risk materializes.',
      $compliance_monitoring$
# Compliance Monitoring

Operate a continuous compliance loop across EU AI Act, GDPR, CCPA, FTC, and SOC 2:
1. Track regulation changes and effective timelines.
2. Audit checklist status and evidence quality.
3. Identify control gaps and assign remediation.
4. Escalate deadline and enforcement risk early.
5. Publish monthly founder-ready compliance posture updates.

Proactive compliance prevents expensive reactive enforcement.
      $compliance_monitoring$,
      ARRAY[
        'get_compliance_status',
        'create_compliance_alert',
        'update_compliance_item',
        'track_regulations',
        'track_regulatory_changes',
        'audit_data_flows',
        'get_privacy_requests',
        'check_data_retention',
        'get_contracts',
        'web_search',
        'web_fetch',
        'read_file',
        'create_or_update_file',
        'get_file_contents',
        'save_memory',
        'send_agent_message',
        'file_decision',
        'propose_directive'
      ]::text[],
      2
    ),
    (
      'ip-management',
      'ip-management',
      'legal',
      'Manage patents, trademarks, trade secrets, and copyright strategy to protect Glyphor''s defensible technology, brand, and creative assets.',
      $ip_management$
# IP Management

Protect Glyphor's moat across four IP pillars:
1. Patents for defensible technical novelty.
2. Trademarks for brand identity protection.
3. Trade secrets for confidential operational advantage.
4. Copyright strategy for code and authored content.

Maintain portfolio health, monitor infringement, and escalate material IP risk with evidence-backed recommendations.
      $ip_management$,
      ARRAY[
        'get_ip_portfolio',
        'create_ip_filing',
        'monitor_ip_infringement',
        'web_search',
        'web_fetch',
        'read_file',
        'create_or_update_file',
        'get_file_contents',
        'save_memory',
        'send_agent_message',
        'file_decision',
        'propose_directive'
      ]::text[],
      2
    )
)
INSERT INTO skills (slug, name, category, description, methodology, tools_granted, version)
SELECT slug, name, category, description, methodology, tools_granted, version
FROM skill_payload
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  methodology = EXCLUDED.methodology,
  tools_granted = EXCLUDED.tools_granted,
  version = EXCLUDED.version,
  updated_at = NOW();

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('clo', 'legal-review', 'expert'),
    ('clo', 'compliance-monitoring', 'expert'),
    ('clo', 'ip-management', 'expert')
  ) AS x(agent_role, skill_slug, proficiency)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM holder_payload
),
existing_target AS (
  SELECT s.id AS skill_id, s.slug
  FROM skills s
  JOIN target_slugs t ON t.skill_slug = s.slug
)
DELETE FROM agent_skills ags
USING existing_target et
WHERE ags.skill_id = et.skill_id
  AND NOT EXISTS (
    SELECT 1
    FROM holder_payload hp
    WHERE hp.agent_role = ags.agent_role
      AND hp.skill_slug = et.slug
  );

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('clo', 'legal-review', 'expert'),
    ('clo', 'compliance-monitoring', 'expert'),
    ('clo', 'ip-management', 'expert')
  ) AS x(agent_role, skill_slug, proficiency)
)
INSERT INTO agent_skills (agent_role, skill_id, proficiency)
SELECT hp.agent_role, s.id, hp.proficiency
FROM holder_payload hp
JOIN skills s ON s.slug = hp.skill_slug
JOIN company_agents ca ON ca.role = hp.agent_role
ON CONFLICT (agent_role, skill_id) DO UPDATE SET
  proficiency = EXCLUDED.proficiency;

WITH mapping_payload AS (
  SELECT *
  FROM (VALUES
    ('(?i)(legal review|contract review|msa|dpa|nda|redline|indemnif|liability cap|terms of service|privacy policy)', 'legal-review', 18),
    ('(?i)(compliance monitor|eu ai act|gdpr|ccpa|cpra|soc 2|data subject request|regulatory change|privacy request)', 'compliance-monitoring', 18),
    ('(?i)(ip management|patent strategy|trademark filing|trade secret|copyright|ip infringement)', 'ip-management', 17)
  ) AS x(task_regex, skill_slug, priority)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM mapping_payload
)
DELETE FROM task_skill_map t
USING target_slugs s
WHERE t.skill_slug = s.skill_slug;

WITH mapping_payload AS (
  SELECT *
  FROM (VALUES
    ('(?i)(legal review|contract review|msa|dpa|nda|redline|indemnif|liability cap|terms of service|privacy policy)', 'legal-review', 18),
    ('(?i)(compliance monitor|eu ai act|gdpr|ccpa|cpra|soc 2|data subject request|regulatory change|privacy request)', 'compliance-monitoring', 18),
    ('(?i)(ip management|patent strategy|trademark filing|trade secret|copyright|ip infringement)', 'ip-management', 17)
  ) AS x(task_regex, skill_slug, priority)
)
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
SELECT task_regex, skill_slug, priority
FROM mapping_payload;

COMMIT;