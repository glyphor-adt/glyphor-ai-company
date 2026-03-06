/**
 * Chat Subscription Manager — Graph Change Notification subscriptions for chat
 *
 * Creates and manages a single subscription on /chats/getAllMessages
 * to receive real-time notifications when anyone messages an agent
 * user account in Teams.
 *
 * Chat subscriptions expire after a maximum of 1 hour (60 minutes)
 * in Graph API, so we auto-renew on a timer.
 *
 * Required Entra ID permissions (Application):
 *   - Chat.ReadWrite.All
 *
 * References:
 *   https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions
 */

import { GraphChatHandler } from './graphChatHandler.js';

// ─── TYPES ──────────────────────────────────────────────────────

export interface ChatSubscription {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState?: string;
}

// ─── SUBSCRIPTION MANAGER ───────────────────────────────────────

/**
 * Max chat subscription lifetime: 60 minutes for /chats/getAllMessages
 * We use 55 minutes to be safe.
 */
const SUBSCRIPTION_LIFETIME_MS = 55 * 60 * 1000;

/** Renew 10 minutes before expiry */
const RENEWAL_BUFFER_MS = 10 * 60 * 1000;

/** Auto-renewal interval: check every 5 minutes */
const RENEWAL_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export class ChatSubscriptionManager {
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private subscription: ChatSubscription | null = null;
  private renewalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: {
      appId: string;
      appSecret: string;
      tenantId: string;
    },
    /** Full HTTPS URL where Graph will POST change notifications */
    private readonly notificationUrl: string,
  ) {}

  /**
   * Create the /chats/getAllMessages subscription.
   * Graph will validate the webhook URL before accepting.
   */
  async subscribe(): Promise<ChatSubscription | null> {
    // If we already have an active subscription, check if it needs renewal
    if (this.subscription) {
      const expiresAt = new Date(this.subscription.expirationDateTime).getTime();
      if (expiresAt > Date.now() + RENEWAL_BUFFER_MS) {
        console.log('[ChatSub] Active subscription exists, not expired');
        return this.subscription;
      }
      // Expiring soon — delete and re-create
      await this.unsubscribe();
    }

    const token = await this.getGraphToken();
    const expirationDateTime = new Date(
      Date.now() + SUBSCRIPTION_LIFETIME_MS,
    ).toISOString();

    const payload = {
      changeType: 'created',
      notificationUrl: this.notificationUrl,
      resource: '/chats/getAllMessages',
      expirationDateTime,
      clientState: GraphChatHandler.CLIENT_STATE,
      includeResourceData: false,
    };

    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(
          `[ChatSub] Failed to create subscription: ${res.status} ${text.substring(0, 500)}`,
        );
        return null;
      }

      const data = (await res.json()) as ChatSubscription;
      this.subscription = data;

      console.log(
        `[ChatSub] Subscription created: ${data.id} → expires ${data.expirationDateTime}`,
      );
      return data;
    } catch (err) {
      console.error(
        `[ChatSub] Error creating subscription: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Delete the current subscription.
   */
  async unsubscribe(): Promise<void> {
    if (!this.subscription) return;

    try {
      const token = await this.getGraphToken();
      await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(this.subscription.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      console.log(`[ChatSub] Deleted subscription: ${this.subscription.id}`);
    } catch {
      // Best effort — subscription may already be expired
    }

    this.subscription = null;
  }

  /**
   * Renew the subscription if it's expiring soon.
   */
  async renewIfNeeded(): Promise<boolean> {
    if (!this.subscription) {
      // No subscription — create a new one
      const sub = await this.subscribe();
      return sub !== null;
    }

    const expiresAt = new Date(this.subscription.expirationDateTime).getTime();
    if (expiresAt > Date.now() + RENEWAL_BUFFER_MS) {
      return true; // Still valid
    }

    const token = await this.getGraphToken();
    const newExpiration = new Date(
      Date.now() + SUBSCRIPTION_LIFETIME_MS,
    ).toISOString();

    try {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(this.subscription.id)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expirationDateTime: newExpiration }),
        },
      );

      if (res.ok) {
        this.subscription.expirationDateTime = newExpiration;
        console.log(`[ChatSub] Renewed subscription → expires ${newExpiration}`);
        return true;
      }

      // Renewal failed — re-create
      console.warn(`[ChatSub] Renewal failed (${res.status}), re-creating`);
      this.subscription = null;
      const sub = await this.subscribe();
      return sub !== null;
    } catch (err) {
      console.error(`[ChatSub] Renewal error: ${(err as Error).message}`);
      // Try re-creating
      this.subscription = null;
      const sub = await this.subscribe();
      return sub !== null;
    }
  }

  /**
   * Start auto-renewal timer. Checks every 5 minutes and renews if needed.
   */
  startAutoRenewal(): void {
    if (this.renewalTimer) return;

    this.renewalTimer = setInterval(() => {
      this.renewIfNeeded().catch((err) =>
        console.error('[ChatSub] Auto-renewal error:', err),
      );
    }, RENEWAL_CHECK_INTERVAL_MS);

    console.log('[ChatSub] Auto-renewal started (every 5 minutes)');
  }

  /**
   * Stop auto-renewal timer.
   */
  stopAutoRenewal(): void {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }
  }

  /**
   * Get current subscription status (for health/debug).
   */
  getStatus(): {
    active: boolean;
    subscriptionId?: string;
    expiresAt?: string;
    expiresInMs?: number;
  } {
    if (!this.subscription) return { active: false };

    const expiresAt = new Date(this.subscription.expirationDateTime).getTime();
    return {
      active: expiresAt > Date.now(),
      subscriptionId: this.subscription.id,
      expiresAt: this.subscription.expirationDateTime,
      expiresInMs: expiresAt - Date.now(),
    };
  }

  // ─── Token management ──────────────────────────────────────

  private async getGraphToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Graph token failed: ${res.status} ${errBody}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokenCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  }
}
