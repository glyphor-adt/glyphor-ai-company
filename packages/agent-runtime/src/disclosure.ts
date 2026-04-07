import { systemQuery } from '@glyphor/shared/db';
import type {
  AgentDisclosureConfig,
  CommunicationType,
  CompanyAgentRole,
  DisclosureLevel,
  RecipientType,
} from './types.js';
import { isGlyphorInternalEmail } from './config/emailSignatures.js';

const DISCLOSURE_HTML_MARKER = '<!-- GLYPHOR_DISCLOSURE_V1 -->';
const DISCLOSURE_TEXT_MARKER = '[GLYPHOR_DISCLOSURE_V1]';

const CALENDAR_EXTERNAL_COMMITMENT_TOOL_NAMES = [
  'create_calendar_event',
  'evaluate_calendar_mcp_founder_create_event',
  'CreateEvent',
  'mcp_CalendarTools.CreateEvent',
  'mcp_CalendarTools/CreateEvent',
] as const;

export const DEFAULT_DISCLOSURE_EMAIL_SIGNATURE_TEMPLATE =
  "This message was composed by {{agent_name}} ({{agent_role}}), an AI assistant operating on behalf of {{company_name}} using Glyphor's Autonomous Development Teams platform.";

export const DEFAULT_DISCLOSURE_DISPLAY_NAME_SUFFIX = ' (AI)';

export interface DisclosurePolicyOptions {
  toolName?: string;
}

export interface DisclosurePolicyResult<TPayload = Record<string, unknown>> {
  payload: TPayload;
  requiresApproval?: boolean;
  reason?: string;
}

export interface ExternalCommitmentToolCall {
  toolName: string;
  params: Record<string, unknown>;
}

export interface ExternalCommitmentRule {
  id: string;
  toolNames?: string[];
  match?: (toolCall: ExternalCommitmentToolCall) => boolean;
}

interface ResolvedAgentIdentity {
  canonicalAgentId: string;
  agentRole: string;
  agentName: string;
}

export class DisclosureRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisclosureRequiredError';
  }
}

export const DEFAULT_EXTERNAL_COMMITMENT_RULES: ExternalCommitmentRule[] = [
  {
    id: 'external_email',
    toolNames: ['send_email', 'reply_email_with_attachments', 'reply_to_email'],
    match: ({ params }) => getEmailRecipients(params).some((email) => !isGlyphorInternalEmail(email)),
  },
  {
    id: 'contract_api',
    toolNames: ['prepare_signing_envelope', 'create_signing_envelope', 'send_template_envelope', 'send_draft_envelope'],
    match: ({ params }) => getEmailRecipients(params).some((email) => !isGlyphorInternalEmail(email)),
  },
  {
    id: 'payment_api',
    toolNames: ['create_payment', 'send_payment', 'issue_refund', 'create_payout'],
  },
  {
    id: 'payment_platform',
    match: ({ toolName }) => /stripe|mercury/i.test(toolName) && /pay|payout|refund|invoice|charge|transfer/i.test(toolName),
  },
  {
    id: 'external_meeting',
    toolNames: [...CALENDAR_EXTERNAL_COMMITMENT_TOOL_NAMES],
    match: ({ params }) => getEmailRecipients(params).some((email) => !isGlyphorInternalEmail(email)),
  },
  {
    id: 'crm_external_contact',
    match: ({ toolName, params }) => /crm/i.test(toolName) && getEmailRecipients(params).some((email) => !isGlyphorInternalEmail(email)),
  },
];

export async function getAgentDisclosureConfig(agentId: string): Promise<AgentDisclosureConfig> {
  const identity = await resolveAgentIdentity(agentId);
  await ensureDisclosureConfig(identity.canonicalAgentId);

  const rows = await systemQuery<{
    agent_id: string;
    disclosure_level: DisclosureLevel;
    email_signature_template: string | null;
    display_name_suffix: string | null;
    external_commitment_gate: boolean;
    updated_at: string;
  }>(
    `SELECT agent_id, disclosure_level, email_signature_template, display_name_suffix,
            external_commitment_gate, updated_at
     FROM agent_disclosure_config
     WHERE agent_id = $1
     LIMIT 1`,
    [identity.canonicalAgentId],
  );

  const row = rows[0];
  return {
    agentId: identity.canonicalAgentId,
    disclosureLevel: row?.disclosure_level ?? 'internal_only',
    emailSignatureTemplate: row?.email_signature_template ?? DEFAULT_DISCLOSURE_EMAIL_SIGNATURE_TEMPLATE,
    displayNameSuffix: row?.display_name_suffix ?? DEFAULT_DISCLOSURE_DISPLAY_NAME_SUFFIX,
    externalCommitmentGate: row?.external_commitment_gate ?? true,
    updatedAt: row?.updated_at ?? new Date().toISOString(),
  };
}

export async function applyDisclosurePolicy<TPayload extends Record<string, unknown>>(
  agentId: string,
  communicationType: CommunicationType,
  payload: TPayload,
  recipientType: RecipientType,
  options: DisclosurePolicyOptions = {},
): Promise<DisclosurePolicyResult<TPayload>> {
  const identity = await resolveAgentIdentity(agentId);
  const config = await getAgentDisclosureConfig(identity.canonicalAgentId);

  if (config.disclosureLevel === 'off') {
    return { payload };
  }

  if (config.disclosureLevel === 'internal_only' && recipientType === 'internal') {
    return { payload };
  }

  if (config.disclosureLevel === 'internal_only' && recipientType === 'external') {
    const reason = `External ${communicationType} is blocked for ${identity.agentRole} until disclosure_level is set to all_communications.`;
    await logDisclosureAudit(identity.canonicalAgentId, communicationType, recipientType, 'blocked', {
      toolName: options.toolName,
      reason,
      payload,
    });
    throw new DisclosureRequiredError(reason);
  }

  if (communicationType === 'external_api_call' && config.externalCommitmentGate) {
    const gatedPayload = {
      ...payload,
      requiresApproval: true,
      reason: 'external_commitment',
    } as TPayload;
    await logDisclosureAudit(identity.canonicalAgentId, communicationType, recipientType, 'commitment_gate', {
      toolName: options.toolName,
      reason: 'external_commitment',
      payload: gatedPayload,
    });
    return {
      payload: gatedPayload,
      requiresApproval: true,
      reason: 'external_commitment',
    };
  }

  let nextPayload: Record<string, unknown> = { ...payload };

  if (communicationType === 'email') {
    const signatureTemplate = config.emailSignatureTemplate || DEFAULT_DISCLOSURE_EMAIL_SIGNATURE_TEMPLATE;
    const rendered = renderDisclosureTemplate(signatureTemplate, identity);
    if (typeof nextPayload.body === 'string') {
      nextPayload.body = appendDisclosureText(nextPayload.body, rendered);
    }
  } else if (communicationType === 'slack_message' || communicationType === 'teams_message') {
    const senderName = appendSuffix(identity.agentName, config.displayNameSuffix || DEFAULT_DISCLOSURE_DISPLAY_NAME_SUFFIX);
    const senderKeys = ['senderName', 'sender_name', 'username', 'displayName', 'display_name'] as const;
    let senderInjected = false;
    for (const key of senderKeys) {
      if (typeof nextPayload[key] === 'string') {
        nextPayload[key] = appendSuffix(nextPayload[key] as string, config.displayNameSuffix || DEFAULT_DISCLOSURE_DISPLAY_NAME_SUFFIX);
        senderInjected = true;
      }
    }
    if (!senderInjected) {
      nextPayload.senderName = senderName;
    }
    const messageKey = typeof nextPayload.message === 'string'
      ? 'message'
      : typeof nextPayload.text === 'string'
        ? 'text'
        : null;
    if (messageKey && typeof nextPayload[messageKey] === 'string') {
      nextPayload[messageKey] = prependDisclosureSender(nextPayload[messageKey] as string, senderName);
    }
  }

  await logDisclosureAudit(identity.canonicalAgentId, communicationType, recipientType, 'injected', {
    toolName: options.toolName,
    payload: nextPayload,
  });

  return { payload: nextPayload as TPayload };
}

export function isExternalCommitment(
  toolCall: ExternalCommitmentToolCall,
  rules: ExternalCommitmentRule[] = DEFAULT_EXTERNAL_COMMITMENT_RULES,
): boolean {
  return rules.some((rule) => {
    if (rule.toolNames && !rule.toolNames.includes(toolCall.toolName)) {
      return false;
    }
    if (rule.match) {
      return rule.match(toolCall);
    }
    return Boolean(rule.toolNames && rule.toolNames.includes(toolCall.toolName));
  });
}

export function inferRecipientTypeFromEmails(emails: string[]): RecipientType {
  if (emails.length === 0) return 'external';
  return emails.every((email) => isGlyphorInternalEmail(email)) ? 'internal' : 'external';
}

async function ensureDisclosureConfig(agentId: string): Promise<void> {
  await systemQuery(
    `INSERT INTO agent_disclosure_config
       (agent_id, disclosure_level, email_signature_template, display_name_suffix, external_commitment_gate, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (agent_id) DO NOTHING`,
    [
      agentId,
      'internal_only',
      DEFAULT_DISCLOSURE_EMAIL_SIGNATURE_TEMPLATE,
      DEFAULT_DISCLOSURE_DISPLAY_NAME_SUFFIX,
      true,
    ],
  );
}

async function resolveAgentIdentity(agentId: string): Promise<ResolvedAgentIdentity> {
  const rows = await systemQuery<{
    role: string;
    name: string | null;
    display_name: string | null;
  }>(
    `SELECT role, name, display_name
     FROM company_agents
     WHERE id::text = $1 OR role = $1
     LIMIT 1`,
    [agentId],
  );

  const row = rows[0];
  if (!row) {
    return {
      canonicalAgentId: agentId,
      agentRole: agentId,
      agentName: agentId,
    };
  }

  return {
    canonicalAgentId: row.role,
    agentRole: row.role,
    agentName: row.display_name ?? row.name ?? row.role,
  };
}

async function logDisclosureAudit(
  agentId: string,
  communicationType: CommunicationType,
  recipientType: RecipientType,
  eventType: 'injected' | 'blocked' | 'commitment_gate',
  details: { toolName?: string; reason?: string; payload?: Record<string, unknown> },
): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO disclosure_audit_log
         (agent_id, communication_type, recipient_type, event_type, tool_name, reason, payload_preview, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        agentId,
        communicationType,
        recipientType,
        eventType,
        details.toolName ?? null,
        details.reason ?? null,
        details.payload ? JSON.stringify(summarizePayload(details.payload)) : null,
      ],
    );
  } catch (err) {
    console.warn('[Disclosure] Failed to write audit log:', (err as Error).message);
  }
}

function renderDisclosureTemplate(template: string, identity: ResolvedAgentIdentity): string {
  const companyName = process.env.GLYPHOR_EMAIL_COMPANY_NAME?.trim() || 'Glyphor';
  return template
    .replaceAll('{{agent_name}}', identity.agentName)
    .replaceAll('{{company_name}}', companyName)
    .replaceAll('{{agent_role}}', identity.agentRole);
}

function appendDisclosureText(body: string, renderedDisclosure: string): string {
  if (body.includes(DISCLOSURE_HTML_MARKER) || body.includes(DISCLOSURE_TEXT_MARKER)) {
    return body;
  }

  if (isLikelyHtml(body)) {
    return `${body}<br><br>${DISCLOSURE_HTML_MARKER}<div style="font-family:Segoe UI,Arial,sans-serif;color:#4b5563;font-size:12px;line-height:1.5;">${escapeHtml(renderedDisclosure)}</div>`;
  }

  return `${body}\n\n${renderedDisclosure}\n${DISCLOSURE_TEXT_MARKER}`;
}

function prependDisclosureSender(message: string, senderName: string): string {
  const prefix = `Sent by ${senderName}`;
  if (message.includes(prefix)) {
    return message;
  }
  return `${prefix}\n\n${message}`;
}

function appendSuffix(name: string, suffix: string): string {
  return name.endsWith(suffix) ? name : `${name}${suffix}`;
}

function getEmailRecipients(params: Record<string, unknown>): string[] {
  const emails = new Set<string>();
  const keys = ['to', 'cc', 'bcc', 'recipients', 'toRecipients', 'ccRecipients', 'attendees', 'signers', 'cc_recipients'];

  for (const key of keys) {
    const value = params[key];
    collectEmails(value, emails);
  }

  return Array.from(emails);
}

function collectEmails(value: unknown, target: Set<string>): void {
  if (!value) return;
  if (typeof value === 'string') {
    for (const part of value.split(/[;,]/)) {
      const email = part.trim().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      if (email) target.add(email.toLowerCase());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEmails(item, target);
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['email', 'address']) {
      if (typeof record[key] === 'string') {
        target.add(record[key].trim().toLowerCase());
      }
    }
    if (record.emailAddress && typeof record.emailAddress === 'object') {
      collectEmails(record.emailAddress, target);
    }
  }
}

function summarizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      summary[key] = value.slice(0, 400);
    } else if (Array.isArray(value)) {
      summary[key] = value.slice(0, 10);
    } else if (value && typeof value === 'object') {
      summary[key] = '[object]';
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

function isLikelyHtml(body: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(body);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
