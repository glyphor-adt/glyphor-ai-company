/**
 * Email Marketing Tools — Mailchimp audience/campaign management & Mandrill transactional email
 *
 * Mailchimp tools:
 *   get_mailchimp_lists       — List all audiences/lists
 *   get_mailchimp_members     — List audience members
 *   get_mailchimp_segments    — List audience segments
 *   create_mailchimp_campaign — Create a new email campaign
 *   set_campaign_content      — Set campaign HTML content
 *   send_test_campaign        — Send a test email for a campaign
 *   send_campaign             — Send or schedule a campaign (YELLOW authority)
 *   get_campaign_report       — Get campaign performance metrics
 *   get_campaign_list         — List campaigns by status
 *   manage_mailchimp_tags     — Add or remove subscriber tags
 *
 * Mandrill tools:
 *   send_transactional_email  — Send a one-off transactional email
 *   get_mandrill_stats        — Get sending statistics
 *   search_mandrill_messages  — Search email history
 *   get_mandrill_templates    — List available templates
 *   render_mandrill_template  — Render a template with merge variables
 */

import { createHash } from 'node:crypto';
import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

// ── Mailchimp helpers ──────────────────────────────────────────────────

function getMailchimpConfig(): { apiKey: string; server: string } {
  const apiKey = process.env.GLYPHOR_MAILCHIMP_API;
  if (!apiKey) throw new Error('GLYPHOR_MAILCHIMP_API not configured');
  const server = apiKey.split('-').pop() || 'us13';
  return { apiKey, server };
}

async function mailchimpFetch(path: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
  const { apiKey, server } = getMailchimpConfig();
  const res = await fetch(`https://${server}.api.mailchimp.com/3.0${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
      ...options.headers,
    },
  });
  return await res.json() as Record<string, unknown>;
}

// ── Mandrill helpers ───────────────────────────────────────────────────

function getMandrillApiKey(): string {
  const key = process.env.GLYPHOR_MANDRILL_API_KEY;
  if (!key) throw new Error('GLYPHOR_MANDRILL_API_KEY not configured');
  return key;
}

async function mandrillFetch(endpoint: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown> | unknown[]> {
  const key = getMandrillApiKey();
  const res = await fetch(`https://mandrillapp.com/api/1.0${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, ...body }),
  });
  return await res.json() as Record<string, unknown>;
}

// ── Exported tool factory ──────────────────────────────────────────────

export function createEmailMarketingTools(): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════════════
    //  MAILCHIMP
    // ═══════════════════════════════════════════════════════════════════

    // ── get_mailchimp_lists ────────────────────────────────────────────
    {
      name: 'get_mailchimp_lists',
      description: 'List all Mailchimp audiences/lists with member counts and engagement rates.',
      parameters: {
        count: {
          type: 'number',
          description: 'Maximum number of lists to return',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const count = (params.count as number) || 10;
          const data = await mailchimpFetch(`/lists?count=${count}`);
          const lists = data.lists as Array<Record<string, unknown>> | undefined;
          return {
            success: true,
            data: {
              lists: (lists ?? []).map((l) => ({
                id: l.id,
                name: l.name,
                member_count: (l.stats as Record<string, unknown>)?.member_count,
                open_rate: (l.stats as Record<string, unknown>)?.open_rate,
                click_rate: (l.stats as Record<string, unknown>)?.click_rate,
              })),
              total: data.total_items,
            },
          };
        } catch (err) {
          return { success: false, error: `get_mailchimp_lists failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_mailchimp_members ──────────────────────────────────────────
    {
      name: 'get_mailchimp_members',
      description: 'List members of a Mailchimp audience, optionally filtered by subscription status.',
      parameters: {
        list_id: { type: 'string', description: 'Audience/list ID', required: true },
        status: {
          type: 'string',
          description: 'Filter by subscription status',
          required: false,
          enum: ['subscribed', 'unsubscribed', 'pending'],
        },
        count: {
          type: 'number',
          description: 'Maximum number of members to return',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const listId = params.list_id as string;
          const count = (params.count as number) || 10;
          const query = new URLSearchParams({ count: String(count) });
          if (params.status) query.set('status', params.status as string);

          const data = await mailchimpFetch(`/lists/${listId}/members?${query.toString()}`);
          const members = data.members as Array<Record<string, unknown>> | undefined;
          return {
            success: true,
            data: {
              members: (members ?? []).map((m) => ({
                email: m.email_address,
                status: m.status,
                tags: m.tags,
                merge_fields: m.merge_fields,
              })),
              total: data.total_items,
            },
          };
        } catch (err) {
          return { success: false, error: `get_mailchimp_members failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_mailchimp_segments ─────────────────────────────────────────
    {
      name: 'get_mailchimp_segments',
      description: 'List segments for a Mailchimp audience.',
      parameters: {
        list_id: { type: 'string', description: 'Audience/list ID', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!params.list_id) return { success: false, error: 'list_id parameter is required' };
        try {
          const listId = params.list_id as string;
          const data = await mailchimpFetch(`/lists/${listId}/segments`);
          const segments = data.segments as Array<Record<string, unknown>> | undefined;
          return {
            success: true,
            data: {
              segments: (segments ?? []).map((s) => ({
                id: s.id,
                name: s.name,
                member_count: s.member_count,
                conditions: s.options,
              })),
              total: data.total_items,
            },
          };
        } catch (err) {
          return { success: false, error: `get_mailchimp_segments failed: ${(err as Error).message}` };
        }
      },
    },

    // ── create_mailchimp_campaign ──────────────────────────────────────
    {
      name: 'create_mailchimp_campaign',
      description: 'Create a new Mailchimp email campaign.',
      parameters: {
        list_id: { type: 'string', description: 'Audience/list ID to send to', required: true },
        subject: { type: 'string', description: 'Email subject line', required: true },
        from_name: { type: 'string', description: 'Sender display name', required: true },
        from_email: { type: 'string', description: 'Sender email / reply-to address', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const data = await mailchimpFetch('/campaigns', {
            method: 'POST',
            body: JSON.stringify({
              type: 'regular',
              recipients: { list_id: params.list_id as string },
              settings: {
                subject_line: params.subject as string,
                from_name: params.from_name as string,
                reply_to: params.from_email as string,
              },
            }),
          });
          return {
            success: true,
            data: {
              campaign_id: data.id,
              web_id: data.web_id,
              status: data.status,
            },
          };
        } catch (err) {
          return { success: false, error: `create_mailchimp_campaign failed: ${(err as Error).message}` };
        }
      },
    },

    // ── set_campaign_content ───────────────────────────────────────────
    {
      name: 'set_campaign_content',
      description: 'Set the HTML content for a Mailchimp campaign.',
      parameters: {
        campaign_id: { type: 'string', description: 'Campaign ID', required: true },
        html_content: { type: 'string', description: 'HTML content for the email body. Do NOT use markdown syntax — use proper HTML only.', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const campaignId = params.campaign_id as string;
          await mailchimpFetch(`/campaigns/${campaignId}/content`, {
            method: 'PUT',
            body: JSON.stringify({ html: params.html_content as string }),
          });
          return {
            success: true,
            data: { campaign_id: campaignId, message: 'Campaign content updated' },
          };
        } catch (err) {
          return { success: false, error: `set_campaign_content failed: ${(err as Error).message}` };
        }
      },
    },

    // ── send_test_campaign ─────────────────────────────────────────────
    {
      name: 'send_test_campaign',
      description: 'Send a test email for a Mailchimp campaign to specified addresses.',
      parameters: {
        campaign_id: { type: 'string', description: 'Campaign ID', required: true },
        test_emails: {
          type: 'string',
          description: 'Comma-separated list of email addresses to send the test to',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const campaignId = params.campaign_id as string;
          const emails = (params.test_emails as string).split(',').map((e) => e.trim());
          await mailchimpFetch(`/campaigns/${campaignId}/actions/test`, {
            method: 'POST',
            body: JSON.stringify({ test_emails: emails, send_type: 'html' }),
          });
          return {
            success: true,
            data: { campaign_id: campaignId, test_emails: emails, message: 'Test email sent' },
          };
        } catch (err) {
          return { success: false, error: `send_test_campaign failed: ${(err as Error).message}` };
        }
      },
    },

    // ── send_campaign (YELLOW authority) ───────────────────────────────
    {
      name: 'send_campaign',
      description:
        'Send a Mailchimp campaign to its audience or schedule it for later delivery. ' +
        'YELLOW authority — sends real emails to subscribers.',
      parameters: {
        campaign_id: { type: 'string', description: 'Campaign ID', required: true },
        schedule_time: {
          type: 'string',
          description: 'ISO 8601 datetime to schedule send (omit to send immediately)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const campaignId = params.campaign_id as string;
          const scheduleTime = params.schedule_time as string | undefined;

          if (scheduleTime) {
            await mailchimpFetch(`/campaigns/${campaignId}/actions/schedule`, {
              method: 'POST',
              body: JSON.stringify({ schedule_time: scheduleTime }),
            });
            return {
              success: true,
              data: { campaign_id: campaignId, scheduled_for: scheduleTime, message: 'Campaign scheduled' },
            };
          }

          await mailchimpFetch(`/campaigns/${campaignId}/actions/send`, {
            method: 'POST',
          });
          return {
            success: true,
            data: { campaign_id: campaignId, message: 'Campaign sent' },
          };
        } catch (err) {
          return { success: false, error: `send_campaign failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_campaign_report ────────────────────────────────────────────
    {
      name: 'get_campaign_report',
      description: 'Get performance metrics for a sent Mailchimp campaign.',
      parameters: {
        campaign_id: { type: 'string', description: 'Campaign ID', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const campaignId = params.campaign_id as string;
          const data = await mailchimpFetch(`/reports/${campaignId}`);
          const opens = data.opens as Record<string, unknown> | undefined;
          const clicks = data.clicks as Record<string, unknown> | undefined;
          return {
            success: true,
            data: {
              campaign_id: campaignId,
              emails_sent: data.emails_sent,
              opens: opens?.opens_total,
              open_rate: opens?.open_rate,
              clicks: clicks?.clicks_total,
              click_rate: clicks?.click_rate,
              bounces: (data.bounces as Record<string, unknown>)?.hard_bounces,
              unsubscribes: data.unsubscribed,
            },
          };
        } catch (err) {
          return { success: false, error: `get_campaign_report failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_campaign_list ──────────────────────────────────────────────
    {
      name: 'get_campaign_list',
      description: 'List Mailchimp campaigns, optionally filtered by status.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter campaigns by status',
          required: false,
          enum: ['sent', 'draft', 'schedule'],
        },
        count: {
          type: 'number',
          description: 'Maximum number of campaigns to return',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const count = (params.count as number) || 10;
          const query = new URLSearchParams({ count: String(count) });
          if (params.status) query.set('status', params.status as string);

          const data = await mailchimpFetch(`/campaigns?${query.toString()}`);
          const campaigns = data.campaigns as Array<Record<string, unknown>> | undefined;
          return {
            success: true,
            data: {
              campaigns: (campaigns ?? []).map((c) => ({
                id: c.id,
                web_id: c.web_id,
                title: (c.settings as Record<string, unknown>)?.title,
                subject: (c.settings as Record<string, unknown>)?.subject_line,
                status: c.status,
                send_time: c.send_time,
                emails_sent: c.emails_sent,
              })),
              total: data.total_items,
            },
          };
        } catch (err) {
          return { success: false, error: `get_campaign_list failed: ${(err as Error).message}` };
        }
      },
    },

    // ── manage_mailchimp_tags ──────────────────────────────────────────
    {
      name: 'manage_mailchimp_tags',
      description: 'Add or remove tags for a subscriber in a Mailchimp audience.',
      parameters: {
        list_id: { type: 'string', description: 'Audience/list ID', required: true },
        email: { type: 'string', description: 'Subscriber email address', required: true },
        tags: {
          type: 'string',
          description: 'Comma-separated list of tag names',
          required: true,
        },
        action: {
          type: 'string',
          description: 'Whether to add or remove the tags',
          required: true,
          enum: ['add', 'remove'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const listId = params.list_id as string;
          const email = params.email as string;
          const action = params.action as string;
          const tagNames = (params.tags as string).split(',').map((t) => t.trim());
          const hash = createHash('md5').update(email.toLowerCase().trim()).digest('hex');

          await mailchimpFetch(`/lists/${listId}/members/${hash}/tags`, {
            method: 'POST',
            body: JSON.stringify({
              tags: tagNames.map((name) => ({ name, status: action === 'add' ? 'active' : 'inactive' })),
            }),
          });

          return {
            success: true,
            data: { list_id: listId, email, action, tags: tagNames, message: `Tags ${action === 'add' ? 'added' : 'removed'}` },
          };
        } catch (err) {
          return { success: false, error: `manage_mailchimp_tags failed: ${(err as Error).message}` };
        }
      },
    },

    // ═══════════════════════════════════════════════════════════════════
    //  MANDRILL
    // ═══════════════════════════════════════════════════════════════════

    // ── send_transactional_email ───────────────────────────────────────
    {
      name: 'send_transactional_email',
      description: 'Send a one-off transactional email via Mandrill. NEVER use markdown formatting in the email body — write in plain professional prose or clean HTML.',
      parameters: {
        to_email: { type: 'string', description: 'Recipient email address', required: true },
        to_name: { type: 'string', description: 'Recipient display name', required: false },
        subject: { type: 'string', description: 'Email subject line', required: true },
        html_content: { type: 'string', description: 'HTML body of the email. Do NOT use markdown syntax — use proper HTML or plain professional prose.', required: true },
        from_email: { type: 'string', description: 'Sender email address', required: false },
        from_name: { type: 'string', description: 'Sender display name', required: false },
        tags: { type: 'string', description: 'Comma-separated tags for tracking', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const tags = params.tags ? (params.tags as string).split(',').map((t) => t.trim()) : [];
          const result = await mandrillFetch('/messages/send.json', {
            message: {
              to: [{ email: params.to_email as string, name: (params.to_name as string) || undefined, type: 'to' }],
              subject: params.subject as string,
              html: params.html_content as string,
              from_email: (params.from_email as string) || 'noreply@glyphor.ai',
              from_name: (params.from_name as string) || 'Glyphor',
              tags,
            },
          });
          const messages = Array.isArray(result) ? result : [result];
          const first = messages[0] as Record<string, unknown> | undefined;
          return {
            success: true,
            data: {
              message_id: first?._id,
              status: first?.status,
              email: first?.email,
            },
          };
        } catch (err) {
          return { success: false, error: `send_transactional_email failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_mandrill_stats ─────────────────────────────────────────────
    {
      name: 'get_mandrill_stats',
      description: 'Get Mandrill sending statistics for a given time range.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time range for statistics',
          required: false,
          enum: ['7d', '30d', '90d'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const data = await mandrillFetch('/senders/info.json') as Record<string, unknown>;

          const range = (params.date_range as string) || '30d';
          const statsKey = range === '7d' ? 'stats_7d' : range === '90d' ? 'stats_90d' : 'stats_30d';
          const stats = (data[statsKey] ?? data.stats) as Record<string, unknown> | undefined;

          return {
            success: true,
            data: {
              date_range: range,
              sends: stats?.sent ?? data.sent,
              opens: stats?.opens ?? data.opens,
              clicks: stats?.clicks ?? data.clicks,
              bounces: stats?.hard_bounces ?? data.hard_bounces,
              rejects: stats?.rejects ?? data.rejects,
            },
          };
        } catch (err) {
          return { success: false, error: `get_mandrill_stats failed: ${(err as Error).message}` };
        }
      },
    },

    // ── search_mandrill_messages ───────────────────────────────────────
    {
      name: 'search_mandrill_messages',
      description: 'Search Mandrill email history by query, date range, or recipient.',
      parameters: {
        query: { type: 'string', description: 'Search query (email address, subject, etc.)', required: false },
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)', required: false },
        date_to: { type: 'string', description: 'End date (YYYY-MM-DD)', required: false },
        limit: { type: 'number', description: 'Maximum number of results', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const body: Record<string, unknown> = {
            query: (params.query as string) || '*',
            limit: (params.limit as number) || 25,
          };
          if (params.date_from) body.date_from = params.date_from as string;
          if (params.date_to) body.date_to = params.date_to as string;

          const result = await mandrillFetch('/messages/search.json', body);
          const messages = Array.isArray(result) ? result : [];
          return {
            success: true,
            data: {
              messages: (messages as Array<Record<string, unknown>>).map((m) => ({
                id: m._id,
                email: m.email,
                subject: m.subject,
                status: m.state,
                opens: m.opens,
                clicks: m.clicks,
                ts: m.ts,
              })),
              total: messages.length,
            },
          };
        } catch (err) {
          return { success: false, error: `search_mandrill_messages failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_mandrill_templates ─────────────────────────────────────────
    {
      name: 'get_mandrill_templates',
      description: 'List available Mandrill email templates.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const result = await mandrillFetch('/templates/list.json');
          const templates = Array.isArray(result) ? result : [];
          return {
            success: true,
            data: {
              templates: (templates as Array<Record<string, unknown>>).map((t) => ({
                name: t.name,
                slug: t.slug,
                subject: t.subject,
                labels: t.labels,
                publish_name: t.publish_name,
              })),
              total: templates.length,
            },
          };
        } catch (err) {
          return { success: false, error: `get_mandrill_templates failed: ${(err as Error).message}` };
        }
      },
    },

    // ── render_mandrill_template ───────────────────────────────────────
    {
      name: 'render_mandrill_template',
      description: 'Render a Mandrill template with merge variables and return the resulting HTML.',
      parameters: {
        template_name: { type: 'string', description: 'Template name or slug', required: true },
        merge_vars: {
          type: 'string',
          description: 'JSON string of key-value pairs for template merge variables',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const templateName = params.template_name as string;
          let mergeContent: Array<{ name: string; content: string }> = [];

          if (params.merge_vars) {
            const parsed = JSON.parse(params.merge_vars as string) as Record<string, string>;
            mergeContent = Object.entries(parsed).map(([name, content]) => ({ name, content }));
          }

          const data = await mandrillFetch('/templates/render.json', {
            template_name: templateName,
            template_content: mergeContent,
            merge_vars: [],
          }) as Record<string, unknown>;

          return {
            success: true,
            data: {
              template_name: templateName,
              html: data.html,
            },
          };
        } catch (err) {
          return { success: false, error: `render_mandrill_template failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
