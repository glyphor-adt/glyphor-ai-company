/**
 * Conversation Reference Store — shared between TeamsBotHandler and BotDmSender.
 *
 * Stores conversation references from incoming Bot Framework activities so
 * proactive messages can reuse the correct user IDs and service URLs.
 *
 * Multi-tenant bots encrypt user IDs as "pairwise IDs," which means we can't
 * construct user IDs from AAD Object IDs alone. Instead, we capture the actual
 * user ID (from.id) from incoming activities and reuse it for proactive DMs.
 */

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
 * Module-level singleton store.
 * Maps userAadObjectId → ConversationReference.
 *
 * This allows both TeamsBotHandler and BotDmSender to share conversation
 * references without tight coupling.
 */
const store = new Map<string, ConversationReference>();

export function setConversationRef(
  userAadObjectId: string,
  ref: ConversationReference,
): void {
  store.set(userAadObjectId, ref);
}

export function getConversationRef(
  userAadObjectId: string,
): ConversationReference | undefined {
  return store.get(userAadObjectId);
}

export function getAllConversationRefs(): ReadonlyMap<string, ConversationReference> {
  return store;
}
