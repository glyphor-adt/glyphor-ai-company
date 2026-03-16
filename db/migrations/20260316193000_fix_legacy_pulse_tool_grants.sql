-- Normalize remaining legacy pulse tool names after company_vitals rename.
-- Safe to run repeatedly.

-- 1) Ensure modern vitals tool grants exist for any role that still has legacy pulse grants.
INSERT INTO agent_tool_grants (
  agent_role,
  tool_name,
  granted_by,
  reason,
  directive_id,
  scope,
  is_active,
  expires_at
)
SELECT
  agent_role,
  'get_company_vitals',
  granted_by,
  reason,
  directive_id,
  scope,
  is_active,
  expires_at
FROM agent_tool_grants
WHERE tool_name = 'get_company_pulse'
ON CONFLICT (agent_role, tool_name) DO NOTHING;

INSERT INTO agent_tool_grants (
  agent_role,
  tool_name,
  granted_by,
  reason,
  directive_id,
  scope,
  is_active,
  expires_at
)
SELECT
  agent_role,
  'update_company_vitals',
  granted_by,
  reason,
  directive_id,
  scope,
  is_active,
  expires_at
FROM agent_tool_grants
WHERE tool_name = 'update_company_pulse'
ON CONFLICT (agent_role, tool_name) DO NOTHING;

INSERT INTO agent_tool_grants (
  agent_role,
  tool_name,
  granted_by,
  reason,
  directive_id,
  scope,
  is_active,
  expires_at
)
SELECT
  agent_role,
  'update_vitals_highlights',
  granted_by,
  reason,
  directive_id,
  scope,
  is_active,
  expires_at
FROM agent_tool_grants
WHERE tool_name = 'update_pulse_highlights'
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- 2) Remove legacy pulse grants once replacement grants exist.
DELETE FROM agent_tool_grants
WHERE tool_name IN (
  'get_company_pulse',
  'update_company_pulse',
  'update_pulse_highlights'
);

-- 3) Update any stale skill arrays in either schema shape.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'skills' AND column_name = 'tool_names'
  ) THEN
    UPDATE skills
    SET tool_names = array_replace(array_replace(array_replace(
      tool_names,
      'get_company_pulse',
      'get_company_vitals'
    ),
      'update_company_pulse',
      'update_company_vitals'
    ),
      'update_pulse_highlights',
      'update_vitals_highlights'
    )
    WHERE 'get_company_pulse' = ANY(tool_names)
       OR 'update_company_pulse' = ANY(tool_names)
       OR 'update_pulse_highlights' = ANY(tool_names);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'skills' AND column_name = 'tools_granted'
  ) THEN
    UPDATE skills
    SET tools_granted = array_replace(array_replace(array_replace(
      tools_granted,
      'get_company_pulse',
      'get_company_vitals'
    ),
      'update_company_pulse',
      'update_company_vitals'
    ),
      'update_pulse_highlights',
      'update_vitals_highlights'
    )
    WHERE 'get_company_pulse' = ANY(tools_granted)
       OR 'update_company_pulse' = ANY(tools_granted)
       OR 'update_pulse_highlights' = ANY(tools_granted);
  END IF;
END $$;
