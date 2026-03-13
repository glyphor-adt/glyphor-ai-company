/**
 * M365 Admin (Riley Morgan) — Tool Definitions
 *
 * Tools for: Teams channel management, user lookup, email sending,
 * calendar management, and Microsoft 365 tenant administration.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { GraphTeamsClient, GraphCalendarClient, getM365Token, type M365Operation } from '@glyphor/integrations';

function getTeamsClient(): GraphTeamsClient {
  return GraphTeamsClient.fromEnv();
}

/** Get a Graph token routed through the M365 credential router for the correct operation scope. */
async function graphToken(operation: M365Operation = 'read_directory'): Promise<string> {
  return getM365Token(operation);
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
          const token = await graphToken('read_directory');
          const filter = params.filter as string | undefined;

          const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

          let url: string;
          if (filter) {
            // $search requires ConsistencyLevel header (not query param)
            headers['ConsistencyLevel'] = 'eventual';
            url = `https://graph.microsoft.com/v1.0/users?$search="displayName:${filter}"&$select=id,displayName,mail,jobTitle,accountEnabled`;
          } else {
            url = `https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,jobTitle,accountEnabled&$top=50&$orderby=displayName`;
          }

          const res = await fetch(url, { headers });
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          if (!data.value?.length) {
            return {
              success: false,
              error: filter
                ? `No users matched search "${filter}". Try a different search term or omit filter to list all users.`
                : 'Graph API returned 0 users. This likely means the app registration lacks User.Read.All permission or admin consent has not been granted.',
            };
          }
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
          const token = await graphToken('read_directory');
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
          const token = await graphToken('post_to_channel');
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
          const token = await graphToken('post_to_channel');
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
          const token = await graphToken('manage_groups');
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
          const token = await graphToken('manage_groups');
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
          // Use Graph API to post to channel (ChannelMessage.Send permission)
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

    // ── EMAIL (moved to shared/emailTools.ts — per-agent mailboxes) ──

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
          const token = await graphToken('read_directory');
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

    // ── SELF-DIAGNOSTIC ─────────────────────────────────────────────

    {
      name: 'check_my_access',
      description: 'Verify what M365/Graph API permissions I actually have right now. Run this BEFORE reporting access issues.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        const results: Record<string, unknown> = {};

        // 1. Test directory read
        try {
          const token = await graphToken('read_directory');
          const res = await fetch('https://graph.microsoft.com/v1.0/users?$top=1&$select=id', {
            headers: { Authorization: `Bearer ${token}` },
          });
          results.directory_read = res.ok
            ? { status: 'ok', detail: 'Can read directory users' }
            : { status: 'denied', detail: `${res.status}: ${await res.text()}` };
        } catch (err) {
          results.directory_read = { status: 'error', detail: (err as Error).message };
        }

        // 2. Test groups read
        try {
          const token = await graphToken('list_groups');
          const res = await fetch('https://graph.microsoft.com/v1.0/groups?$top=1&$select=id', {
            headers: { Authorization: `Bearer ${token}` },
          });
          results.groups_read = res.ok
            ? { status: 'ok', detail: 'Can list groups' }
            : { status: 'denied', detail: `${res.status}: ${await res.text()}` };
        } catch (err) {
          results.groups_read = { status: 'error', detail: (err as Error).message };
        }

        // 3. Test Teams channels
        try {
          const token = await graphToken('post_to_channel');
          const teamId = process.env.TEAMS_TEAM_ID;
          if (!teamId) {
            results.teams_channels = { status: 'skipped', detail: 'TEAMS_TEAM_ID not set' };
          } else {
            const res = await fetch(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels?$top=1&$select=id`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            results.teams_channels = res.ok
              ? { status: 'ok', detail: 'Can read Teams channels' }
              : { status: 'denied', detail: `${res.status}: ${await res.text()}` };
          }
        } catch (err) {
          results.teams_channels = { status: 'error', detail: (err as Error).message };
        }

        // 4. Test mail
        try {
          const token = await graphToken('agent365_mail_send');
          const res = await fetch('https://graph.microsoft.com/v1.0/users?$top=1&$select=id', {
            headers: { Authorization: `Bearer ${token}` },
          });
          results.mail_token = res.ok
            ? { status: 'ok', detail: 'Mail token acquired successfully' }
            : { status: 'degraded', detail: `Token works but limited: ${res.status}` };
        } catch (err) {
          results.mail_token = { status: 'error', detail: (err as Error).message };
        }

        const allOk = Object.values(results).every((r) => {
          const s = (r as { status: string }).status;
          return s === 'ok' || s === 'skipped';
        });

        return {
          success: true,
          data: {
            overallStatus: allOk ? 'ALL_ACCESS_OK' : 'PARTIAL_ACCESS',
            checks: results,
            checkedAt: new Date().toISOString(),
            note: allOk ? 'All access checks passed.' : 'Some checks failed — see details above.',
          },
        };
      },
    },

    // ── M365 ADMIN — LICENSE VISIBILITY ───────────────────────────

    {
      name: 'list_licenses',
      description: 'List all M365/Entra license subscriptions and usage counts — shows which licenses are available and how many are consumed.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const token = await graphToken('manage_licenses');
          const res = await fetch('https://graph.microsoft.com/v1.0/subscribedSkus?$select=skuPartNumber,skuId,prepaidUnits,consumedUnits,appliesTo', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: Array<{ skuPartNumber: string; skuId: string; prepaidUnits: { enabled: number }; consumedUnits: number; appliesTo: string }> };
          const licenses = (data.value || []).map(l => ({
            name: l.skuPartNumber,
            skuId: l.skuId,
            total: l.prepaidUnits?.enabled ?? 0,
            consumed: l.consumedUnits ?? 0,
            available: (l.prepaidUnits?.enabled ?? 0) - (l.consumedUnits ?? 0),
            appliesTo: l.appliesTo,
          }));
          return { success: true, data: { licenseCount: licenses.length, licenses } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── M365 ADMIN — GROUP VISIBILITY ──────────────────────────────

    {
      name: 'list_groups',
      description: 'List all Entra ID / M365 security and distribution groups.',
      parameters: {
        filter: {
          type: 'string',
          description: 'Optional search string to filter by group name',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('read_directory');
          const filter = params.filter as string | undefined;
          const url = filter
            ? `https://graph.microsoft.com/v1.0/groups?$search="displayName:${filter}"&$select=id,displayName,description,groupTypes,membershipRule&$top=50`
            : `https://graph.microsoft.com/v1.0/groups?$select=id,displayName,description,groupTypes,membershipRule&$top=50&$orderby=displayName`;
          const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
          if (filter) headers['ConsistencyLevel'] = 'eventual';
          const res = await fetch(url, { headers });
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          return { success: true, data: { count: (data.value || []).length, groups: data.value } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'list_group_members',
      description: 'List members of a specific Entra ID / M365 group.',
      parameters: {
        group_id: {
          type: 'string',
          description: 'Group ID (GUID from list_groups)',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('read_directory');
          const groupId = encodeURIComponent(params.group_id as string);
          const res = await fetch(`https://graph.microsoft.com/v1.0/groups/${groupId}/members?$select=id,displayName,mail,jobTitle`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          return { success: true, data: { count: (data.value || []).length, members: data.value } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── M365 ADMIN — APP REGISTRATION VISIBILITY ──────────────────

    {
      name: 'list_app_registrations',
      description: 'List Entra ID app registrations with their credential expiry status — essential for monitoring client secret and certificate health.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const token = await graphToken('read_directory');
          const res = await fetch('https://graph.microsoft.com/v1.0/applications?$select=id,displayName,appId,passwordCredentials,keyCredentials&$top=50', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: Array<{ id: string; displayName: string; appId: string; passwordCredentials: Array<{ endDateTime: string }>; keyCredentials: Array<{ endDateTime: string }> }> };
          const apps = (data.value || []).map(app => {
            const creds = [...(app.passwordCredentials || []), ...(app.keyCredentials || [])];
            const nearestExpiry = creds.length > 0
              ? creds.reduce((min, c) => (new Date(c.endDateTime) < new Date(min) ? c.endDateTime : min), creds[0].endDateTime)
              : null;
            return {
              name: app.displayName,
              appId: app.appId,
              credentialCount: creds.length,
              nearestExpiry,
              expiresInDays: nearestExpiry ? Math.ceil((new Date(nearestExpiry).getTime() - Date.now()) / 86400000) : null,
            };
          });
          return { success: true, data: { count: apps.length, apps } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── M365 ADMIN — SHAREPOINT SITE OVERVIEW ─────────────────────

    {
      name: 'list_sharepoint_sites',
      description: 'List SharePoint sites in the M365 tenant — shows site name, URL, and last activity.',
      parameters: {
        search: {
          type: 'string',
          description: 'Optional search term to filter sites',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('read_sharepoint');
          const search = params.search as string | undefined;
          const url = search
            ? `https://graph.microsoft.com/v1.0/sites?search=${encodeURIComponent(search)}&$select=id,displayName,webUrl,lastModifiedDateTime`
            : `https://graph.microsoft.com/v1.0/sites?search=*&$select=id,displayName,webUrl,lastModifiedDateTime`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return { success: false, error: `Graph API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: Array<{ displayName: string; webUrl: string; lastModifiedDateTime: string }> };
          return { success: true, data: { count: (data.value || []).length, sites: data.value } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_sharepoint_site_permissions',
      description: 'Get the permissions and members for a specific SharePoint site.',
      parameters: {
        site_id: {
          type: 'string',
          description: 'SharePoint site ID (from list_sharepoint_sites)',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('read_sharepoint');
          const siteId = encodeURIComponent(params.site_id as string);
          const [permsRes, membersRes] = await Promise.all([
            fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/permissions`, {
              headers: { Authorization: `Bearer ${token}` },
            }),
            fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$select=id,displayName,list&$top=20`, {
              headers: { Authorization: `Bearer ${token}` },
            }),
          ]);
          const permissions = permsRes.ok ? (await permsRes.json() as { value: unknown[] }).value : [];
          const lists = membersRes.ok ? (await membersRes.json() as { value: unknown[] }).value : [];
          return { success: true, data: { permissions, lists } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── SHAREPOINT ADMIN — SITE MANAGEMENT ────────────────────────

    {
      name: 'create_sharepoint_site',
      description:
        'Create a new SharePoint communication site. Returns the new site ID and URL.',
      parameters: {
        display_name: {
          type: 'string',
          description: 'Display name for the site (e.g., "Q2 Campaign Hub")',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Site description',
          required: false,
        },
        alias: {
          type: 'string',
          description: 'URL-safe alias for the site (lowercase, no spaces). Defaults to slugified display name.',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('manage_sharepoint' as M365Operation);
          const displayName = params.display_name as string;
          const alias = (params.alias as string) ?? displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const description = (params.description as string) ?? '';

          const res = await fetch('https://graph.microsoft.com/v1.0/sites/root/sites', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              displayName,
              description,
              name: alias,
              // Communication sites use a different API in practice (SharePoint Online REST)
              // but Graph can create team-connected group sites via groups endpoint
            }),
          });

          if (!res.ok) {
            // Fallback: create via Groups (creates a team site with document library)
            const groupRes = await fetch('https://graph.microsoft.com/v1.0/groups', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                displayName,
                description,
                mailNickname: alias,
                groupTypes: ['Unified'],
                mailEnabled: true,
                securityEnabled: false,
                visibility: 'Private',
              }),
            });
            if (!groupRes.ok) {
              return { success: false, error: `Failed to create site (${groupRes.status}): ${await groupRes.text()}` };
            }
            const group = await groupRes.json() as { id: string; displayName: string };
            // Get the associated SharePoint site
            const siteRes = await fetch(`https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(group.id)}/sites/root`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const site = siteRes.ok ? await siteRes.json() as { id: string; webUrl: string } : null;
            return {
              success: true,
              data: {
                groupId: group.id,
                siteId: site?.id ?? 'pending (may take a few seconds)',
                webUrl: site?.webUrl ?? 'pending',
                displayName,
              },
            };
          }

          const site = await res.json() as { id: string; webUrl: string; displayName: string };
          return { success: true, data: { siteId: site.id, webUrl: site.webUrl, displayName: site.displayName } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'grant_site_permission',
      description:
        'Grant a user or app access to a specific SharePoint site. ' +
        'Use this to add members, give apps read/write access, or grant owners.',
      parameters: {
        site_id: {
          type: 'string',
          description: 'SharePoint site ID (from list_sharepoint_sites)',
          required: true,
        },
        role: {
          type: 'string',
          description: 'Permission role: "read", "write", or "owner"',
          required: true,
        },
        user_email: {
          type: 'string',
          description: 'Email of the user to grant access to (use this OR app_id, not both)',
          required: false,
        },
        app_id: {
          type: 'string',
          description: 'App registration client ID to grant access to (use this OR user_email)',
          required: false,
        },
        app_display_name: {
          type: 'string',
          description: 'Display name of the app (required if using app_id)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('manage_sharepoint' as M365Operation);
          const siteId = encodeURIComponent(params.site_id as string);
          const role = params.role as string;

          const roleMap: Record<string, string[]> = {
            read: ['read'],
            write: ['write'],
            owner: ['owner'],
          };
          if (!roleMap[role]) {
            return { success: false, error: `Invalid role "${role}". Use "read", "write", or "owner".` };
          }

          const userEmail = params.user_email as string | undefined;
          const appId = params.app_id as string | undefined;

          if (!userEmail && !appId) {
            return { success: false, error: 'Provide either user_email or app_id.' };
          }

          let body: Record<string, unknown>;
          if (appId) {
            body = {
              roles: roleMap[role],
              grantedToIdentities: [{
                application: {
                  id: appId,
                  displayName: (params.app_display_name as string) ?? appId,
                },
              }],
            };
          } else {
            // Resolve user ID from email
            const userRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail!)}?$select=id,displayName`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!userRes.ok) return { success: false, error: `User not found: ${userEmail}` };
            const user = await userRes.json() as { id: string; displayName: string };

            body = {
              roles: roleMap[role],
              grantedToIdentitiesV2: [{
                user: {
                  id: user.id,
                  displayName: user.displayName,
                },
              }],
            };
          }

          const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/permissions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            return { success: false, error: `Failed to grant permission (${res.status}): ${await res.text()}` };
          }
          const result = await res.json();
          return { success: true, data: { permission: result, granted: role, to: userEmail ?? appId } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'revoke_site_permission',
      description: 'Remove a specific permission from a SharePoint site.',
      parameters: {
        site_id: {
          type: 'string',
          description: 'SharePoint site ID',
          required: true,
        },
        permission_id: {
          type: 'string',
          description: 'Permission ID to revoke (from get_sharepoint_site_permissions)',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('manage_sharepoint' as M365Operation);
          const siteId = encodeURIComponent(params.site_id as string);
          const permId = encodeURIComponent(params.permission_id as string);

          const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/permissions/${permId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });

          if (!res.ok) {
            return { success: false, error: `Failed to revoke permission (${res.status}): ${await res.text()}` };
          }
          return { success: true, data: `Permission ${params.permission_id} revoked from site.` };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'create_sharepoint_list',
      description:
        'Create a new list or document library on a SharePoint site. ' +
        'Use "genericList" for a data list or "documentLibrary" for a file library.',
      parameters: {
        site_id: {
          type: 'string',
          description: 'SharePoint site ID (from list_sharepoint_sites)',
          required: true,
        },
        display_name: {
          type: 'string',
          description: 'Display name of the list (e.g., "Project Tasks")',
          required: true,
        },
        template: {
          type: 'string',
          description: 'List template: "genericList" (data list) or "documentLibrary" (file storage). Default: genericList.',
          required: false,
        },
        columns: {
          type: 'array',
          description: 'Optional array of column definitions: [{name: "Status", type: "text"}, {name: "Priority", type: "choice", choices: ["High","Medium","Low"]}]. Supported types: text, number, boolean, dateTime, choice.',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('manage_sharepoint' as M365Operation);
          const siteId = encodeURIComponent(params.site_id as string);
          const displayName = params.display_name as string;
          const template = (params.template as string) ?? 'genericList';

          // Create the list
          const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              displayName,
              list: { template },
            }),
          });

          if (!res.ok) {
            return { success: false, error: `Failed to create list (${res.status}): ${await res.text()}` };
          }

          const list = await res.json() as { id: string; displayName: string; webUrl: string };

          // Add custom columns if provided
          const columns = params.columns as Array<{ name: string; type: string; choices?: string[] }> | undefined;
          const columnResults: string[] = [];

          if (columns?.length) {
            for (const col of columns) {
              const colDef: Record<string, unknown> = {
                name: col.name,
                displayName: col.name,
              };

              switch (col.type) {
                case 'text': colDef.text = {}; break;
                case 'number': colDef.number = {}; break;
                case 'boolean': colDef.boolean = {}; break;
                case 'dateTime': colDef.dateTime = {}; break;
                case 'choice': colDef.choice = { choices: col.choices ?? [] }; break;
                default: colDef.text = {}; break;
              }

              const colRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${encodeURIComponent(list.id)}/columns`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(colDef),
              });

              columnResults.push(colRes.ok ? `✓ ${col.name}` : `✗ ${col.name} (${colRes.status})`);
            }
          }

          return {
            success: true,
            data: {
              listId: list.id,
              displayName: list.displayName,
              webUrl: list.webUrl,
              ...(columnResults.length > 0 && { columns: columnResults }),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'update_site_settings',
      description:
        'Update SharePoint site settings — display name or description.',
      parameters: {
        site_id: {
          type: 'string',
          description: 'SharePoint site ID (from list_sharepoint_sites)',
          required: true,
        },
        display_name: {
          type: 'string',
          description: 'New display name for the site',
          required: false,
        },
        description: {
          type: 'string',
          description: 'New description for the site',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('manage_sharepoint' as M365Operation);
          const siteId = encodeURIComponent(params.site_id as string);

          const updates: Record<string, string> = {};
          if (params.display_name) updates.displayName = params.display_name as string;
          if (params.description) updates.description = params.description as string;

          if (Object.keys(updates).length === 0) {
            return { success: false, error: 'Provide at least one setting to update (display_name or description).' };
          }

          const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updates),
          });

          if (!res.ok) {
            return { success: false, error: `Failed to update site (${res.status}): ${await res.text()}` };
          }

          const site = await res.json() as { id: string; displayName: string; description: string; webUrl: string };
          return {
            success: true,
            data: { siteId: site.id, displayName: site.displayName, description: site.description, webUrl: site.webUrl },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'delete_sharepoint_list',
      description: 'Delete a list or document library from a SharePoint site.',
      parameters: {
        site_id: {
          type: 'string',
          description: 'SharePoint site ID',
          required: true,
        },
        list_id: {
          type: 'string',
          description: 'List ID to delete (from get_sharepoint_site_permissions which shows lists)',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const token = await graphToken('manage_sharepoint' as M365Operation);
          const siteId = encodeURIComponent(params.site_id as string);
          const listId = encodeURIComponent(params.list_id as string);

          const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });

          if (!res.ok) {
            return { success: false, error: `Failed to delete list (${res.status}): ${await res.text()}` };
          }
          return { success: true, data: `List ${params.list_id} deleted.` };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
