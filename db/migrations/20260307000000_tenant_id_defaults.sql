-- Fix Supabase → GCP migration: Set tenant_id DEFAULT on ALL tables
-- Supabase auto-injected tenant_id via RLS triggers; GCP Cloud SQL does not.
-- Without a DEFAULT, every INSERT that omits tenant_id fails with:
--   "null value in column 'tenant_id' violates not-null constraint"

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT %L',
      tbl,
      '00000000-0000-0000-0000-000000000000'
    );
    RAISE NOTICE 'Set tenant_id DEFAULT on %', tbl;
  END LOOP;
END $$;
