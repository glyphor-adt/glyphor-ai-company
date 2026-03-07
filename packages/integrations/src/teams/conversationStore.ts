/**
 * Conversation Reference Store — shared between TeamsBotHandler and BotDmSender.
 *
 * Stores conversation references from incoming Bot Framework activities so
 * proactive messages can reuse the correct user IDs and service URLs.
 *
 * References are persisted in PostgreSQL (conversation_references table) so
 * they survive Cloud Run restarts. The in-memory Map acts as a fast cache.
 */

import { systemQuery } from '@glyphor/shared';

export interface ConversationReference {
  /** Bot Framework service URL from the incoming activity */
  serviceUrl: string;
  /** Bot Framework conversation ID (the chat between bot and user) */
  conversationId: string;
  /** The user's Teams-internal ID (from.id) — may be a pairwise encrypted ID */
  userId: string;
  /** The bot's ID (recipient.id) for context */
  botId: string;
}

/**
 * In-memory cache. Populated from DB on startup.
 */
const store = new Map<string, ConversationReference>();
let loaded = false;

/**
 * Load all conversation references from the database into the in-memory cache.
 * Called once at startup.
 */
export async function loadConversationRefs(): Promise<number> {
  try {
    const rows = await systemQuery<{
      user_aad_id: string;
      service_url: string;
      conversation_id: string;
      user_id: string;
      bot_id: string;
    }>('SELECT user_aad_id, service_url, conversation_id, user_id, bot_id FROM conversation_references');
    for (const row of rows) {
      store.set(row.user_aad_id, {
        serviceUrl: row.service_url,
        conversationId: row.conversation_id,
        userId: row.user_id,
        botId: row.bot_id,
      });
    }
    loaded = true;
    return rows.length;
  } catch {
    // Table may not exist yet — will be created by migration
    loaded = true;
    return 0;
  }
}

export function setConversationRef(
  userAadObjectId: string,
  ref: ConversationReference,
): void {
  store.set(userAadObjectId, ref);
  // Persist to DB asynchronously (fire-and-forget)
  systemQuery(
    `INSERT INTO conversation_references (user_aad_id, service_url, conversation_id, user_id, bot_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_aad_id) DO UPDATE SET
       service_url = EXCLUDED.service_url,
       conversation_id = EXCLUDED.conversation_id,
       user_id = EXCLUDED.user_id,
       bot_id = EXCLUDED.bot_id,
       updated_at = now()`,
    [userAadObjectId, ref.serviceUrl, ref.conversationId, ref.userId, ref.botId],
  ).catch((err: unknown) => {
    console.warn('[ConvStore] DB persist failed:', (err as Error).message);
  });
}

export function getConversationRef(
  userAadObjectId: string,
): ConversationReference | undefined {
  return store.get(userAadObjectId);
}

export function getAllConversationRefs(): ReadonlyMap<string, ConversationReference> {
  return store;
}

export function isLoaded(): boolean {
  return loaded;
}
