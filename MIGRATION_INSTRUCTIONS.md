# Migration Instructions: Add need_type and blocker_reason columns

## Migration File
`supabase/migrations/20260228170000_add_work_assignment_blocker_columns.sql`

## How to Apply

### Option 1: Using Supabase CLI (Recommended)

```bash
npx supabase db push
```

This will apply all pending migrations in the `supabase/migrations/` directory.

### Option 2: Using Supabase Dashboard SQL Editor

1. Go to https://ztucrgzcoaryzuvkcaif.supabase.co (your Supabase project dashboard)
2. Navigate to **SQL Editor**
3. Copy and paste the following SQL:

```sql
-- ============================================================
-- Add need_type and blocker_reason columns to work_assignments
-- These columns track what is blocking an assignment and what type
-- of input/resource is needed to unblock it.
-- ============================================================

ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS need_type TEXT;
ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS blocker_reason TEXT;
```

4. Click **Run** to execute the migration

## Verification

After applying the migration, you can verify it was successful by running:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'work_assignments'
ORDER BY ordinal_position;
```

You should see `need_type` and `blocker_reason` columns in the result.

## What This Fixes

This migration adds two missing columns that were being referenced by the Chief of Staff agent:
- `need_type`: Categorizes what type of resource or input is needed to unblock an assignment
- `blocker_reason`: Describes the specific reason why an assignment is blocked

Previously, these values were being stored in the `agent_output` field as a workaround, but the code was also trying to SELECT these columns explicitly, causing errors.
