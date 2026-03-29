BEGIN;

ALTER TABLE fleet_findings
  ALTER COLUMN tenant_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'fleet_findings'
       AND policyname = 'platform_agent_fleet_findings'
  ) THEN
    CREATE POLICY platform_agent_fleet_findings
      ON fleet_findings
      FOR INSERT
      WITH CHECK (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'fleet_findings'
       AND policyname = 'platform_agent_read_fleet_findings'
  ) THEN
    CREATE POLICY platform_agent_read_fleet_findings
      ON fleet_findings
      FOR SELECT
      USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant', true)::uuid
      );
  END IF;
END $$;

COMMIT;