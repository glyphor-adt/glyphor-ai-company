/**
 * Calendar Webhook — Graph Change Notification subscriptions
 *
 * Subscribes to Microsoft Graph calendar change notifications for
 * each agent's calendar. When a meeting invite arrives (or is updated),
 * Graph pushes a notification to our webhook endpoint, enabling
 * near-real-time meeting auto-join instead of polling.
 *
 * Flow:
 *   1. createSubscription() → POST /subscriptions (Graph API)
 *   2. Graph validates the webhook via GET ?validationToken=...
 *   3. On calendar change → POST with change notification payload
 *   4. We extract the affected user and trigger a calendar check
 *
 * Required Entra ID permissions (Application):
 *   - Calendars.Read (for calendarView queries)
 *
 * References:
 *   https://learn.microsoft.com/en-us/graph/webhooks
 *   https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions
 */

// ─── TYPES ──────────────────────────────────────────────────────

export interface CalendarSubscription {
  /** Graph subscription ID */
  id: string;
  /** Agent email / userId the subscription is for */
  userEmail: string;
  /** Resource path being watched */
  resource: string;
  /** When this subscription expires (ISO 8601) */
  expirationDateTime: string;
  /** Our webhook URL */
  notificationUrl: string;
}

export interface GraphChangeNotification {
  subscriptionId: string;
  subscriptionExpirationDateTime: string;
  changeType: 'created' | 'updated' | 'deleted';
  resource: string;
  resourceData: {
    '@odata.type': string;
    '@odata.id': string;
    '@odata.etag'?: string;
    id: string;
  };
  clientState?: string;
  tenantId: string;
}

export interface GraphChangePayload {
  value: GraphChangeNotification[];
}

// ─── SUBSCRIPTION MANAGER ───────────────────────────────────────

/** Max calendar subscription lifetime in Graph: 3 days (4230 minutes) */
const MAX_SUBSCRIPTION_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

/** Renew subscriptions 6 hours before expiry */
const RENEWAL_BUFFER_MS = 6 * 60 * 60 * 1000;

/** Client state secret — included in notifications for validation */
const CLIENT_STATE_PREFIX = 'glyphor-cal-';

export class CalendarWebhookManager {
  private tokenCache: { token: string; expiresAt: number } | null = null;
  /** Active subscriptions: userEmail → subscription */
  private subscriptions = new Map<string, CalendarSubscription>();
  /** Reverse lookup: subscriptionId → userEmail */
  private subIdToEmail = new Map<string, string>();
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
   * Subscribe to calendar events for a user.
   * Returns the subscription or null if it fails (non-fatal).
   */
  async subscribe(userEmail: string): Promise<CalendarSubscription | null> {
    // Don't double-subscribe
    const existing = this.subscriptions.get(userEmail);
    if (existing) {
      const expiresAt = new Date(existing.expirationDateTime).getTime();
      if (expiresAt > Date.now() + RENEWAL_BUFFER_MS) {
        return existing;
      }
      // Expiring soon — delete and re-create
      await this.unsubscribe(userEmail);
    }

    const token = await this.getGraphToken();
    const expirationDateTime = new Date(
      Date.now() + MAX_SUBSCRIPTION_LIFETIME_MS,
    ).toISOString();

    const resource = `users/${userEmail}/events`;
    const clientState = CLIENT_STATE_PREFIX + userEmail.split('@')[0];

    const payload = {
      changeType: 'created,updated',
      notificationUrl: this.notificationUrl,
      resource,
      expirationDateTime,
      clientState,
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
        // 404 = user doesn't exist in tenant, skip silently
        if (res.status === 404) return null;
        console.warn(
          `[CalendarWebhook] Failed to subscribe ${userEmail}: ${res.status} ${text.slice(0, 200)}`,
        );
        return null;
      }

      const data = (await res.json()) as {
        id: string;
        resource: string;
        expirationDateTime: string;
      };

      const sub: CalendarSubscription = {
        id: data.id,
        userEmail,
        resource: data.resource,
        expirationDateTime: data.expirationDateTime,
        notificationUrl: this.notificationUrl,
      };

      this.subscriptions.set(userEmail, sub);
      this.subIdToEmail.set(sub.id, userEmail);

      console.log(
        `[CalendarWebhook] Subscribed: ${userEmail} → expires ${sub.expirationDateTime}`,
      );
      return sub;
    } catch (err) {
      console.warn(
        `[CalendarWebhook] Error subscribing ${userEmail}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Subscribe to calendar events for multiple users (batched).
   */
  async subscribeAll(
    agents: { email: string }[],
  ): Promise<{ subscribed: number; failed: number }> {
    let subscribed = 0;
    let failed = 0;

    // Process in batches to avoid throttling
    const BATCH_SIZE = 5;
    for (let i = 0; i < agents.length; i += BATCH_SIZE) {
      const batch = agents.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((a) => this.subscribe(a.email)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) subscribed++;
        else failed++;
      }
    }

    console.log(
      `[CalendarWebhook] Bulk subscribe: ${subscribed} active, ${failed} skipped/failed`,
    );
    return { subscribed, failed };
  }

  /**
   * Remove subscription for a user.
   */
  async unsubscribe(userEmail: string): Promise<void> {
    const sub = this.subscriptions.get(userEmail);
    if (!sub) return;

    try {
      const token = await this.getGraphToken();
      await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(sub.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
    } catch {
      // Best effort — subscription may already be expired
    }

    this.subscriptions.delete(userEmail);
    this.subIdToEmail.delete(sub.id);
  }

  /**
   * Renew subscriptions that are expiring soon.
   * Should be called periodically (e.g. every 12 hours).
   */
  async renewExpiring(): Promise<number> {
    const token = await this.getGraphToken();
    let renewed = 0;
    const newExpiration = new Date(
      Date.now() + MAX_SUBSCRIPTION_LIFETIME_MS,
    ).toISOString();

    for (const [email, sub] of this.subscriptions) {
      const expiresAt = new Date(sub.expirationDateTime).getTime();
      if (expiresAt > Date.now() + RENEWAL_BUFFER_MS) continue;

      try {
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(sub.id)}`,
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
          sub.expirationDateTime = newExpiration;
          renewed++;
        } else {
          // If renewal fails, re-create the subscription
          console.warn(`[CalendarWebhook] Renewal failed for ${email}, re-creating`);
          this.subscriptions.delete(email);
          this.subIdToEmail.delete(sub.id);
          await this.subscribe(email);
          renewed++;
        }
      } catch (err) {
        console.warn(
          `[CalendarWebhook] Error renewing ${email}: ${(err as Error).message}`,
        );
      }
    }

    if (renewed > 0) {
      console.log(`[CalendarWebhook] Renewed ${renewed} subscription(s)`);
    }
    return renewed;
  }

  /**
   * Start automatic renewal on an interval.
   */
  startAutoRenewal(intervalMs = 12 * 60 * 60 * 1000): void {
    if (this.renewalTimer) return;
    this.renewalTimer = setInterval(() => {
      this.renewExpiring().catch((err) =>
        console.error('[CalendarWebhook] Auto-renewal error:', err),
      );
    }, intervalMs);
  }

  /**
   * Stop automatic renewal.
   */
  stopAutoRenewal(): void {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }
  }

  /**
   * Process an incoming change notification from Graph.
   * Returns the affected user email, or null if the notification is invalid.
   */
  processNotification(notification: GraphChangeNotification): string | null {
    const email = this.subIdToEmail.get(notification.subscriptionId);
    if (!email) {
      console.warn(
        `[CalendarWebhook] Unknown subscription ID: ${notification.subscriptionId}`,
      );
      return null;
    }

    // Validate client state
    const expectedState = CLIENT_STATE_PREFIX + email.split('@')[0];
    if (notification.clientState && notification.clientState !== expectedState) {
      console.warn(
        `[CalendarWebhook] Client state mismatch for ${email}`,
      );
      return null;
    }

    return email;
  }

  /**
   * Get list of active subscriptions (for health/debug).
   */
  getActiveSubscriptions(): CalendarSubscription[] {
    return Array.from(this.subscriptions.values());
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
