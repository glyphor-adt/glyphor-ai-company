-- Repair verification_passes schema drift.
-- Some runtime bootstraps created this column as INTEGER, but verification metadata stores pass names.

ALTER TABLE IF EXISTS agent_runs
  ADD COLUMN IF NOT EXISTS verification_passes TEXT[];

DO $$
DECLARE
  col_type text;
BEGIN
  SELECT c.udt_name
    INTO col_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'agent_runs'
    AND c.column_name = 'verification_passes'
  LIMIT 1;

  IF col_type = 'int4' THEN
    EXECUTE $sql$
      ALTER TABLE agent_runs
      ALTER COLUMN verification_passes TYPE TEXT[]
      USING CASE
        WHEN verification_passes IS NULL THEN NULL
        ELSE ARRAY[verification_passes::text]
      END
    $sql$;
  END IF;
END $$;
