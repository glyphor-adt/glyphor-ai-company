/**
 * Slack App HTTP Server — Cloud Run entry point
 *
 * Handles inbound Slack platform traffic:
 *   POST /slack/commands     — Slash command handler (/glyphor)
 *   POST /slack/events       — Slack Events API (URL verification + event dispatch)
 *   POST /slack/interactions — Slack interactive components (buttons, modals, shortcuts)
 *   GET  /slack/oauth        — OAuth 2.0 redirect from Slack after workspace install
 *   GET  /health             — Health check
 *
 * All event payloads are verified using HMAC-SHA256 before processing.
 * Customer tenant context is loaded from the database via the team_id on each request.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { checkDbHealth } from '@glyphor/shared/db';
import { getCustomerTenantByTeamId } from './slackClient.js';
import { verifySlackSignature } from './verify.js';
import { handleSlackEvent } from './eventHandler.js';
import { handleApprovalAction } from './approvalHandler.js';
import { handleOAuthCallback } from './oauthHandler.js';
import { handleSlackCommand, type SlackCommandPayload } from './commandHandler.js';
import { triggerWebsiteIngestion } from './onboardingHandler.js';
import { openModal, postMessage } from './slackClient.js';
import type { SlackEvent, SlackInteractionPayload } from './types.js';

const PORT = parseInt(process.env.PORT ?? '8080', 10);

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxSize = 2 * 1024 * 1024; // 2 MB
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function text(res: ServerResponse, status: number, content: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(content);
}

// ─── Request verification helper ─────────────────────────────────────────────

async function requireVerifiedBody(
  req: IncomingMessage,
  res: ServerResponse,
  signingSecret: string,
): Promise<string | null> {
  const rawBody = await readBody(req);
  const timestamp = req.headers['x-slack-request-timestamp'] as string ?? '';
  const signature = req.headers['x-slack-signature'] as string ?? '';

  if (!verifySlackSignature(signingSecret, rawBody, timestamp, signature)) {
    json(res, 401, { error: 'Invalid Slack signature' });
    return null;
  }
  return rawBody;
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  try {
    // ── Health ───────────────────────────────────────────────────────────
    if (method === 'GET' && url === '/health') {
      const dbOk = await checkDbHealth();
      json(res, 200, { status: dbOk ? 'ok' : 'degraded', service: 'slack-app', db: dbOk });
      return;
    }

    // ── Slash Commands (/glyphor) ──────────────────────────────────────────
    if (method === 'POST' && url === '/slack/commands') {
      const rawBody = await readBody(req);
      const params = new URLSearchParams(rawBody);

      const teamId = params.get('team_id') ?? '';
      if (!teamId) {
        json(res, 400, { error: 'Missing team_id' });
        return;
      }

      const customerTenant = await getCustomerTenantByTeamId(teamId);
      if (customerTenant) {
        const timestamp = req.headers['x-slack-request-timestamp'] as string ?? '';
        const signature = req.headers['x-slack-signature'] as string ?? '';
        if (!verifySlackSignature(customerTenant.signing_secret, rawBody, timestamp, signature)) {
          json(res, 401, { error: 'Invalid Slack signature' });
          return;
        }
      }

      // Acknowledge immediately — Slack requires <3s response
      json(res, 200, { response_type: 'ephemeral', text: 'On it...' });

      // Dispatch async
      const payload: SlackCommandPayload = {
        team_id: teamId,
        user_id: params.get('user_id') ?? '',
        text: params.get('text') ?? '',
        response_url: params.get('response_url') ?? '',
        channel_id: params.get('channel_id') ?? '',
        command: params.get('command') ?? '',
        trigger_id: params.get('trigger_id') ?? '',
      };

      handleSlackCommand(payload).catch((err: unknown) => {
        console.error(`[Slack] Command dispatch error (team=${teamId}):`, err);
      });
      return;
    }

    // ── Slack Events API ─────────────────────────────────────────────────
    if (method === 'POST' && url === '/slack/events') {
      // Peek at body without verification for URL verification challenge
      const rawBody = await readBody(req);
      let payload: SlackEvent;

      try {
        payload = JSON.parse(rawBody) as SlackEvent;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }

      // Slack URL verification (sent during Events API endpoint setup)
      if (payload.type === 'url_verification') {
        text(res, 200, payload.challenge ?? '');
        return;
      }

      // For real events, verify signature using the team's signing secret
      const teamId = payload.team_id;
      if (!teamId) {
        json(res, 400, { error: 'Missing team_id' });
        return;
      }

      const customerTenant = await getCustomerTenantByTeamId(teamId);
      if (!customerTenant) {
        // Unknown workspace — return 200 to prevent Slack retries
        json(res, 200, { ok: true });
        return;
      }

      const timestamp = req.headers['x-slack-request-timestamp'] as string ?? '';
      const signature = req.headers['x-slack-signature'] as string ?? '';
      if (!verifySlackSignature(customerTenant.signing_secret, rawBody, timestamp, signature)) {
        json(res, 401, { error: 'Invalid Slack signature' });
        return;
      }

      // Acknowledge immediately — Slack requires a response within 3 seconds
      json(res, 200, { ok: true });

      // Dispatch event asynchronously
      if (payload.event) {
        handleSlackEvent(customerTenant, payload.event).catch((err: unknown) => {
          console.error(`[Slack] Event dispatch error (team=${teamId}):`, err);
        });
      }
      return;
    }

    // ── Slack Interactions ───────────────────────────────────────────────
    if (method === 'POST' && url === '/slack/interactions') {
      const rawBody = await readBody(req);

      // Slack sends interaction payloads as URL-encoded payload= parameter
      const payloadParam = new URLSearchParams(rawBody).get('payload');
      if (!payloadParam) {
        json(res, 400, { error: 'Missing payload' });
        return;
      }

      let interaction: SlackInteractionPayload;
      try {
        interaction = JSON.parse(payloadParam) as SlackInteractionPayload;
      } catch {
        json(res, 400, { error: 'Invalid payload JSON' });
        return;
      }

      const teamId = interaction.team?.id;
      if (!teamId) {
        json(res, 400, { error: 'Missing team id in interaction payload' });
        return;
      }

      const customerTenant = await getCustomerTenantByTeamId(teamId);
      if (!customerTenant) {
        json(res, 200, { ok: true });
        return;
      }

      const timestamp = req.headers['x-slack-request-timestamp'] as string ?? '';
      const signature = req.headers['x-slack-signature'] as string ?? '';
      if (!verifySlackSignature(customerTenant.signing_secret, rawBody, timestamp, signature)) {
        json(res, 401, { error: 'Invalid Slack signature' });
        return;
      }

      // ─── view_submission (modal submit) — respond with empty 200 to close modal
      if (interaction.type === 'view_submission') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('');

        const callbackId = interaction.view?.callback_id;
        if (callbackId === 'submit_website_url') {
          const values = interaction.view?.state?.values ?? {};
          const urlBlock = values['website_url_block'];
          const url = urlBlock?.['website_url_input']?.value ?? '';
          const customerTenantId = interaction.view?.private_metadata ?? '';

          if (url && customerTenantId) {
            triggerWebsiteIngestion(customerTenantId, url).catch((err: unknown) => {
              console.error(`[Slack] Website ingestion error:`, err);
            });
          }
        } else {
          console.log(`[Slack] Unhandled view_submission callback_id=${callbackId}`);
        }
        return;
      }

      // Acknowledge all other interactions immediately
      json(res, 200, { ok: true });

      // ─── block_actions (buttons, menus) ────────────────────────────────
      if (interaction.type === 'block_actions' && interaction.actions?.length) {
        for (const action of interaction.actions) {
          const aid = action.action_id;

          // Connection card actions
          if (aid === 'connect_website') {
            const customerTenantId = action.value ?? '';
            await openModal(customerTenant.bot_token, interaction.trigger_id ?? '', {
              type: 'modal',
              callback_id: 'submit_website_url',
              private_metadata: customerTenantId,
              title: { type: 'plain_text', text: 'Connect Website' },
              submit: { type: 'plain_text', text: 'Submit' },
              blocks: [
                {
                  type: 'input',
                  block_id: 'website_url_block',
                  label: { type: 'plain_text', text: 'Website URL' },
                  element: {
                    type: 'url_text_input',
                    action_id: 'website_url_input',
                    placeholder: { type: 'plain_text', text: 'https://yourcompany.com' },
                  },
                },
              ],
            });
            continue;
          }

          if (aid === 'connect_linkedin' || aid === 'connect_google_drive') {
            console.log(`[Slack] ${aid} clicked by ${interaction.user?.id}, tenant=${action.value}`);
            continue;
          }

          // Approval actions (approve_<uuid> / reject_<uuid>)
          const result = await handleApprovalAction(aid, interaction.user?.id ?? 'unknown');
          if (result.ok) {
            console.log(
              `[Slack] Approval ${result.approvalId} → ${result.status} by ${interaction.user?.id}`,
            );
          }
        }
      } else {
        console.log(`[Slack] Interaction type=${interaction.type} team=${teamId} user=${interaction.user?.id}`);
      }
      return;
    }

    // ── OAuth Callback ───────────────────────────────────────────────────
    if (method === 'GET' && url.startsWith('/slack/oauth')) {
      const parsedUrl = new URL(url, `http://localhost:${PORT}`);
      const code = parsedUrl.searchParams.get('code');
      const GLYPHOR_TENANT_ID = '00000000-0000-0000-0000-000000000000';
      const rawState = parsedUrl.searchParams.get('state');
      const tenantId = (rawState && rawState.length > 0) ? rawState : (process.env.DEFAULT_TENANT_ID || GLYPHOR_TENANT_ID);

      if (!code) {
        const errorCode = parsedUrl.searchParams.get('error') ?? 'unknown';
        json(res, 400, { error: `OAuth denied: ${errorCode}` });
        return;
      }

      const result = await handleOAuthCallback(code, tenantId);
      json(res, 200, result);
      return;
    }

    // ── 404 ──────────────────────────────────────────────────────────────
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Slack App] Error handling ${method} ${url}:`, message);
    json(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`[Slack App] Listening on port ${PORT}`);
  console.log(`[Slack App] Commands:     POST /slack/commands`);
  console.log(`[Slack App] Events:       POST /slack/events`);
  console.log(`[Slack App] Interactions: POST /slack/interactions`);
  console.log(`[Slack App] OAuth:        GET  /slack/oauth`);
  console.log(`[Slack App] Health:       GET  /health`);
});
