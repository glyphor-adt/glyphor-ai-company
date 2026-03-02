-- Fix 6 agent profiles that have DiceBear placeholder URLs instead of real avatar paths.
-- The previous fix migration (20260228000001) used ON CONFLICT ... WHERE avatar_url IS NULL
-- which didn't match because the column already had a DiceBear URL string.

UPDATE agent_profiles
SET avatar_url = '/avatars/' || agent_id || '.png'
WHERE avatar_url LIKE 'https://api.dicebear.com/%';
