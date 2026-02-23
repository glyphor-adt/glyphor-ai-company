/**
 * M365 Admin (Riley Morgan) — Tool Definitions
 *
 * Tools for: Teams channel management, user lookup, email sending,
 * calendar management, and Microsoft 365 tenant administration.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { GraphTeamsClient, GraphEmailClient, GraphCalendarClient, TeamsBotHandler } from '@glyphor/integrations';

function getTeamsClient(): GraphTeamsClient {
  return GraphTeamsClient.fromEnv();
}

/** Shared token fetch helper */
async function graphToken(): Promise<string> {
  return getTeamsClient().getAccessToken();
}

const TEAM_ID = process.env.TEAMS_TEAM_ID ?? '';

export function createM365AdminTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [

    // ── USER MANAGEMENT ─────────────────────────────────────────────

    {
      name: 'list_users',
      description: 'List all users in the Microsoft 365 tenant — name, email, job title, account status.',
      parameters: {
        filter: {
          type: 'string',
          description: 'Optional search string to filter by display name or email',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const token = await graphToken();
          const filter = params.filter as string | undefined;
          const url = filter
            ? `https://graph.microsoft.com/v1.0/users?$search="displayName:${filter}"&$select=id,displayName,mail,jobTitle,accountEnabled&ConsistencyLevel=eventual`
            : `https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,jobTitle,accountEnabled&$top=50&$orderby=displayName`;

          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          if (!data.value?.length) return { success: true, data: { count: 0, users: [], note: 'No users found' } };
          return { success: true, data: { count: data.value.length, users: data.value } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_user',
      description: 'Look up a specific M365 user by email — returns profile and group memberships.',
      parameters: {
        email: {
          type: 'string',
          description: 'User email address',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const token = await graphToken();
          const email = encodeURIComponent(params.email as string);
          const [userRes, groupsRes] = await Promise.all([
            fetch(`https://graph.microsoft.com/v1.0/users/${email}?$select=id,displayName,mail,jobTitle,accountEnabled,createdDateTime`, { headers: { Authorization: `Bearer ${token}` } }),
            fetch(`https://graph.microsoft.com/v1.0/users/${email}/memberOf?$select=displayName,description,groupTypes`, { headers: { Authorization: `Bearer ${token}` } }),
          ]);
          if (!userRes.ok) return { success: false, error: `User not found: ${params.email} (${userRes.status})` };
          const user = await userRes.json();
          const groups = groupsRes.ok ? (await groupsRes.json() as { value: unknown[] }).value : [];
          return { success: true, data: { user, groups } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── TEAMS CHANNEL MANAGEMENT ────────────────────────────────────

    {
      name: 'list_channels',
      description: 'List all channels in the Glyphor Teams workspace.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const token = await graphToken();
          const res = await fetch(
            `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels?$select=id,displayName,description,membershipType,webUrl`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          return { success: true, data: { channelCount: data.value.length, channels: data.value } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'list_channel_members',
      description: 'List all members of a specific Teams channel.',
      parameters: {
        channel_id: {
          type: 'string',
          description: 'Teams channel ID (from TEAMS_CHANNEL_* env values)',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const token = await graphToken();
          const res = await fetch(
            `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${params.channel_id}/members`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          return { success: true, data: { memberCount: data.value.length, members: data.value } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'add_channel_member',
      description: 'Add a user to a Teams channel by their email address.',
      parameters: {
        channel_id: {
          type: 'string',
          description: 'Teams channel ID',
          required: true,
        },
        user_email: {
          type: 'string',
          description: 'Email address of the user to add',
          required: true,
        },
        role: {
          type: 'string',
          description: 'Channel role: "member" or "owner" (default: member)',
          required: false,
          enum: ['member', 'owner'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const token = await graphToken();
          const userRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(params.user_email as string)}?$select=id,displayName`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!userRes.ok) return { success: false, error: `User not found: ${params.user_email}` };
          const user = await userRes.json() as { id: string; displayName: string };

          const body = {
            '@odata.type': '#microsoft.graph.aadUserConversationMember',
            roles: (params.role as string) === 'owner' ? ['owner'] : [],
            'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${user.id}')`,
          };
          const addRes = await fetch(
            `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${params.channel_id}/members`,
            { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          );
          if (addRes.status === 409) return { success: true, data: { note: `${user.displayName} is already a member` } };
          if (!addRes.ok) return { success: false, error: `Failed to add member: ${await addRes.text()}` };
          return { success: true, data: { added: user.displayName, role: params.role || 'member', channelId: params.channel_id } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'create_channel',
      description: 'Create a new Teams channel in the Glyphor workspace.',
      parameters: {
        name: { type: 'string', description: 'Channel name', required: true },
        description: { type: 'string', description: 'Channel description', required: false },
        membership_type: {
          type: 'string',
          description: '"standard" (visible to all) or "private" (invite only)',
          required: false,
          enum: ['standard', 'private'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const token = await graphToken();
          const body = {
            displayName: params.name,
            description: (params.description as string) ?? '',
            membershipType: (params.membership_type as string) || 'standard',
          };
          const res = await fetch(
            `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels`,
            { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          );
          if (!res.ok) return { success: false, error: `Failed to create channel: ${await res.text()}` };
          const channel = await res.json() as { id: string; displayName: string; webUrl: string };
          return { success: true, data: { channelId: channel.id, name: channel.displayName, url: channel.webUrl } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'post_to_channel',
      description: 'Post a message to a Teams channel proactively (no @mention required). The bot must be installed in the team.',
      parameters: {
        channel_id: { type: 'string', description: 'Teams channel ID (use list_channels to find IDs)', required: true },
        message: { type: 'string', description: 'Message content (plain text or markdown)', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          // Prefer Bot Framework proactive post (rich, proper bot identity)
          const bot = TeamsBotHandler.fromEnv(() => Promise.resolve(undefined));
          if (bot) {
            // Find Riley's app ID in AGENT_BOTS
            let rileyAppId: string | undefined;
            if (process.env.AGENT_BOTS) {
              const bots = JSON.parse(process.env.AGENT_BOTS) as Array<{ role: string; appId: string }>;
              rileyAppId = bots.find((b) => b.role === 'm365-admin')?.appId;
            }
            await bot.sendProactiveToChannel(
              TEAM_ID,
              params.channel_id as string,
              params.message as string,
              rileyAppId,
            );
            return { success: true, data: { posted: true, channelId: params.channel_id, method: 'bot-framework' } };
          }

          // Fallback: use Graph API sendText (Teamwork.Migrate.All)
          const teamsClient = getTeamsClient();
          await teamsClient.sendText(
            { teamId: TEAM_ID, channelId: params.channel_id as string },
            params.message as string,
          );
          return { success: true, data: { posted: true, channelId: params.channel_id, method: 'graph-api' } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── EMAIL ────────────────────────────────────────────────────────

    {
      name: 'send_email',
      description: 'Send an email via Microsoft Outlook/Graph API. Requires GLYPHOR_MAIL_SENDER_ID to be set.',
      parameters: {
        to: { type: 'string', description: 'Recipient email(s), comma-separated', required: true },
        subject: { type: 'string', description: 'Email subject', required: true },
        body_html: { type: 'string', description: 'HTML email body', required: true },
        cc: { type: 'string', description: 'CC recipients, comma-separated', required: false },
        importance: { type: 'string', description: 'low, normal, or high', required: false, enum: ['low', 'normal', 'high'] },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const teamsClient = getTeamsClient();
          const emailClient = GraphEmailClient.fromEnv(teamsClient);
          if (!emailClient) {
            return { success: false, error: 'NO_DATA: GLYPHOR_MAIL_SENDER_ID not configured — add the sender mailbox object ID to GCP secrets.' };
          }
          const toList = (params.to as string).split(',').map((e) => ({ email: e.trim() }));
          const ccList = params.cc ? (params.cc as string).split(',').map((e) => ({ email: e.trim() })) : undefined;
          await emailClient.sendEmail({
            to: toList,
            cc: ccList,
            subject: params.subject as string,
            body: params.body_html as string,
            importance: (params.importance as 'low' | 'normal' | 'high') || 'normal',
          });
          return { success: true, data: { sent: true, to: params.to, subject: params.subject } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── CALENDAR ─────────────────────────────────────────────────────

    {
      name: 'create_calendar_event',
      description: 'Create a calendar event on a user\'s calendar. Requires the user\'s Entra Object ID.',
      parameters: {
        user_id: { type: 'string', description: 'Entra Object ID of the calendar owner', required: true },
        title: { type: 'string', description: 'Event title', required: true },
        start: { type: 'string', description: 'Start datetime ISO 8601 e.g. "2026-02-24T14:00:00"', required: true },
        end: { type: 'string', description: 'End datetime ISO 8601', required: true },
        attendees: { type: 'string', description: 'Comma-separated attendee emails', required: false },
        description: { type: 'string', description: 'Event description / agenda', required: false },
        location: { type: 'string', description: 'Location or Teams link', required: false },
        is_online: { type: 'boolean', description: 'Create as Teams online meeting (default: true)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const teamsClient = getTeamsClient();
          const calClient = GraphCalendarClient.fromEnv(teamsClient);
          const attendeeList = params.attendees
            ? (params.attendees as string).split(',').map((e) => ({ email: e.trim() }))
            : [];

          const event = await calClient.createEvent({
            userId: params.user_id as string,
            subject: params.title as string,
            start: params.start as string,
            end: params.end as string,
            body: params.description as string | undefined,
            location: params.location as string | undefined,
            attendees: attendeeList,
            isOnlineMeeting: (params.is_online as boolean) !== false,
          });
          return { success: true, data: event };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'list_calendar_events',
      description: 'List upcoming calendar events for a user.',
      parameters: {
        user_id: { type: 'string', description: 'Entra Object ID of the user (use get_user to find it)', required: true },
        days: { type: 'number', description: 'Days to look ahead (default: 7)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const token = await graphToken();
          const days = (params.days as number) || 7;
          const start = new Date().toISOString();
          const end = new Date(Date.now() + days * 86_400_000).toISOString();
          const url = `https://graph.microsoft.com/v1.0/users/${params.user_id}/calendarView?startDateTime=${start}&endDateTime=${end}&$select=subject,start,end,location,attendees,isOnlineMeeting&$orderby=start/dateTime&$top=20`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          return { success: true, data: { count: data.value.length, events: data.value } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── AUDIT & MEMORY ───────────────────────────────────────────────

    {
      name: 'write_admin_log',
      description: 'Write an M365 admin action entry to company memory and activity feed.',
      parameters: {
        action: { type: 'string', description: 'What was done', required: true },
        category: {
          type: 'string',
          description: 'Action category',
          required: true,
          enum: ['user-provisioning', 'channel-management', 'email', 'calendar', 'audit'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: 'analysis',
          product: 'company',
          summary: `[M365] ${params.action}`,
          createdAt: new Date().toISOString(),
        });
        await memory.write(
          'm365.admin.last_action',
          { action: params.action, category: params.category, at: new Date().toISOString() },
          ctx.agentId,
        );
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'create_decision',
      description: 'Escalate an M365 action requiring founder approval (user removal, license changes, etc.).',
      parameters: {
        tier: { type: 'string', description: 'yellow or red', required: true, enum: ['yellow', 'red'] },
        title: { type: 'string', description: 'Short title', required: true },
        summary: { type: 'string', description: 'What needs to be done and why', required: true },
        reasoning: { type: 'string', description: 'Why this requires approval', required: true },
        assigned_to: {
          type: 'array',
          description: 'Founders to assign',
          required: true,
          items: { type: 'string', description: 'Founder name' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const id = await memory.createDecision({
          tier: params.tier as 'yellow' | 'red',
          status: 'pending',
          title: params.title as string,
          summary: params.summary as string,
          proposedBy: ctx.agentRole,
          reasoning: params.reasoning as string,
          assignedTo: params.assigned_to as string[],
        });
        return { success: true, data: { decisionId: id }, memoryKeysWritten: 1 };
      },
    },
  ];
}
