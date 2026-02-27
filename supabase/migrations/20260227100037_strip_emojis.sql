-- Strip emoji data from agent_profiles
-- avatar_emoji is unused (dashboard uses avatar_url + PNGs), drop it.
-- Set emoji_usage to 0 for all agents since we no longer use emoji in prompts.
-- Clean emoji references from quirks and voice data.

-- 1. Drop the unused avatar_emoji column
ALTER TABLE agent_profiles DROP COLUMN IF EXISTS avatar_emoji;

-- 2. Set emoji_usage to 0 for all agents
UPDATE agent_profiles SET emoji_usage = 0.00;

-- 3. Clean emoji references from quirks
-- Sarah: "Uses 📊 and ⚡ as section markers in briefings"
UPDATE agent_profiles
SET quirks = array_remove(quirks, (
  SELECT unnest FROM unnest(quirks) WHERE unnest LIKE '%📊%' OR unnest LIKE '%⚡%' LIMIT 1
))
WHERE agent_id = 'chief-of-staff';

-- Platform engineer: "uses structured severity indicators (✅ ⚠️ 🔴)"
UPDATE agent_profiles
SET quirks = array_remove(quirks, (
  SELECT unnest FROM unnest(quirks) WHERE unnest LIKE '%✅%' AND unnest LIKE '%🔴%' LIMIT 1
))
WHERE agent_id = 'platform-engineer';

-- 4. Clean voice_sample for agents that had emoji section markers
UPDATE agent_profiles
SET voice_sample = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(voice_sample, '📊', '', 'g'),
      '⚡', '', 'g'),
    '📋', '', 'g'),
  '✅', '', 'g'),
'🔴', '', 'g')
WHERE voice_sample IS NOT NULL
  AND (voice_sample LIKE '%📊%' OR voice_sample LIKE '%⚡%' OR voice_sample LIKE '%📋%' OR voice_sample LIKE '%✅%' OR voice_sample LIKE '%🔴%');

-- 5. Clean voice_examples JSONB — replace common emoji patterns in the text
UPDATE agent_profiles
SET voice_examples = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(voice_examples::text, '📊', '', 'g'),
            '⚡', '', 'g'),
          '📋', '', 'g'),
        '✅', '', 'g'),
      '🔴', '', 'g'),
    '⚠️', '[!]', 'g'),
  '🔧', '', 'g'),
'⏸', '', 'g')::jsonb
WHERE voice_examples IS NOT NULL;
