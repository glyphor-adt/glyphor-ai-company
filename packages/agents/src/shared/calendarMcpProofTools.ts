import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import {
  FounderCalendarMcpWrapper,
  buildFounderDirectory,
  type CalendarAttendee,
  type FounderCalendarMcpGetOptions,
  type FounderCalendarMcpTargetMode,
} from '@glyphor/integrations';

export const CALENDAR_MCP_PROOF_TOOL_NAME = 'evaluate_calendar_mcp_founder_create_event' as const;

interface CalendarMcpProofToolOptions {
  defaultAgentRole: string;
  recordActivity?: (summary: string) => Promise<void>;
}

type FounderKey = 'kristina' | 'andrew';
type CleanupMode = 'none' | 'cancel' | 'delete';
type CalendarShowAs = 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere';

export function createCalendarMcpProofTools(options: CalendarMcpProofToolOptions): ToolDefinition[] {
  const founderDir = buildFounderDirectory();
  const wrapper = new FounderCalendarMcpWrapper();

  return [
    {
      name: CALENDAR_MCP_PROOF_TOOL_NAME,
      description:
        'Proof-only founder calendar evaluation via Agent365 Calendar MCP. '
        + 'Preserves founder allowlist, approval_reference, and Microsoft audit logging while leaving production create_calendar_event on the app-only exception path.',
      parameters: {
        founder: {
          type: 'string',
          description: 'Founder calendar to target during MCP evaluation.',
          required: true,
          enum: ['kristina', 'andrew'],
        },
        target_mode: {
          type: 'string',
          description: 'Whether to target the founder calendar by user_id or user_principal_name during proof.',
          required: false,
          enum: ['user_id', 'user_principal_name'],
        },
        subject: {
          type: 'string',
          description: 'Event title for the proof calendar write.',
          required: true,
        },
        start: {
          type: 'string',
          description: 'Start datetime ISO 8601.',
          required: true,
        },
        end: {
          type: 'string',
          description: 'End datetime ISO 8601.',
          required: true,
        },
        body: {
          type: 'string',
          description: 'Optional event description / agenda.',
          required: false,
        },
        attendees: {
          type: 'array',
          description: 'Optional attendee email addresses.',
          required: false,
          items: { type: 'string', description: 'Attendee email address' },
        },
        location: {
          type: 'string',
          description: 'Optional event location.',
          required: false,
        },
        is_online: {
          type: 'boolean',
          description: 'Create as Teams online meeting.',
          required: false,
        },
        time_zone: {
          type: 'string',
          description: 'IANA time zone. Defaults to America/Chicago.',
          required: false,
        },
        show_as: {
          type: 'string',
          description: 'Calendar busy state.',
          required: false,
          enum: ['free', 'tentative', 'busy', 'oof', 'workingElsewhere'],
        },
        cleanup_mode: {
          type: 'string',
          description: 'Optional cleanup after create. Default: cancel.',
          required: false,
          enum: ['none', 'cancel', 'delete'],
        },
        cleanup_comment: {
          type: 'string',
          description: 'Optional cancellation message when cleanup_mode=cancel.',
          required: false,
        },
        inspect_created_event: {
          type: 'boolean',
          description: 'Fetch the created event through Calendar MCP to inspect organizer/ownership semantics.',
          required: false,
        },
        approval_reference: {
          type: 'string',
          description: 'Required approval artifact authorizing this proof-only founder calendar evaluation.',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const founder = params.founder as FounderKey;
          const contact = founderDir[founder];
          if (!contact) {
            return {
              success: false,
              error: `Founder "${founder}" not configured. Set TEAMS_USER_${founder.toUpperCase()}_ID and TEAMS_USER_${founder.toUpperCase()}_EMAIL.`,
            };
          }

          const agentRole = typeof ctx?.agentRole === 'string' ? ctx.agentRole : options.defaultAgentRole;
          const targetMode = (params.target_mode as FounderCalendarMcpTargetMode | undefined) ?? 'user_id';
          const cleanupMode = (params.cleanup_mode as CleanupMode | undefined) ?? 'cancel';
          const attendees = normalizeAttendees(params.attendees);

          const created = await wrapper.createEvent({
            wrapperMode: 'agent365-mcp-proof',
            userId: contact.userId,
            userPrincipalName: contact.email,
            targetMode,
            agentRole,
            approvalReference: params.approval_reference as string,
            toolName: CALENDAR_MCP_PROOF_TOOL_NAME,
            subject: params.subject as string,
            start: params.start as string,
            end: params.end as string,
            body: params.body as string | undefined,
            attendees,
            location: params.location as string | undefined,
            isOnlineMeeting: params.is_online === true,
            timeZone: params.time_zone as string | undefined,
            showAs: params.show_as as CalendarShowAs | undefined,
          });

          const inspectCreatedEvent = params.inspect_created_event !== false;
          const inspection = created.eventId && inspectCreatedEvent
            ? await inspectCreatedCalendarEvent(wrapper, {
                wrapperMode: 'agent365-mcp-proof',
                userId: contact.userId,
                userPrincipalName: contact.email,
                targetMode,
                eventId: created.eventId,
                agentRole,
                approvalReference: params.approval_reference as string,
                toolName: CALENDAR_MCP_PROOF_TOOL_NAME,
              })
            : { attempted: inspectCreatedEvent, result: null as unknown, error: null as string | null };

          const cleanup = created.eventId && cleanupMode !== 'none'
            ? await cleanupCreatedCalendarEvent(wrapper, cleanupMode, {
                wrapperMode: 'agent365-mcp-proof',
                userId: contact.userId,
                userPrincipalName: contact.email,
                targetMode,
                eventId: created.eventId,
                comment: params.cleanup_comment as string | undefined,
                agentRole,
                approvalReference: params.approval_reference as string,
                toolName: CALENDAR_MCP_PROOF_TOOL_NAME,
              })
            : { attempted: cleanupMode !== 'none', mode: cleanupMode, result: null as unknown, error: null as string | null };

          await options.recordActivity?.(
            `Calendar MCP proof executed for ${founder} via ${targetMode}: ${params.subject as string}`,
          );

          return {
            success: true,
            data: {
              founder,
              targetMode,
              targetValue: targetMode === 'user_principal_name' ? contact.email : contact.userId,
              productionDefaultUnchanged: true,
              create: created,
              inspection,
              cleanup,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}

function normalizeAttendees(value: unknown): CalendarAttendee[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attendees = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
  return attendees.length > 0 ? attendees : undefined;
}

async function inspectCreatedCalendarEvent(
  wrapper: FounderCalendarMcpWrapper,
  options: FounderCalendarMcpGetOptions,
): Promise<{ attempted: boolean; result: unknown; error: string | null }> {
  try {
    const result = await wrapper.getEvent(options);
    return { attempted: true, result, error: null };
  } catch (err) {
    return { attempted: true, result: null, error: (err as Error).message };
  }
}

async function cleanupCreatedCalendarEvent(
  wrapper: FounderCalendarMcpWrapper,
  mode: Exclude<CleanupMode, 'none'>,
  options: {
    wrapperMode: 'agent365-mcp-proof';
    userId: string;
    userPrincipalName: string;
    targetMode: FounderCalendarMcpTargetMode;
    eventId: string;
    comment?: string;
    agentRole: string;
    approvalReference: string;
    toolName: string;
  },
): Promise<{ attempted: boolean; mode: Exclude<CleanupMode, 'none'>; result: unknown; error: string | null }> {
  try {
    const result = mode === 'cancel'
      ? await wrapper.cancelEvent(options)
      : await wrapper.deleteEvent(options);
    return { attempted: true, mode, result, error: null };
  } catch (err) {
    return { attempted: true, mode, result: null, error: (err as Error).message };
  }
}
