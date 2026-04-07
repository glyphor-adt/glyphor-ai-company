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
import type { ToolContext, ToolDefinition, ToolParameter } from '@glyphor/agent-runtime';
import {
  AGENT365_CALENDAR_SERVER_NAME,
  createAgent365ConfigFromEnv,
  withAgent365Tool,
} from '../agent365/index.js';
import { logMicrosoftWriteAudit } from '../audit.js';
import { buildFounderDirectory } from './directMessages.js';

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
  agentRole?: string;
  approvalId?: string;
  approvalReference?: string;
  tenantId?: string;
  workspaceKey?: string;
  toolName?: string;
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

export type FounderCalendarMcpWrapperMode = 'agent365-mcp-proof';
export type FounderCalendarMcpTargetMode = 'user_id' | 'user_principal_name';

interface CalendarWriteGovernanceOptions {
  userId: string;
  userPrincipalName?: string;
  targetMode?: FounderCalendarMcpTargetMode;
  agentRole?: string;
  approvalId?: string;
  approvalReference?: string;
  tenantId?: string;
  workspaceKey?: string;
  toolName?: string;
}

export interface FounderCalendarMcpCreateOptions extends CreateEventOptions, CalendarWriteGovernanceOptions {
  wrapperMode: FounderCalendarMcpWrapperMode;
}

export interface FounderCalendarMcpCancelOptions extends CalendarWriteGovernanceOptions {
  wrapperMode: FounderCalendarMcpWrapperMode;
  eventId: string;
  comment?: string;
}

export interface FounderCalendarMcpDeleteOptions extends CalendarWriteGovernanceOptions {
  wrapperMode: FounderCalendarMcpWrapperMode;
  eventId: string;
}

export interface FounderCalendarMcpGetOptions extends CalendarWriteGovernanceOptions {
  wrapperMode: FounderCalendarMcpWrapperMode;
  eventId: string;
}

export interface FounderCalendarMcpResult {
  raw: unknown;
  toolName?: string;
  targetMode?: FounderCalendarMcpTargetMode;
  targetValue?: string;
  eventId?: string;
  webLink?: string;
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
    assertCalendarApprovalReference(options);
    assertAllowedCalendarOwner(options.userId);
    assertAppOnlyCalendarWriteAllowed();

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

    const resource = `users/${options.userId}/events`;

    try {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/${resource}`,
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
        await auditCalendarWrite({
          agentRole: options.agentRole ?? 'system',
          action: 'calendar.create_event',
          resource,
          identityType: 'app-only-graph',
          tenantId: options.tenantId,
          workspaceKey: options.workspaceKey ?? 'glyphor-internal',
          approvalId: options.approvalId,
          toolName: options.toolName ?? 'create_calendar_event',
          outcome: 'failure',
          fallbackUsed: true,
          targetType: 'calendar',
          targetId: options.userId,
          approvalReference: options.approvalReference,
          limitation: 'founder-calendar-write-still-app-only',
          responseCode: response.status,
          responseSummary: text.slice(0, 500),
        });
        throw new Error(`Failed to create calendar event (${response.status}): ${text}`);
      }

      const data = (await response.json()) as {
        id: string;
        webLink: string;
        onlineMeeting?: { joinUrl: string };
      };

      await auditCalendarWrite({
        agentRole: options.agentRole ?? 'system',
        action: 'calendar.create_event',
        resource,
        identityType: 'app-only-graph',
        tenantId: options.tenantId,
        workspaceKey: options.workspaceKey ?? 'glyphor-internal',
        approvalId: options.approvalId,
        toolName: options.toolName ?? 'create_calendar_event',
        outcome: 'success',
        fallbackUsed: true,
        targetType: 'calendar',
        targetId: options.userId,
        approvalReference: options.approvalReference,
        limitation: 'founder-calendar-write-still-app-only',
        responseCode: response.status,
        responseSummary: 'created',
      });

      return {
        id: data.id,
        webLink: data.webLink,
        onlineMeetingUrl: data.onlineMeeting?.joinUrl,
      };
    } catch (error) {
      if ((error as Error).message.startsWith('Failed to create calendar event')) {
        throw error;
      }
      await auditCalendarWrite({
        agentRole: options.agentRole ?? 'system',
        action: 'calendar.create_event',
        resource,
        identityType: 'app-only-graph',
        tenantId: options.tenantId,
        workspaceKey: options.workspaceKey ?? 'glyphor-internal',
        approvalId: options.approvalId,
        toolName: options.toolName ?? 'create_calendar_event',
        outcome: 'failure',
        fallbackUsed: true,
        targetType: 'calendar',
        targetId: options.userId,
        approvalReference: options.approvalReference,
        limitation: 'founder-calendar-write-still-app-only',
        responseCode: 500,
        responseSummary: (error as Error).message.slice(0, 500),
      });
      throw error;
    }
  }
}

export class FounderCalendarMcpWrapper {
  async createEvent(options: FounderCalendarMcpCreateOptions): Promise<FounderCalendarMcpResult> {
    return this.invokeCalendarTool({
      operation: 'create',
      toolName: 'CreateEvent',
      options,
      buildArguments: (tool) => buildCreateEventArguments(tool, options),
    });
  }

  async cancelEvent(options: FounderCalendarMcpCancelOptions): Promise<FounderCalendarMcpResult> {
    return this.invokeCalendarTool({
      operation: 'cancel',
      toolName: 'CancelEvent',
      options,
      buildArguments: (tool) => buildCancelEventArguments(tool, options),
    });
  }

  async deleteEvent(options: FounderCalendarMcpDeleteOptions): Promise<FounderCalendarMcpResult> {
    return this.invokeCalendarTool({
      operation: 'delete',
      toolName: 'DeleteEventById',
      options,
      buildArguments: (tool) => buildDeleteEventArguments(tool, options),
    });
  }

  async getEvent(options: FounderCalendarMcpGetOptions): Promise<FounderCalendarMcpResult> {
    assertFounderCalendarMcpWrapperEnabled(options.wrapperMode);
    assertCalendarApprovalReference(options);
    const target = resolveCalendarOwnerTarget(options);
    assertAllowedCalendarOwnerTarget(target);

    const config = createAgent365ConfigFromEnv(options.agentRole);
    if (!config) {
      throw new Error(
        'Founder calendar MCP wrapper requires AGENT365_ENABLED=true plus Agent365 credentials and identity.',
      );
    }

    const { tool, data } = await withAgent365Tool(
      {
        config,
        serverName: AGENT365_CALENDAR_SERVER_NAME,
        toolName: 'GetEvent',
        agentRole: options.agentRole,
      },
      async (tool) => {
        const result = await tool.execute(
          buildGetEventArguments(tool, options, target),
          { agentRole: options.agentRole } as ToolContext,
        );
        if (!result.success) {
          throw new Error(result.error ?? `Calendar MCP tool ${tool.name} failed.`);
        }
        return {
          tool,
          data: result.data,
        };
      },
    );

    return normalizeCalendarMcpResult(data, {
      toolName: tool.name,
      targetMode: target.mode,
      targetValue: target.targetValue,
    });
  }

  private async invokeCalendarTool(input: {
    operation: 'create' | 'cancel' | 'delete';
    toolName: 'CreateEvent' | 'CancelEvent' | 'DeleteEventById';
    options: CalendarWriteGovernanceOptions & { wrapperMode: FounderCalendarMcpWrapperMode };
    buildArguments: (tool: ToolDefinition) => Record<string, unknown>;
  }): Promise<FounderCalendarMcpResult> {
    assertFounderCalendarMcpWrapperEnabled(input.options.wrapperMode);
    assertCalendarApprovalReference(input.options);
    const target = resolveCalendarOwnerTarget(input.options);
    assertAllowedCalendarOwnerTarget(target);

    const config = createAgent365ConfigFromEnv(input.options.agentRole);
    if (!config) {
      throw new Error(
        'Founder calendar MCP wrapper requires AGENT365_ENABLED=true plus Agent365 credentials and identity.',
      );
    }

    const action = getCalendarAuditAction(input.operation);
    const resource = getCalendarAuditResource(input.operation, target.targetValue, (input.options as { eventId?: string }).eventId);

    try {
      const { tool, data } = await withAgent365Tool(
        {
          config,
          serverName: AGENT365_CALENDAR_SERVER_NAME,
          toolName: input.toolName,
          agentRole: input.options.agentRole,
        },
        async (tool) => {
          const result = await tool.execute(
            input.buildArguments(tool),
            { agentRole: input.options.agentRole } as ToolContext,
          );
          if (!result.success) {
            throw new Error(result.error ?? `Calendar MCP tool ${tool.name} failed.`);
          }
          return {
            tool,
            data: result.data,
          };
        },
      );

      const normalized = normalizeCalendarMcpResult(data, {
        toolName: tool.name,
        targetMode: target.mode,
        targetValue: target.targetValue,
      });
      await auditCalendarWrite({
        agentRole: input.options.agentRole ?? 'system',
        action,
        resource,
        identityType: 'agent365-calendar-mcp',
        tenantId: input.options.tenantId,
        workspaceKey: input.options.workspaceKey ?? 'glyphor-internal',
        approvalId: input.options.approvalId,
        toolName: input.options.toolName ?? tool.name,
        outcome: 'success',
        fallbackUsed: false,
        targetType: 'calendar',
        targetId: target.targetValue,
        approvalReference: input.options.approvalReference,
        limitation: 'founder-calendar-mcp-wrapper-proof-only',
        responseCode: 200,
        responseSummary: summarizeCalendarMcpResult(data),
      });
      return normalized;
    } catch (error) {
      await auditCalendarWrite({
        agentRole: input.options.agentRole ?? 'system',
        action,
        resource,
        identityType: 'agent365-calendar-mcp',
        tenantId: input.options.tenantId,
        workspaceKey: input.options.workspaceKey ?? 'glyphor-internal',
        approvalId: input.options.approvalId,
        toolName: input.options.toolName ?? input.toolName,
        outcome: 'failure',
        fallbackUsed: false,
        targetType: 'calendar',
        targetId: target.targetValue,
        approvalReference: input.options.approvalReference,
        limitation: 'founder-calendar-mcp-wrapper-proof-only',
        responseCode: 500,
        responseSummary: (error as Error).message.slice(0, 500),
      });
      throw error;
    }
  }
}

function assertAppOnlyCalendarWriteAllowed(): void {
  if (process.env.ALLOW_APP_ONLY_CALENDAR_WRITE === 'true') return;
  throw new Error(
    'Calendar writes are disabled by default until a clean Agent365-backed identity path exists. '
    + 'Set ALLOW_APP_ONLY_CALENDAR_WRITE=true only as an explicit, approved exception.',
  );
}

function assertFounderCalendarMcpWrapperEnabled(mode: FounderCalendarMcpWrapperMode): void {
  if (mode !== 'agent365-mcp-proof') {
    throw new Error('Founder calendar MCP wrapper requires wrapperMode="agent365-mcp-proof".');
  }
  if (process.env.ENABLE_FOUNDER_CALENDAR_MCP_WRAPPER === 'true') return;
  throw new Error(
    'Founder calendar MCP wrapper is proof-only. Set ENABLE_FOUNDER_CALENDAR_MCP_WRAPPER=true for explicit evaluation runs.',
  );
}

function assertCalendarApprovalReference(options: Pick<CalendarWriteGovernanceOptions, 'approvalReference'>): void {
  if (options.approvalReference?.trim()) return;
  throw new Error(
    'Calendar writes require an explicit approval_reference. '
    + 'Provide the founder approval artifact or directive ID that authorized the write.',
  );
}

function assertAllowedCalendarOwner(userId: string): void {
  if (resolveAllowedCalendarOwnerIds().has(userId)) return;
  throw new Error(
    `Calendar writes are only allowed for explicitly configured owners. `
    + `Add ${userId} to ALLOWED_CALENDAR_OWNER_IDS only if this write path is approved.`,
  );
}

function assertAllowedCalendarOwnerPrincipalName(userPrincipalName: string): void {
  if (resolveAllowedCalendarOwnerPrincipalNames().has(userPrincipalName.trim().toLowerCase())) return;
  throw new Error(
    `Calendar writes are only allowed for explicitly configured owner principal names. `
    + `Add ${userPrincipalName} to ALLOWED_CALENDAR_OWNER_UPNS only if this write path is approved.`,
  );
}

function resolveAllowedCalendarOwnerIds(): Set<string> {
  const founderIds = Object.values(buildFounderDirectory()).map((contact) => contact.userId);
  return new Set(
    [
      ...founderIds,
      ...(process.env.ALLOWED_CALENDAR_OWNER_IDS ?? '').split(','),
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

function resolveAllowedCalendarOwnerPrincipalNames(): Set<string> {
  const founderEmails = Object.values(buildFounderDirectory()).map((contact) => contact.email.toLowerCase());
  return new Set(
    [
      ...founderEmails,
      ...(process.env.ALLOWED_CALENDAR_OWNER_UPNS ?? '').split(','),
    ]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
}

function getFounderContactByUserId(userId: string): { userId: string; email: string; displayName: string } | null {
  return Object.values(buildFounderDirectory()).find((contact) => contact.userId === userId) ?? null;
}

interface CalendarOwnerTarget {
  mode: FounderCalendarMcpTargetMode;
  userId: string;
  userPrincipalName?: string;
  targetValue: string;
}

function resolveCalendarOwnerTarget(options: CalendarWriteGovernanceOptions): CalendarOwnerTarget {
  const mode = options.targetMode ?? 'user_id';
  if (mode === 'user_principal_name') {
    const resolvedUpn = options.userPrincipalName?.trim() || getFounderContactByUserId(options.userId)?.email?.trim();
    if (!resolvedUpn) {
      throw new Error(
        `Founder calendar MCP wrapper requires userPrincipalName for user ${options.userId}. `
        + 'Set TEAMS_USER_*_EMAIL or provide userPrincipalName explicitly for proof runs.',
      );
    }
    return {
      mode,
      userId: options.userId,
      userPrincipalName: resolvedUpn,
      targetValue: resolvedUpn,
    };
  }

  return {
    mode,
    userId: options.userId,
    userPrincipalName: options.userPrincipalName?.trim() || getFounderContactByUserId(options.userId)?.email?.trim(),
    targetValue: options.userId,
  };
}

function assertAllowedCalendarOwnerTarget(target: CalendarOwnerTarget): void {
  assertAllowedCalendarOwner(target.userId);
  if (target.mode === 'user_principal_name') {
    assertAllowedCalendarOwnerPrincipalName(target.targetValue);
  }
}

function auditCalendarWrite(
  input: Parameters<typeof logMicrosoftWriteAudit>[0],
): Promise<void> {
  return logMicrosoftWriteAudit(input);
}

function getCalendarAuditAction(operation: 'create' | 'cancel' | 'delete'): 'calendar.create_event' | 'calendar.cancel_event' | 'calendar.delete_event' {
  if (operation === 'cancel') return 'calendar.cancel_event';
  if (operation === 'delete') return 'calendar.delete_event';
  return 'calendar.create_event';
}

function getCalendarAuditResource(
  operation: 'create' | 'cancel' | 'delete',
  userId: string,
  eventId?: string,
): string {
  if (operation === 'create') {
    return `users/${userId}/events`;
  }
  return `users/${userId}/events/${eventId ?? 'unknown'}`;
}

function buildCreateEventArguments(
  tool: ToolDefinition,
  options: FounderCalendarMcpCreateOptions,
  target = resolveCalendarOwnerTarget(options),
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  assignCalendarOwnerArguments(args, tool, target);
  setToolArgument(args, tool, ['subject', 'title'], options.subject);
  setToolArgument(args, tool, ['body', 'description', 'content'], options.body);
  setToolArgument(args, tool, ['start', 'startTime', 'startDateTime'], options.start);
  setToolArgument(args, tool, ['end', 'endTime', 'endDateTime'], options.end);
  setToolArgument(args, tool, ['timeZone', 'timezone'], options.timeZone ?? 'America/Chicago');
  setToolArgument(args, tool, ['location', 'locationDisplayName'], options.location);
  setToolArgument(args, tool, ['isOnlineMeeting', 'isOnline', 'onlineMeeting'], options.isOnlineMeeting ?? false);
  setToolArgument(args, tool, ['showAs'], options.showAs ?? 'busy');

  if (options.attendees?.length) {
    setToolArgument(args, tool, ['attendees', 'requiredAttendees', 'participantEmails'], options.attendees);
  }

  return args;
}

function buildCancelEventArguments(
  tool: ToolDefinition,
  options: FounderCalendarMcpCancelOptions,
  target = resolveCalendarOwnerTarget(options),
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  assignCalendarOwnerArguments(args, tool, target);
  setToolArgument(args, tool, ['eventId', 'id'], options.eventId);
  setToolArgument(args, tool, ['comment', 'message', 'cancellationMessage'], options.comment);
  return args;
}

function buildDeleteEventArguments(
  tool: ToolDefinition,
  options: FounderCalendarMcpDeleteOptions,
  target = resolveCalendarOwnerTarget(options),
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  assignCalendarOwnerArguments(args, tool, target);
  setToolArgument(args, tool, ['eventId', 'id'], options.eventId);
  return args;
}

function buildGetEventArguments(
  tool: ToolDefinition,
  options: FounderCalendarMcpGetOptions,
  target = resolveCalendarOwnerTarget(options),
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  assignCalendarOwnerArguments(args, tool, target);
  setToolArgument(args, tool, ['eventId', 'id'], options.eventId);
  return args;
}

function assignCalendarOwnerArguments(
  args: Record<string, unknown>,
  tool: ToolDefinition,
  target: CalendarOwnerTarget,
): void {
  if (target.mode === 'user_principal_name') {
    const assignedPrincipal = setToolArgument(
      args,
      tool,
      ['userPrincipalName', 'userEmail', 'mailbox', 'calendarOwnerEmail'],
      target.userPrincipalName,
    );
    const assignedGeneric = setToolArgument(args, tool, ['user', 'owner', 'calendarOwner'], target.userPrincipalName);
    if (!assignedPrincipal && !assignedGeneric) {
      throw new Error(
        'Calendar MCP tool does not expose a userPrincipalName/mailbox owner parameter for proof evaluation.',
      );
    }
    return;
  }

  const assignedId = setToolArgument(args, tool, ['userId', 'ownerId', 'calendarOwnerId'], target.userId);
  const assignedGeneric = setToolArgument(args, tool, ['user', 'owner', 'calendarOwner'], target.userId);
  if (!assignedId && !assignedGeneric) {
    throw new Error(
      'Calendar MCP tool does not expose a userId owner parameter for proof evaluation.',
    );
  }
}

function setToolArgument(
  args: Record<string, unknown>,
  tool: ToolDefinition,
  candidates: string[],
  value: unknown,
): boolean {
  if (value === undefined || value === null || value === '') return false;
  for (const candidate of candidates) {
    const param = getToolParameter(tool, candidate);
    if (!param) continue;
    args[candidate] = coerceToolArgumentValue(param, value);
    return true;
  }
  return false;
}

function getToolParameter(tool: ToolDefinition, name: string): ToolParameter | null {
  return tool.parameters?.[name] ?? null;
}

function coerceToolArgumentValue(param: ToolParameter, value: unknown): unknown {
  if (Array.isArray(value)) {
    if (param.type === 'string') {
      return value.map((entry) => {
        if (!entry || typeof entry !== 'object') return String(entry ?? '');
        const attendee = entry as CalendarAttendee;
        return attendee.email;
      }).join(', ');
    }
    if (param.type === 'array') {
      if (param.items?.type === 'string') {
        return value.map((entry) => {
          if (!entry || typeof entry !== 'object') return String(entry ?? '');
          const attendee = entry as CalendarAttendee;
          return attendee.email;
        });
      }
      return value;
    }
  }
  return value;
}

function normalizeCalendarMcpResult(
  data: unknown,
  metadata?: Pick<FounderCalendarMcpResult, 'toolName' | 'targetMode' | 'targetValue'>,
): FounderCalendarMcpResult {
  const parsed = parsePossiblyJsonCalendarPayload(data);
  const record = parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown>
    : null;
  const meeting = record?.onlineMeeting && typeof record.onlineMeeting === 'object'
    ? record.onlineMeeting as Record<string, unknown>
    : null;

  return {
    raw: parsed,
    toolName: metadata?.toolName,
    targetMode: metadata?.targetMode,
    targetValue: metadata?.targetValue,
    eventId: firstString(record, ['id', 'eventId']),
    webLink: firstString(record, ['webLink', 'url']),
    onlineMeetingUrl: firstString(meeting, ['joinUrl']),
  };
}

function summarizeCalendarMcpResult(data: unknown): string {
  if (typeof data === 'string') {
    return data.slice(0, 500);
  }
  try {
    return JSON.stringify(data).slice(0, 500);
  } catch {
    return String(data).slice(0, 500);
  }
}

function parsePossiblyJsonCalendarPayload(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  const trimmed = data.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return data;
  try {
    return JSON.parse(trimmed);
  } catch {
    return data;
  }
}

function firstString(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}
