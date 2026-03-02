/**
 * Calendar Watcher — Auto-join Teams meetings when agents are invited
 *
 * Two complementary strategies:
 *
 *   1. **Polling** (fallback) — Every 60s, queries Graph calendarView
 *      for all agents looking for meetings starting within 3 minutes.
 *
 *   2. **Webhook push** (primary) — Graph Change Notifications push
 *      to our endpoint when a calendar event is created/updated.
 *      On notification we immediately check that agent's calendar,
 *      so we never miss a just-invited meeting even between polls.
 *
 * Requires:
 *   - BOT_APP_ID / BOT_APP_SECRET / AZURE_TENANT_ID (client credentials)
 *   - Calendars.Read application permission with admin consent
 */

import { AGENT_EMAIL_MAP, type AgentEmailEntry } from '@glyphor/agent-runtime';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import type { TeamsCallHandler } from './teamsHandler.js';

/** How often to poll calendars (ms) — every 60 seconds */
const POLL_INTERVAL_MS = 60_000;

/** How far ahead to look for upcoming meetings (ms) — 3 minutes */
const LOOK_AHEAD_MS = 3 * 60_000;

/** Don't join meetings that started more than 5 minutes ago */
const LATE_JOIN_CUTOFF_MS = 5 * 60_000;

interface GraphConfig {
  appId: string;
  appSecret: string;
  tenantId: string;
}

interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isOnlineMeeting: boolean;
  onlineMeeting?: { joinUrl: string } | null;
  isCancelled: boolean;
  showAs: string;
  responseStatus?: { response: string };
}

export class CalendarWatcher {
  private graphConfig: GraphConfig;
  private teamsHandler: TeamsCallHandler;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tokenCache: { token: string; expiresAt: number } | null = null;
  /** Set of event IDs that have already been joined (prevents duplicates) */
  private joinedEvents = new Set<string>();
  /** Agents to watch — derived from AGENT_EMAIL_MAP */
  private agents: { role: CompanyAgentRole; email: string; displayName: string }[];

  constructor(graphConfig: GraphConfig, teamsHandler: TeamsCallHandler) {
    this.graphConfig = graphConfig;
    this.teamsHandler = teamsHandler;
    this.agents = (Object.entries(AGENT_EMAIL_MAP) as [CompanyAgentRole, AgentEmailEntry][]).map(
      ([role, entry]) => ({ role, email: entry.email, displayName: entry.displayName }),
    );
  }

  /**
   * Get the list of agents this watcher monitors.
   * Used by the webhook manager to create subscriptions.
   */
  getWatchedAgents(): { role: CompanyAgentRole; email: string; displayName: string }[] {
    return [...this.agents];
  }

  /**
   * Start polling calendars on an interval.
   */
  start(): void {
    if (this.timer) return;
    console.log(`[CalendarWatcher] Started — polling ${this.agents.length} agent calendars every ${POLL_INTERVAL_MS / 1000}s`);
    // First poll immediately, then on interval
    this.poll().catch((err) => console.error('[CalendarWatcher] Initial poll error:', err));
    this.timer = setInterval(() => {
      this.poll().catch((err) => console.error('[CalendarWatcher] Poll error:', err));
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[CalendarWatcher] Stopped');
    }
  }

  /**
   * Webhook-triggered immediate check for a specific agent.
   * Called when Graph pushes a calendar change notification.
   * Uses a wider look-ahead window (15 min) since the meeting
   * may have just been created and starts soon.
   */
  async checkAgentNow(agentEmail: string): Promise<void> {
    const agent = this.agents.find((a) => a.email === agentEmail);
    if (!agent) {
      console.warn(`[CalendarWatcher] Webhook for unknown agent email: ${agentEmail}`);
      return;
    }

    let token: string;
    try {
      token = await this.getGraphToken();
    } catch (err) {
      console.error('[CalendarWatcher] Failed to get Graph token for webhook check:', err);
      return;
    }

    const now = Date.now();
    // Wider window for webhook-triggered checks: look 15 min ahead
    const webhookLookAhead = 15 * 60_000;
    const windowStart = new Date(now - LATE_JOIN_CUTOFF_MS).toISOString();
    const windowEnd = new Date(now + webhookLookAhead).toISOString();

    console.log(`[CalendarWatcher] Webhook-triggered check for ${agent.displayName}`);
    await this.checkAgentCalendar(token, agent, windowStart, windowEnd, now);
  }

  /**
   * One poll cycle: check all agent calendars for meetings starting soon.
   */
  private async poll(): Promise<void> {
    const now = Date.now();
    // Clean up old joined events (older than 24h)
    for (const id of this.joinedEvents) {
      // Simple cleanup — just cap the set size
      if (this.joinedEvents.size > 500) {
        this.joinedEvents.clear();
        break;
      }
    }

    let token: string;
    try {
      token = await this.getGraphToken();
    } catch (err) {
      console.error('[CalendarWatcher] Failed to get Graph token:', err);
      return;
    }

    // Query window: from (now - LATE_JOIN_CUTOFF) to (now + LOOK_AHEAD)
    const windowStart = new Date(now - LATE_JOIN_CUTOFF_MS).toISOString();
    const windowEnd = new Date(now + LOOK_AHEAD_MS).toISOString();

    // Process agents in batches to avoid overwhelming Graph API
    const BATCH_SIZE = 5;
    for (let i = 0; i < this.agents.length; i += BATCH_SIZE) {
      const batch = this.agents.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((agent) => this.checkAgentCalendar(token, agent, windowStart, windowEnd, now)),
      );
    }
  }

  /**
   * Check a single agent's calendar for upcoming Teams meetings.
   */
  private async checkAgentCalendar(
    token: string,
    agent: { role: CompanyAgentRole; email: string; displayName: string },
    windowStart: string,
    windowEnd: string,
    now: number,
  ): Promise<void> {
    const encodedEmail = encodeURIComponent(agent.email);
    const url =
      `https://graph.microsoft.com/v1.0/users/${encodedEmail}/calendarView` +
      `?startDateTime=${encodeURIComponent(windowStart)}` +
      `&endDateTime=${encodeURIComponent(windowEnd)}` +
      `&$select=id,subject,start,end,isOnlineMeeting,onlineMeeting,isCancelled,showAs,responseStatus` +
      `&$top=10`;

    let events: CalendarEvent[];
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) {
        // Mailbox/calendar not found — skip silently
        return;
      }

      if (!res.ok) {
        // Rate limit or transient error — skip this agent for now
        if (res.status !== 429) {
          console.warn(`[CalendarWatcher] Graph ${res.status} for ${agent.email}`);
        }
        return;
      }

      const data = (await res.json()) as { value: CalendarEvent[] };
      events = data.value ?? [];
    } catch {
      // Network error — skip
      return;
    }

    for (const event of events) {
      // Skip if already joined, cancelled, or declined
      if (this.joinedEvents.has(event.id)) continue;
      if (event.isCancelled) continue;
      if (event.responseStatus?.response === 'declined') continue;

      // Must be a Teams online meeting with a join URL
      if (!event.isOnlineMeeting || !event.onlineMeeting?.joinUrl) continue;

      // Check timing: meeting should be starting within LOOK_AHEAD or recently started
      const meetingStart = new Date(event.start.dateTime + 'Z').getTime();
      const timeUntilStart = meetingStart - now;

      // Join if: meeting starts within 2 minutes, or started up to 5 minutes ago
      if (timeUntilStart > 2 * 60_000) continue; // too far in the future
      if (timeUntilStart < -LATE_JOIN_CUTOFF_MS) continue; // too late

      // All checks passed — join the meeting
      this.joinedEvents.add(event.id);

      const joinUrl = event.onlineMeeting.joinUrl;
      console.log(
        `[CalendarWatcher] Auto-joining: ${agent.displayName} → "${event.subject}" (starts ${timeUntilStart > 0 ? `in ${Math.round(timeUntilStart / 1000)}s` : `${Math.round(-timeUntilStart / 1000)}s ago`})`,
      );

      try {
        const result = await this.teamsHandler.joinMeeting({
          agentRole: agent.role,
          meetingUrl: joinUrl,
          invitedBy: 'calendar-watcher',
        });
        console.log(
          `[CalendarWatcher] ${agent.displayName} joined "${event.subject}" — session ${result.sessionId}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Don't retry — keep it in joinedEvents to avoid spamming
        console.error(`[CalendarWatcher] Failed to join ${agent.displayName} to "${event.subject}": ${msg}`);
      }
    }
  }

  /**
   * Acquire a Graph token using client credentials flow.
   * Shares the same pattern as TeamsCallHandler but with its own cache.
   */
  private async getGraphToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.graphConfig.appId,
      client_secret: this.graphConfig.appSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.graphConfig.tenantId)}/oauth2/v2.0/token`,
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

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  }
}
