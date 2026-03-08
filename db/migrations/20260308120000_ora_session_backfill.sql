-- Backfill Ora chat messages that were written before the client started
-- preserving the created ora_sessions row returned by the API.

WITH session_windows AS (
  SELECT
    id,
    user_id,
    created_at,
    LEAD(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS next_created_at
  FROM ora_sessions
),
matched_messages AS (
  SELECT
    m.id,
    w.id AS session_id
  FROM chat_messages m
  JOIN session_windows w
    ON w.user_id = m.user_id
   AND m.agent_role = 'ora'
   AND m.session_id IS NULL
   AND m.created_at >= w.created_at
   AND (w.next_created_at IS NULL OR m.created_at < w.next_created_at)
)
UPDATE chat_messages m
SET session_id = matched_messages.session_id
FROM matched_messages
WHERE m.id = matched_messages.id;

WITH session_activity AS (
  SELECT
    session_id,
    MAX(created_at) AS last_message_at
  FROM chat_messages
  WHERE agent_role = 'ora'
    AND session_id IS NOT NULL
  GROUP BY session_id
)
UPDATE ora_sessions s
SET updated_at = GREATEST(s.updated_at, session_activity.last_message_at)
FROM session_activity
WHERE s.id = session_activity.session_id;