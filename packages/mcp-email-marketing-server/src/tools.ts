import { createHash } from 'node:crypto';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

// ── Mailchimp helpers ──────────────────────────────────────

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
  return (await res.json()) as Record<string, unknown>;
}

// ── Mandrill helpers ───────────────────────────────────────

function getMandrillApiKey(): string {
  const key = process.env.GLYPHOR_MANDRILL_API_KEY;
  if (!key) throw new Error('GLYPHOR_MANDRILL_API_KEY not configured');
  return key;
}

async function mandrillFetch(
  endpoint: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown> | unknown[]> {
  const key = getMandrillApiKey();
  const res = await fetch(`https://mandrillapp.com/api/1.0${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, ...body }),
  });
  return (await res.json()) as Record<string, unknown>;
}

// ── Tools ──────────────────────────────────────────────────

export const tools: ToolDefinition[] = [
  // ─── MAILCHIMP ─────────────────────────────────────────

  {
    name: 'get_mailchimp_lists',
    description: 'List all Mailchimp audiences/lists with member counts and engagement rates.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Maximum number of lists to return.' },
      },
    },
    async handler(params) {
      const count = params.count ?? 10;
      const data = await mailchimpFetch(`/lists?count=${count}`);
      const lists = (data.lists as Array<Record<string, unknown>>) ?? [];
      return {
        lists: lists.map((l) => {
          const stats = (l.stats ?? {}) as Record<string, unknown>;
          return { id: l.id, name: l.name, member_count: stats.member_count, open_rate: stats.open_rate, click_rate: stats.click_rate };
        }),
        total: data.total_items,
      };
    },
  },

  {
    name: 'get_mailchimp_members',
    description: 'List members of a Mailchimp audience, optionally filtered by subscription status.',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string', description: 'Audience/list ID.' },
        status: { type: 'string', description: 'Filter by subscription status.', enum: ['subscribed', 'unsubscribed', 'pending'] },
        count: { type: 'number', description: 'Maximum number of members to return.' },
      },
      required: ['list_id'],
    },
    async handler(params) {
      const qs = new URLSearchParams();
      if (params.count) qs.set('count', String(params.count));
      if (params.status) qs.set('status', String(params.status));
      const data = await mailchimpFetch(`/lists/${params.list_id}/members?${qs.toString()}`);
      const members = (data.members as Array<Record<string, unknown>>) ?? [];
      return {
        members: members.map((m) => ({ email: m.email_address, status: m.status, tags: m.tags, merge_fields: m.merge_fields })),
        total: data.total_items,
      };
    },
  },

  {
    name: 'get_mailchimp_segments',
    description: 'List segments for a Mailchimp audience.',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string', description: 'Audience/list ID.' },
      },
      required: ['list_id'],
    },
    async handler(params) {
      const data = await mailchimpFetch(`/lists/${params.list_id}/segments`);
      const segments = (data.segments as Array<Record<string, unknown>>) ?? [];
      return {
        segments: segments.map((s) => ({ id: s.id, name: s.name, member_count: s.member_count, conditions: s.options })),
        total: data.total_items,
      };
    },
  },

  {
    name: 'create_mailchimp_campaign',
    description: 'Create a new Mailchimp email campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string', description: 'Audience/list ID to send to.' },
        subject: { type: 'string', description: 'Email subject line.' },
        from_name: { type: 'string', description: 'Sender display name.' },
        from_email: { type: 'string', description: 'Sender email / reply-to address.' },
      },
      required: ['list_id', 'subject', 'from_name', 'from_email'],
    },
    async handler(params) {
      const data = await mailchimpFetch('/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          type: 'regular',
          recipients: { list_id: params.list_id },
          settings: { subject_line: params.subject, from_name: params.from_name, reply_to: params.from_email },
        }),
      });
      return { campaign_id: data.id, web_id: data.web_id, status: data.status };
    },
  },

  {
    name: 'set_campaign_content',
    description: 'Set the HTML content for a Mailchimp campaign. Do NOT use markdown syntax — use proper HTML only.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID.' },
        html_content: { type: 'string', description: 'HTML content for the email body. Do NOT use markdown syntax — use proper HTML only.' },
      },
      required: ['campaign_id', 'html_content'],
    },
    async handler(params) {
      await mailchimpFetch(`/campaigns/${params.campaign_id}/content`, {
        method: 'PUT',
        body: JSON.stringify({ html: params.html_content }),
      });
      return { campaign_id: params.campaign_id, message: 'Campaign content updated' };
    },
  },

  {
    name: 'send_test_campaign',
    description: 'Send a test email for a Mailchimp campaign to specified addresses.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID.' },
        test_emails: { type: 'string', description: 'Comma-separated list of email addresses to send the test to.' },
      },
      required: ['campaign_id', 'test_emails'],
    },
    async handler(params) {
      const emails = (params.test_emails as string).split(',').map((e) => e.trim());
      await mailchimpFetch(`/campaigns/${params.campaign_id}/actions/test`, {
        method: 'POST',
        body: JSON.stringify({ test_emails: emails, send_type: 'html' }),
      });
      return { campaign_id: params.campaign_id, test_emails: emails, message: 'Test email sent' };
    },
  },

  {
    name: 'send_campaign',
    description:
      'Send a Mailchimp campaign to its audience or schedule it for later delivery. YELLOW authority — sends real emails to subscribers.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID.' },
        schedule_time: { type: 'string', description: 'ISO 8601 datetime to schedule send (omit to send immediately).' },
      },
      required: ['campaign_id'],
    },
    async handler(params) {
      if (params.schedule_time) {
        await mailchimpFetch(`/campaigns/${params.campaign_id}/actions/schedule`, {
          method: 'POST',
          body: JSON.stringify({ schedule_time: params.schedule_time }),
        });
        return { campaign_id: params.campaign_id, scheduled_for: params.schedule_time, message: 'Campaign scheduled' };
      }
      await mailchimpFetch(`/campaigns/${params.campaign_id}/actions/send`, { method: 'POST' });
      return { campaign_id: params.campaign_id, message: 'Campaign sent' };
    },
  },

  {
    name: 'get_campaign_report',
    description: 'Get performance metrics for a sent Mailchimp campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID.' },
      },
      required: ['campaign_id'],
    },
    async handler(params) {
      const data = await mailchimpFetch(`/reports/${params.campaign_id}`);
      const opens = (data.opens ?? {}) as Record<string, unknown>;
      const clicks = (data.clicks ?? {}) as Record<string, unknown>;
      return {
        campaign_id: params.campaign_id,
        emails_sent: data.emails_sent,
        opens: opens.opens_total,
        open_rate: opens.open_rate,
        clicks: clicks.clicks_total,
        click_rate: clicks.click_rate,
        bounces: (data.bounces as Record<string, unknown>)?.hard_bounces,
        unsubscribes: data.unsubscribed,
      };
    },
  },

  {
    name: 'get_campaign_list',
    description: 'List Mailchimp campaigns, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter campaigns by status.', enum: ['sent', 'draft', 'schedule'] },
        count: { type: 'number', description: 'Maximum number of campaigns to return.' },
      },
    },
    async handler(params) {
      const qs = new URLSearchParams();
      if (params.count) qs.set('count', String(params.count));
      if (params.status) qs.set('status', String(params.status));
      const data = await mailchimpFetch(`/campaigns?${qs.toString()}`);
      const campaigns = (data.campaigns as Array<Record<string, unknown>>) ?? [];
      return {
        campaigns: campaigns.map((c) => {
          const settings = (c.settings ?? {}) as Record<string, unknown>;
          return { id: c.id, web_id: c.web_id, title: settings.title, subject: settings.subject_line, status: c.status, send_time: c.send_time, emails_sent: c.emails_sent };
        }),
        total: data.total_items,
      };
    },
  },

  {
    name: 'manage_mailchimp_tags',
    description: 'Add or remove tags for a subscriber in a Mailchimp audience.',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string', description: 'Audience/list ID.' },
        email: { type: 'string', description: 'Subscriber email address.' },
        tags: { type: 'string', description: 'Comma-separated list of tag names.' },
        action: { type: 'string', description: 'Whether to add or remove the tags.', enum: ['add', 'remove'] },
      },
      required: ['list_id', 'email', 'tags', 'action'],
    },
    async handler(params) {
      const hash = createHash('md5').update((params.email as string).toLowerCase().trim()).digest('hex');
      const tagStatus = params.action === 'add' ? 'active' : 'inactive';
      const tagNames = (params.tags as string).split(',').map((t) => t.trim());
      await mailchimpFetch(`/lists/${params.list_id}/members/${hash}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tags: tagNames.map((name) => ({ name, status: tagStatus })) }),
      });
      return { list_id: params.list_id, email: params.email, action: params.action, tags: tagNames, message: `Tags ${params.action === 'add' ? 'added' : 'removed'}` };
    },
  },

  // ─── MANDRILL ──────────────────────────────────────────

  {
    name: 'send_transactional_email',
    description: 'Send a one-off transactional email via Mandrill. NEVER use markdown formatting in the email body.',
    inputSchema: {
      type: 'object',
      properties: {
        to_email: { type: 'string', description: 'Recipient email address.' },
        to_name: { type: 'string', description: 'Recipient display name.' },
        subject: { type: 'string', description: 'Email subject line.' },
        html_content: { type: 'string', description: 'HTML body. Do NOT use markdown.' },
        from_email: { type: 'string', description: 'Sender email address.' },
        from_name: { type: 'string', description: 'Sender display name.' },
        tags: { type: 'string', description: 'Comma-separated tags for tracking.' },
      },
      required: ['to_email', 'subject', 'html_content'],
    },
    async handler(params) {
      const tagList = params.tags ? (params.tags as string).split(',').map((t) => t.trim()) : [];
      const result = await mandrillFetch('/messages/send.json', {
        message: {
          to: [{ email: params.to_email, name: params.to_name ?? '', type: 'to' }],
          subject: params.subject,
          html: params.html_content,
          from_email: params.from_email ?? 'noreply@glyphor.ai',
          from_name: params.from_name ?? 'Glyphor',
          tags: tagList,
        },
      });
      const first = Array.isArray(result) ? (result[0] as Record<string, unknown>) : result;
      return { message_id: first._id, status: first.status, email: first.email };
    },
  },

  {
    name: 'get_mandrill_stats',
    description: 'Get Mandrill sending statistics for a given time range.',
    inputSchema: {
      type: 'object',
      properties: {
        date_range: { type: 'string', description: 'Time range for statistics.', enum: ['7d', '30d', '90d'] },
      },
    },
    async handler(params) {
      const data = (await mandrillFetch('/senders/info.json')) as Record<string, unknown>;
      const rangeKey: Record<string, string> = { '7d': 'stats_7d', '90d': 'stats_90d' };
      const key = rangeKey[params.date_range as string] ?? 'stats_30d';
      const stats = (data[key] ?? data) as Record<string, unknown>;
      return {
        date_range: params.date_range ?? '30d',
        sends: stats.sent,
        opens: stats.opens,
        clicks: stats.clicks,
        bounces: stats.hard_bounces,
        rejects: stats.rejects,
      };
    },
  },

  {
    name: 'search_mandrill_messages',
    description: 'Search Mandrill email history by query, date range, or recipient.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (email address, subject, etc.).' },
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
        date_to: { type: 'string', description: 'End date (YYYY-MM-DD).' },
        limit: { type: 'number', description: 'Maximum number of results.' },
      },
    },
    async handler(params) {
      const body: Record<string, unknown> = { query: params.query ?? '*', limit: params.limit ?? 25 };
      if (params.date_from) body.date_from = params.date_from;
      if (params.date_to) body.date_to = params.date_to;
      const result = await mandrillFetch('/messages/search.json', body);
      const messages = Array.isArray(result) ? result : [];
      return {
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
      };
    },
  },

  {
    name: 'get_mandrill_templates',
    description: 'List available Mandrill email templates.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async handler() {
      const result = await mandrillFetch('/templates/list.json');
      const templates = Array.isArray(result) ? result : [];
      return {
        templates: (templates as Array<Record<string, unknown>>).map((t) => ({
          name: t.name,
          slug: t.slug,
          subject: t.subject,
          labels: t.labels,
          publish_name: t.publish_name,
        })),
        total: templates.length,
      };
    },
  },

  {
    name: 'render_mandrill_template',
    description: 'Render a Mandrill template with merge variables and return the resulting HTML.',
    inputSchema: {
      type: 'object',
      properties: {
        template_name: { type: 'string', description: 'Template name or slug.' },
        merge_vars: { type: 'string', description: 'JSON string of key-value pairs for template merge variables.' },
      },
      required: ['template_name'],
    },
    async handler(params) {
      let templateContent: Array<{ name: string; content: string }> = [];
      if (params.merge_vars) {
        const parsed = JSON.parse(params.merge_vars as string) as Record<string, string>;
        templateContent = Object.entries(parsed).map(([name, content]) => ({ name, content }));
      }
      const data = (await mandrillFetch('/templates/render.json', {
        template_name: params.template_name,
        template_content: templateContent,
        merge_vars: [],
      })) as Record<string, unknown>;
      return { template_name: params.template_name, html: data.html };
    },
  },
];
