BEGIN;

-- Some deployed environments still have legacy run_sessions.run_id marked NOT NULL.
-- Runtime now uses latest_run_id, so keep legacy column backward-compatible/non-blocking.
DO $$
DECLARE
  run_id_in_primary_key BOOLEAN := FALSE;
  has_latest_run_id BOOLEAN := FALSE;
  has_session_key BOOLEAN := FALSE;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'run_sessions'
      AND column_name = 'run_id'
  ) THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'run_sessions'
        AND tc.constraint_type = 'PRIMARY KEY'
        AND kcu.column_name = 'run_id'
    ) INTO run_id_in_primary_key;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'run_sessions'
        AND column_name = 'latest_run_id'
    ) INTO has_latest_run_id;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'run_sessions'
        AND column_name = 'session_key'
    ) INTO has_session_key;

    IF NOT has_latest_run_id THEN
      EXECUTE 'ALTER TABLE run_sessions ADD COLUMN latest_run_id TEXT';
    END IF;

    IF NOT run_id_in_primary_key THEN
      EXECUTE 'ALTER TABLE run_sessions ALTER COLUMN run_id DROP NOT NULL';
    END IF;

    -- Ensure latest_run_id is always hydrated from legacy run_id values.
    EXECUTE '
      UPDATE run_sessions
         SET latest_run_id = COALESCE(latest_run_id, run_id)
       WHERE latest_run_id IS NULL
    ';

    -- Preserve compatibility for readers that still inspect run_id.
    IF has_session_key THEN
      EXECUTE '
        UPDATE run_sessions
           SET run_id = COALESCE(run_id, latest_run_id, session_key)
         WHERE run_id IS NULL
      ';
    ELSE
      EXECUTE '
        UPDATE run_sessions
           SET run_id = COALESCE(run_id, latest_run_id)
         WHERE run_id IS NULL
      ';
    END IF;
  END IF;
END $$;

COMMIT;
