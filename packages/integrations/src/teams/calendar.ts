/**
 * Calendar — create events via Microsoft Graph API
 *
 * Creates calendar invitations on founder calendars using
 * client credentials (app-only) auth.
 *
 * Required Entra ID permission (Application): Calendars.ReadWrite
 *
 * Governance:
 *   YELLOW — all executive agents (requires founder approval)
 *   BLOCKED — sub-team agents
 */

import type { GraphTeamsClient } from './graphClient.js';

// ─── TYPES ──────────────────────────────────────────────────────

export interface CalendarAttendee {
  email: string;
  name?: string;
  /** required | optional (default: required) */
  type?: 'required' | 'optional';
}

export interface CreateEventOptions {
  /** Entra Object ID of the calendar owner */
  userId: string;
  subject: string;
  /** HTML body / description for the event */
  body?: string;
  /** ISO 8601 datetime (e.g. "2025-06-20T10:00:00") — local to timeZone */
  start: string;
  /** ISO 8601 datetime */
  end: string;
  /** IANA time zone (default: "America/Chicago") */
  timeZone?: string;
  attendees?: CalendarAttendee[];
  /** Physical or virtual location */
  location?: string;
  /** If true, create as online meeting with Teams link (default: false) */
  isOnlineMeeting?: boolean;
  /** Show as: free | tentative | busy | oof | workingElsewhere (default: busy) */
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere';
}

export interface CreatedEvent {
  id: string;
  webLink: string;
  onlineMeetingUrl?: string;
}

// ─── CALENDAR CLIENT ────────────────────────────────────────────

export class GraphCalendarClient {
  constructor(private readonly graphClient: GraphTeamsClient) {}

  static fromEnv(graphClient: GraphTeamsClient): GraphCalendarClient {
    return new GraphCalendarClient(graphClient);
  }

  /**
   * Create a calendar event on a user's default calendar.
   */
  async createEvent(options: CreateEventOptions): Promise<CreatedEvent> {
    const token = await (this.graphClient as unknown as { getToken(): Promise<string> }).getToken();
    const tz = options.timeZone ?? 'America/Chicago';

    const attendees = (options.attendees ?? []).map(a => ({
      emailAddress: { address: a.email, name: a.name },
      type: a.type ?? 'required',
    }));

    const payload: Record<string, unknown> = {
      subject: options.subject,
      start: { dateTime: options.start, timeZone: tz },
      end: { dateTime: options.end, timeZone: tz },
      showAs: options.showAs ?? 'busy',
      ...(options.body && {
        body: { contentType: 'HTML', content: options.body },
      }),
      ...(attendees.length > 0 && { attendees }),
      ...(options.location && {
        location: { displayName: options.location },
      }),
      ...(options.isOnlineMeeting && {
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness',
      }),
    };

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(options.userId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create calendar event (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      id: string;
      webLink: string;
      onlineMeeting?: { joinUrl: string };
    };

    return {
      id: data.id,
      webLink: data.webLink,
      onlineMeetingUrl: data.onlineMeeting?.joinUrl,
    };
  }
}
