-- ═══════════════════════════════════════════════════════════════════
-- RENAME company_pulse → company_vitals
--
-- The "pulse" name conflicts with our Pulse creative product.
-- Also restructures to drop dead-weight columns that were never
-- updated, keeping only the fields that actually have data sources.
-- Live-queried fields (platform_status, active_incidents,
-- decisions_pending) are now computed at read time, not cached.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Rename the table
ALTER TABLE IF EXISTS company_pulse RENAME TO company_vitals;

-- 2. Drop columns that were never updated by any agent
ALTER TABLE company_vitals DROP COLUMN IF EXISTS new_users_today;
ALTER TABLE company_vitals DROP COLUMN IF EXISTS churn_events_today;
ALTER TABLE company_vitals DROP COLUMN IF EXISTS uptime_streak_days;
ALTER TABLE company_vitals DROP COLUMN IF EXISTS avg_build_time_ms;
ALTER TABLE company_vitals DROP COLUMN IF EXISTS meetings_today;
ALTER TABLE company_vitals DROP COLUMN IF EXISTS messages_today;

-- 3. Drop columns that are now computed live (not cached)
ALTER TABLE company_vitals DROP COLUMN IF EXISTS platform_status;
ALTER TABLE company_vitals DROP COLUMN IF EXISTS active_incidents;
ALTER TABLE company_vitals DROP COLUMN IF EXISTS decisions_pending;

-- 4. Rename tool grants: pulse → vitals
UPDATE agent_tool_grants SET tool_name = 'get_company_vitals'
  WHERE tool_name = 'get_company_pulse';
UPDATE agent_tool_grants SET tool_name = 'update_company_vitals'
  WHERE tool_name = 'update_company_pulse';
UPDATE agent_tool_grants SET tool_name = 'update_vitals_highlights'
  WHERE tool_name = 'update_pulse_highlights';

-- 5. Update skill playbook tool_names arrays
UPDATE skills SET tool_names = array_replace(tool_names, 'get_company_pulse', 'get_company_vitals')
  WHERE 'get_company_pulse' = ANY(tool_names);
UPDATE skills SET tool_names = array_replace(tool_names, 'update_company_pulse', 'update_company_vitals')
  WHERE 'update_company_pulse' = ANY(tool_names);
UPDATE skills SET tool_names = array_replace(tool_names, 'update_pulse_highlights', 'update_vitals_highlights')
  WHERE 'update_pulse_highlights' = ANY(tool_names);

-- 6. Update RLS policies to reference the new table name
-- (Postgres automatically renames policies on the table, but
--  policy names still reference old name — recreate for clarity)
DO $$
BEGIN
  -- Drop old-name policies if they exist
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_vitals' AND policyname LIKE '%pulse%') THEN
    DROP POLICY IF EXISTS "Anon read access" ON company_vitals;
    DROP POLICY IF EXISTS "Anon update company pulse" ON company_vitals;
    DROP POLICY IF EXISTS "Service role full access" ON company_vitals;
  END IF;

  -- Recreate with clean names
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_vitals' AND policyname = 'Anon read vitals') THEN
    CREATE POLICY "Anon read vitals" ON company_vitals FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_vitals' AND policyname = 'Anon update vitals') THEN
    CREATE POLICY "Anon update vitals" ON company_vitals FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_vitals' AND policyname = 'Service role vitals') THEN
    CREATE POLICY "Service role vitals" ON company_vitals FOR ALL USING (true);
  END IF;
END $$;

-- 7. Set platform_status to healthy as default since it will now be computed
-- (The column was dropped above, so this is just for the vitals context formatting)

-- 8. Create a backward-compat view so any straggler queries don't break
CREATE OR REPLACE VIEW company_pulse AS SELECT * FROM company_vitals;
