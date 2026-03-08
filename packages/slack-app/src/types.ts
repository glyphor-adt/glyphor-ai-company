// Slack-facing type definitions for the slack-app server.

// ─── Slack API envelope types ────────────────────────────────────────────────

export interface SlackEvent {
  type: string;
  team_id?: string;
  api_app_id?: string;
  event?: SlackInnerEvent;
  event_id?: string;
  event_time?: number;
  // URL verification
  challenge?: string;
  token?: string;
}

export interface SlackInnerEvent {
  type: string;
  user?: string;
  text?: string;
  ts?: string;
  channel?: string;
  channel_type?: string;
  bot_id?: string;
  thread_ts?: string;
  files?: SlackFile[];
  [key: string]: unknown;
}

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  url_private: string;
  size: number;
}

export interface SlackInteractionPayload {
  type: string;
  team: { id: string; domain: string };
  user: { id: string; username: string; name: string };
  trigger_id?: string;
  view?: SlackView;
  actions?: SlackAction[];
  callback_id?: string;
  response_url?: string;
}

export interface SlackView {
  id: string;
  type: string;
  callback_id?: string;
  state?: { values: Record<string, Record<string, SlackBlockValue>> };
}

export interface SlackBlockValue {
  type: string;
  value?: string;
  selected_option?: { value: string; text: { text: string } };
}

export interface SlackAction {
  action_id: string;
  block_id?: string;
  type: string;
  value?: string;
  selected_option?: { value: string };
}

// ─── Customer tenant DB row ──────────────────────────────────────────────────

export interface DbCustomerTenant {
  id: string;
  tenant_id: string;
  slack_team_id: string;
  slack_team_name: string;
  bot_user_id: string | null;
  bot_token: string;
  app_token: string | null;
  signing_secret: string;
  default_channel: string | null;
  scopes: string[];
  status: 'active' | 'paused' | 'revoked';
  installed_by: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbCustomerKnowledge {
  id: string;
  tenant_id: string;
  section: string;
  title: string;
  content: string;
  content_type: 'text' | 'markdown' | 'html' | 'json';
  audience: string;
  tags: string[];
  is_active: boolean;
  version: number;
  last_edited_by: string;
  created_at: string;
  updated_at: string;
}

export interface DbCustomerContent {
  id: string;
  tenant_id: string;
  customer_tenant_id: string | null;
  kind: 'file' | 'thread_summary' | 'document' | 'snippet' | 'faq' | 'note';
  title: string | null;
  body: string;
  source_url: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_file_id: string | null;
  mime_type: string | null;
  byte_size: number | null;
  submitted_by: string | null;
  processed_at: string | null;
  status: 'pending' | 'processing' | 'processed' | 'failed' | 'archived';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbSlackApproval {
  id: string;
  tenant_id: string;
  customer_tenant_id: string | null;
  content_id: string | null;
  kind: 'message' | 'file' | 'request' | 'escalation';
  destination: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  decision_by: string | null;
  decision_at: string | null;
  decision_reason: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}
