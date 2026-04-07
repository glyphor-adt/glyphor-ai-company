BEGIN;

-- Some deployed environments still have legacy run_sessions.run_id marked NOT NULL.
-- Runtime now uses latest_run_id, so keep legacy column backward-compatible/non-blocking.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'run_sessions'
      AND column_name = 'run_id'
  ) THEN
    EXECUTE 'ALTER TABLE run_sessions ALTER COLUMN run_id DROP NOT NULL';

    -- Preserve compatibility for readers that still inspect run_id.
    EXECUTE '
      UPDATE run_sessions
         SET run_id = COALESCE(run_id, latest_run_id, session_key)
       WHERE run_id IS NULL
    ';
  END IF;
END $$;

COMMIT;
