/**
 * Voice Gateway Server — Cloud Run entry point
 *
 * HTTP server handling voice session management for both
 * Dashboard (WebRTC) and Teams (Graph) modes.
 *
 * Endpoints:
 *   POST /voice/dashboard              — Create dashboard voice session
 *   POST /voice/dashboard/end          — End dashboard voice session
 *   POST /voice/dashboard/transcript   — Record transcript entry
 *   POST /voice/teams/join             — Join agent to Teams meeting
 *   POST /voice/teams/leave            — Remove agent from Teams meeting
 *   POST /voice/teams/callback         — Graph Communications API callbacks
 *   GET  /voice/calendar/webhook       — Graph webhook validation handshake
 *   POST /voice/calendar/webhook       — Graph calendar change notifications
 *   GET  /voice/calendar/subscriptions — List active calendar webhook subscriptions
 *   GET  /voice/sessions               — List active voice sessions
 *   GET  /voice/usage                  — Get daily usage summary
 *   GET  /health                       — Health check
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import OpenAI, { AzureOpenAI } from 'openai';
import { SessionManager } from './sessionManager.js';
import { DashboardVoiceHandler } from './dashboardHandler.js';
import { TeamsCallHandler } from './teamsHandler.js';
import { AcsCallAutomationClient, parseAcsConnectionString } from './acsMediaClient.js';
import { CalendarWatcher } from './calendarWatcher.js';
import { CalendarWebhookManager, type GraphChangePayload } from '@glyphor/integrations';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';

const PORT = parseInt(process.env.PORT || '8090', 10);

// ─── OpenAI ─────────────────────────────────────────────────────
// Use Azure OpenAI when configured, otherwise direct OpenAI
const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
const openai: OpenAI = (azureEndpoint && azureApiKey)
  ? new AzureOpenAI({ endpoint: azureEndpoint, apiKey: azureApiKey, apiVersion: '2025-04-01-preview' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Session Manager ────────────────────────────────────────────
const sessions = new SessionManager();
sessions.onAutoEnd = (session) => {
  console.log(`[Voice] Auto-ended session ${session.id} (${session.agentRole}) after timeout`);
};

// ─── Handlers ───────────────────────────────────────────────────
const dashboardHandler = new DashboardVoiceHandler(openai, sessions);

let teamsHandler: TeamsCallHandler | null = null;
let calendarWatcher: CalendarWatcher | null = null;
let calendarWebhookManager: CalendarWebhookManager | null = null;
const botAppId = process.env.BOT_APP_ID;
const botAppSecret = process.env.BOT_APP_SECRET;
const tenantId = process.env.AZURE_TENANT_ID ?? process.env.BOT_TENANT_ID;
const gatewayUrl = process.env.VOICE_GATEWAY_URL ?? `http://localhost:${PORT}`;

// ─── ACS Call Automation (optional — enables bidirectional audio) ──
let acsClient: AcsCallAutomationClient | undefined;
const acsConnectionString = process.env.ACS_CONNECTION_STRING;
if (acsConnectionString) {
  try {
    const acsConfig = parseAcsConnectionString(acsConnectionString);
    acsClient = new AcsCallAutomationClient(acsConfig);
    console.log('[Voice] ACS Call Automation enabled (bidirectional audio)');
  } catch (err) {
    console.warn(`[Voice] Invalid ACS_CONNECTION_STRING: ${err}`);
  }
}

if (botAppId && botAppSecret && tenantId) {
  teamsHandler = new TeamsCallHandler(
    { appId: botAppId, appSecret: botAppSecret, tenantId },
    openai,
    sessions,
    gatewayUrl,
    acsClient,
  );
  console.log(`[Voice] Teams call handler initialized (${acsClient ? 'ACS + audio bridge' : 'Graph only — no audio'})`);

  // ─── Calendar Watcher — auto-join meetings agents are invited to ──
  calendarWatcher = new CalendarWatcher(
    { appId: botAppId, appSecret: botAppSecret, tenantId },
    teamsHandler,
  );
  calendarWatcher.start();

  // ─── Calendar Webhooks — real-time push from Graph ──
  // Requires HTTPS endpoint reachable by Microsoft Graph.
  // Falls back gracefully to polling-only if webhook setup fails.
  const webhookUrl = `${gatewayUrl}/voice/calendar/webhook`;
  if (gatewayUrl.startsWith('https://')) {
    calendarWebhookManager = new CalendarWebhookManager(
      { appId: botAppId, appSecret: botAppSecret, tenantId },
      webhookUrl,
    );
    // Subscribe to all agent calendars asynchronously
    const agents = calendarWatcher.getWatchedAgents();
    calendarWebhookManager
      .subscribeAll(agents)
      .then(() => calendarWebhookManager!.startAutoRenewal())
      .catch((err) =>
        console.warn('[Voice] Calendar webhook subscription failed (polling still active):', err),
      );
  } else {
    console.log('[Voice] Calendar webhooks disabled (requires HTTPS gateway URL). Polling-only mode.');
  }
} else {
  console.log('[Voice] Teams call handler disabled (missing BOT_APP_ID, BOT_APP_SECRET, or AZURE_TENANT_ID)');
}

// ─── HTTP helpers ───────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxSize = 1024 * 1024; // 1MB limit
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
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function cors(res: ServerResponse): void {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end();
}

// ─── Server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  // CORS preflight
  if (method === 'OPTIONS') {
    cors(res);
    return;
  }

  try {
    // ── Health ───────────────────────────────────────────────
    if (method === 'GET' && url === '/health') {
      json(res, 200, {
        status: 'ok',
        service: 'voice-gateway',
        activeSessions: sessions.getActiveSessions().length,
        teamsEnabled: !!teamsHandler,
      });
      return;
    }

    // ── Dashboard: Create voice session ─────────────────────
    if (method === 'POST' && url === '/voice/dashboard') {
      const body = JSON.parse(await readBody(req));
      const { agentRole, userId, chatId } = body;

      if (!agentRole || !userId) {
        json(res, 400, { error: 'agentRole and userId are required' });
        return;
      }

      const result = await dashboardHandler.createSession({
        agentRole: agentRole as CompanyAgentRole,
        userId,
        chatId,
      });

      json(res, 200, result);
      return;
    }

    // ── Dashboard: End voice session ────────────────────────
    if (method === 'POST' && url === '/voice/dashboard/end') {
      const body = JSON.parse(await readBody(req));
      const { sessionId } = body;

      if (!sessionId) {
        json(res, 400, { error: 'sessionId is required' });
        return;
      }

      await dashboardHandler.endSession(sessionId);
      json(res, 200, { ok: true });
      return;
    }

    // ── Dashboard: Record transcript ────────────────────────
    if (method === 'POST' && url === '/voice/dashboard/transcript') {
      const body = JSON.parse(await readBody(req));
      const { sessionId, role, text } = body;

      if (!sessionId || !role || !text) {
        json(res, 400, { error: 'sessionId, role, and text are required' });
        return;
      }

      dashboardHandler.addTranscript(sessionId, role, text);
      json(res, 200, { ok: true });
      return;
    }

    // ── Teams: Join meeting ─────────────────────────────────
    if (method === 'POST' && url === '/voice/teams/join') {
      if (!teamsHandler) {
        json(res, 503, { error: 'Teams voice not configured (missing BOT_APP_ID / BOT_APP_SECRET / AZURE_TENANT_ID)' });
        return;
      }

      const body = JSON.parse(await readBody(req));
      const { agentRole, meetingUrl, invitedBy } = body;

      if (!agentRole || !meetingUrl) {
        json(res, 400, { error: 'agentRole and meetingUrl are required' });
        return;
      }

      const result = await teamsHandler.joinMeeting({
        agentRole: agentRole as CompanyAgentRole,
        meetingUrl,
        invitedBy,
      });

      json(res, 200, result);
      return;
    }

    // ── Teams: Leave meeting ────────────────────────────────
    if (method === 'POST' && url === '/voice/teams/leave') {
      if (!teamsHandler) {
        json(res, 503, { error: 'Teams voice not configured' });
        return;
      }

      const body = JSON.parse(await readBody(req));
      const { sessionId } = body;

      if (!sessionId) {
        json(res, 400, { error: 'sessionId is required' });
        return;
      }

      await teamsHandler.leaveMeeting({ sessionId });
      json(res, 200, { ok: true });
      return;
    }

    // ── Teams: Graph Communications callback ────────────────
    if (method === 'POST' && url === '/voice/teams/callback') {
      if (!teamsHandler) {
        json(res, 200, { ok: true });
        return;
      }

      const body = JSON.parse(await readBody(req));
      await teamsHandler.handleCallback(body);
      json(res, 200, { ok: true });
      return;
    }

    // ── Teams: ACS Call Automation callback ──────────────────
    if (method === 'POST' && url === '/voice/teams/acs-callback') {
      if (!teamsHandler) {
        json(res, 200, { ok: true });
        return;
      }

      const body = JSON.parse(await readBody(req));
      // ACS sends CloudEvents as an array
      const events = Array.isArray(body) ? body : [body];
      await teamsHandler.handleAcsCallback(events);
      json(res, 200, { ok: true });
      return;
    }

    // ── Active sessions ─────────────────────────────────────
    if (method === 'GET' && url === '/voice/sessions') {
      const active = sessions.getActiveSessions().map((s) => ({
        id: s.id,
        agentRole: s.agentRole,
        mode: s.mode,
        durationSec: s.durationSec,
        userId: s.userId,
      }));
      json(res, 200, { sessions: active });
      return;
    }

    // ── Usage summary ───────────────────────────────────────
    if (method === 'GET' && url === '/voice/usage') {
      json(res, 200, sessions.getDailyUsage());
      return;
    }

    // ── Calendar Webhook: Graph validation handshake ──────────
    // Graph sends GET with ?validationToken=... when creating a subscription.
    // We must echo it back as text/plain to prove we own the endpoint.
    if (method === 'GET' && url.startsWith('/voice/calendar/webhook')) {
      const parsedUrl = new URL(url, `http://localhost:${PORT}`);
      const validationToken = parsedUrl.searchParams.get('validationToken');
      if (validationToken) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(validationToken);
        return;
      }
      json(res, 200, { status: 'calendar webhook endpoint active' });
      return;
    }

    // ── Calendar Webhook: Graph change notifications ────────
    if (method === 'POST' && url === '/voice/calendar/webhook') {
      if (!calendarWebhookManager || !calendarWatcher) {
        json(res, 200, { ok: true }); // Always 200 to Graph
        return;
      }

      const body = JSON.parse(await readBody(req)) as GraphChangePayload;

      // Respond immediately — process async (Graph requires fast 202/200)
      json(res, 202, { ok: true });

      for (const notification of body.value ?? []) {
        const email = calendarWebhookManager.processNotification(notification);
        if (email) {
          calendarWatcher.checkAgentNow(email).catch((err) => {
            console.error(`[Voice] Calendar webhook check failed for ${email}:`, err);
          });
        }
      }
      return;
    }

    // ── Calendar Webhook: list active subscriptions ─────────
    if (method === 'GET' && url === '/voice/calendar/subscriptions') {
      const subs = calendarWebhookManager?.getActiveSubscriptions() ?? [];
      json(res, 200, {
        webhooksEnabled: !!calendarWebhookManager,
        pollingEnabled: !!calendarWatcher,
        subscriptions: subs.map((s) => ({
          userEmail: s.userEmail,
          expirationDateTime: s.expirationDateTime,
        })),
      });
      return;
    }

    // ── 404 ─────────────────────────────────────────────────
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Voice] Error handling ${method} ${url}:`, message);
    json(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`[Voice Gateway] Listening on port ${PORT}`);
  console.log(`[Voice Gateway] Dashboard voice: POST /voice/dashboard`);
  console.log(`[Voice Gateway] Teams voice: POST /voice/teams/join`);
  console.log(`[Voice Gateway] Media stream: ws://.../ws/media/{sessionId}`);
  console.log(`[Voice Gateway] Health: GET /health`);
});

// ─── WebSocket server for media streams ─────────────────────
// Media transports (ACS, custom bridges) connect here to pipe
// bidirectional audio to the OpenAI Realtime bridge.
// URL: /ws/media/{sessionId}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = req.url ?? '';
  const match = url.match(/^\/ws\/media\/([a-f0-9-]+)$/i);

  if (!match) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  if (!teamsHandler) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }

  const sessionId = match[1];
  const bridge = teamsHandler.getBridge(sessionId);

  if (!bridge) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  if (!bridge.isWaitingForMedia) {
    socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log(`[Voice Gateway] Media transport connected for session ${sessionId}`);
    bridge.attachMediaStream(ws);
  });
});
