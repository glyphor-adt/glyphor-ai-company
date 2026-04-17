/**
 * Agent 365 MCP Tools — Async factory for Microsoft Agent 365 MCP servers
 *
 * Enable with env var: AGENT365_ENABLED=true
 * Required env vars: AGENT365_CLIENT_ID, AGENT365_TENANT_ID, AGENT365_CLIENT_SECRET
 * Required env vars: AGENT365_APP_INSTANCE_ID, AGENT365_AGENTIC_USER_ID
 * Optional: AGENT365_BLUEPRINT_ID
 * Optional per-agent overrides:
 *   AGENT365_<ROLE>_CLIENT_ID
 *   AGENT365_<ROLE>_CLIENT_SECRET
 *   AGENT365_<ROLE>_TENANT_ID
 */

import {
  type ToolDefinition,
  type CompanyAgentRole,
  AGENT_EMAIL_MAP,
  appendGlyphorEmailSignature,
  isGlyphorInternalEmail,
} from '@glyphor/agent-runtime';
import { getAgentBlueprintSpId, getAgentEntraUserId } from '@glyphor/agent-runtime';
import type { Agent365ToolBridge } from '@glyphor/integrations';
import {
  createAgent365Tools as initAgent365Bridge,
  getAgenticGraphToken,
  logMicrosoftWriteAudit,
  resolveSharePointGraphToken,
} from '@glyphor/integrations';

// ── Standard M365 MCP Servers ────────────────────────────────────

/** Core Microsoft Agent 365 MCP servers currently covered by existing smoke checks. */
export const STANDARD_M365_SERVERS = [
  'mcp_MailTools',
  'mcp_CalendarTools',
  'mcp_ODSPRemoteServer',
  'mcp_TeamsServer',
  'mcp_M365Copilot',
  'mcp_WordServer',
] as const;

const LIVE_ROLE_M365_ALLOWLISTS: Partial<Record<CompanyAgentRole, readonly string[]>> = {
  'chief-of-staff': ['mcp_TeamsServer', 'mcp_CalendarTools'],
  'cto': [],
  'cfo': [],
  'cpo': [],
  'cmo': [],
  'vp-design': [],
  'ops': ['mcp_TeamsServer'],
  'vp-research': [],
};

/** SharePoint / OneDrive MCP — loaded for every agent when Agent365 is on (company standard). */
const AGENT365_ODSP_SERVER = 'mcp_ODSPRemoteServer' as const;

/** Mail MCP — loaded with ODSP so inbox/mail flows use Agent365, not Graph fallbacks. */
const AGENT365_MAIL_SERVER = 'mcp_MailTools' as const;

/** Unknown roles get ODSP + Mail; explicit serverFilter still overrides this. */
function getDefaultAgent365Servers(agentRole?: string): readonly string[] {
  if (!agentRole) return [];
  const base = [...(LIVE_ROLE_M365_ALLOWLISTS[agentRole as CompanyAgentRole] ?? [])];
  if (!base.includes(AGENT365_ODSP_SERVER)) {
    base.push(AGENT365_ODSP_SERVER);
  }
  if (!base.includes(AGENT365_MAIL_SERVER)) {
    base.push(AGENT365_MAIL_SERVER);
  }
  return [...new Set(base)];
}

// ── Singleton Bridge ─────────────────────────────────────────────

const activeBridges = new Map<string, Agent365ToolBridge>();

function getBridgeCacheKey(agentRole?: string): string {
  return agentRole ?? '__default__';
}

function resolveAgent365Credentials(_agentRole?: string): {
  clientId: string;
  clientSecret: string;
  tenantId: string;
} | null {
  // Always use shared credentials — per-agent Entra apps are regular directory
  // users, not agentic users created by Teams agent installation, so the 3-step
  // MsalTokenProvider flow fails when per-agent client IDs are used.
  const clientId = process.env.AGENT365_CLIENT_ID;
  const clientSecret = process.env.AGENT365_CLIENT_SECRET ?? '';
  const tenantId = process.env.AGENT365_TENANT_ID;

  if (!clientId || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
}

// ── Public Factory ───────────────────────────────────────────────

/**
 * Connect to Agent 365 MCP servers and return discovered tools as ToolDefinitions.
 * Uses Agent Identity Authentication (client-credentials-only, no refresh token).
 *
 * @param serverFilter Optional list of MCP server names to load.
 *                     Defaults to the live-roster role allowlist; unknown roles get no default access.
 *
 * Returns an empty array if:
 *   - AGENT365_ENABLED is not 'true'
 *   - Required env vars are missing
 *   - MCP server connection fails (logs error, doesn't crash)
 */
export async function createAgent365McpTools(agentRoleOrServerFilter?: string | string[], maybeServerFilter?: string[]): Promise<ToolDefinition[]> {
  if (process.env.AGENT365_ENABLED !== 'true') {
    return [];
  }

  const agentRole = typeof agentRoleOrServerFilter === 'string' ? agentRoleOrServerFilter : undefined;
  const serverFilter = Array.isArray(agentRoleOrServerFilter)
    ? agentRoleOrServerFilter
    : (maybeServerFilter ?? [...getDefaultAgent365Servers(agentRole)]);
  const credentials = resolveAgent365Credentials(agentRole);
  const cacheKey = getBridgeCacheKey(agentRole);

  if (!credentials) {
    console.warn('[Agent365] AGENT365_ENABLED=true but AGENT365_CLIENT_ID or AGENT365_TENANT_ID missing. Skipping.');
    return [];
  }

  const cachedBridge = activeBridges.get(cacheKey);
  if (cachedBridge) {
    return cachedBridge.tools;
  }

  // Resolve per-agent identity from agentIdentities.json; fall back to shared env vars.
  // Each agent has its own agentic user (own mailbox, UPN, calendar) created by
  // the Teams agent installation. blueprintSpId = agentAppInstanceId, entraUserId = agenticUserId.
  const agentAppInstanceId = (agentRole ? getAgentBlueprintSpId(agentRole) : null)
    ?? process.env.AGENT365_APP_INSTANCE_ID;
  const agenticUserId = (agentRole ? getAgentEntraUserId(agentRole) : null)
    ?? process.env.AGENT365_AGENTIC_USER_ID;

  if (!agentAppInstanceId || !agenticUserId) {
    console.warn(`[Agent365] No identity found for agent ${agentRole ?? 'unknown'}. Set blueprintSpId/entraUserId in agentIdentities.json or AGENT365_APP_INSTANCE_ID/AGENT365_AGENTIC_USER_ID env vars. Skipping (no Graph mail fallbacks).`);
    return [];
  }

  if (agentRole) {
    console.log(`[Agent365] Using per-agent identity for ${agentRole}: instanceId=${agentAppInstanceId.slice(0, 8)}…`);
  }

  const MCP_INIT_TIMEOUT_MS = 30_000;

  try {
    const senderMailbox = agentRole ? AGENT_EMAIL_MAP[agentRole as CompanyAgentRole]?.email : undefined;
    const bridgePromise = initAgent365Bridge({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      tenantId: credentials.tenantId,
      agenticAppId: process.env.AGENT365_BLUEPRINT_ID,
      agentAppInstanceId,
      agenticUserId,
      senderEmail: senderMailbox,
    }, serverFilter);

    // Timeout guard: if MCP init hangs, fail fast instead of substituting Graph mail tools
    const bridge = await Promise.race([
      bridgePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Agent365 MCP init timed out after ${MCP_INIT_TIMEOUT_MS}ms`)), MCP_INIT_TIMEOUT_MS),
      ),
    ]);

    const tools: ToolDefinition[] = bridge.tools.map((tool): ToolDefinition => {
      const mapped: ToolDefinition = { ...tool, deferLoading: true };
      // Strip attachmentUris from MCP send_email — the MCP server can't resolve
      // SharePoint URIs. Agents should use reply_email_with_attachments instead.
      if (tool.name === 'send_email' && mapped.parameters && 'attachmentUris' in mapped.parameters) {
        const { attachmentUris: _removed, ...rest } = mapped.parameters;
        mapped.parameters = rest;
        mapped.description = (mapped.description ?? '') +
          ' NOTE: This tool cannot send attachments. For emails with attachments, use reply_email_with_attachments.';
      }
      // Annotate reply_to_email — it also can't handle attachments via MCP.
      if (tool.name === 'reply_to_email') {
        mapped.description = (mapped.description ?? '') +
          ' NOTE: This tool does NOT support attachments. To reply with attachments, use reply_email_with_attachments.';
      }
      return mapped;
    });
    // reply_email_with_attachments: MCP send_email / reply_to_email cannot attach SharePoint files.
    // Download uses agentic Graph; sendMail uses the same agentic Graph token (no app-only mail).
    if (agentRole) {
      const mailbox = AGENT_EMAIL_MAP[agentRole as CompanyAgentRole]?.email;
      if (mailbox) {
        tools.push(createSendEmailWithAttachmentTool(mailbox, agentRole as CompanyAgentRole));
        console.log(`[Agent365] Added reply_email_with_attachments for ${agentRole} (${mailbox})`);
      }
    }

    activeBridges.set(cacheKey, { ...bridge, tools });
    console.log(`[Agent365] Initialized ${tools.length} MCP tools`);
    return tools;
  } catch (err) {
    console.error('[Agent365] Failed to initialize MCP bridge:', (err as Error).message);
    return [];
  }
}

// ── Email with Attachments (agentic Graph sendMail) ─────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Download a file from SharePoint by path or webUrl and return base64 bytes.
 * Uses the same Agent365 agentic Graph token as native SharePoint tools (no AZURE_FILES).
 */
async function downloadSharePointFileForAttachment(
  filePathOrUrl: string,
  agentRole: CompanyAgentRole,
): Promise<{ contentBytes: string; contentType: string; name: string }> {
  const { token } = await resolveSharePointGraphToken('read_sharepoint', agentRole);
  const siteId = (process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  // If it's a SharePoint webUrl, extract the file path from it.
  // URLs may have %20 for spaces, so decode first before matching.
  let filePath = filePathOrUrl;
  const decoded = decodeURIComponent(filePathOrUrl);
  const spUrlMatch = decoded.match(/\/Shared\s+Documents\/(.+)$/i);
  if (spUrlMatch) {
    filePath = spUrlMatch[1]; // already decoded
    console.log(`[downloadSharePointFile] Extracted path from URL: "${filePath}"`);
  } else {
    console.log(`[downloadSharePointFile] Using raw path: "${filePath}"`);
  }

  // Encode site ID preserving commas
  const encodedSiteId = siteId.split(',').map(encodeURIComponent).join(',');

  // Get drive ID
  const driveRes = await fetch(
    `${GRAPH_BASE}/sites/${encodedSiteId}/drive`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!driveRes.ok) throw new Error(`Failed to get drive: ${await driveRes.text()}`);
  const driveData = (await driveRes.json()) as { id: string };
  const driveId = encodeURIComponent(driveData.id).replace(/%21/g, '!');

  // Try to resolve the file metadata
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const metaRes = await fetch(
    `${GRAPH_BASE}/sites/${encodedSiteId}/drives/${driveId}/root:/${encodedPath}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!metaRes.ok) {
    // Fallback: search by filename
    const fileName = filePath.split('/').pop() ?? filePath;
    const searchRes = await fetch(
      `${GRAPH_BASE}/sites/${encodedSiteId}/drives/${driveId}/root/search(q='${encodeURIComponent(fileName)}')`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!searchRes.ok) throw new Error(`File not found: ${filePath}`);
    const searchData = (await searchRes.json()) as { value: Array<{ id: string; name: string; file?: { mimeType?: string } }> };
    const match = searchData.value.find(
      (item) => item.name.toLowerCase() === fileName.toLowerCase(),
    );
    if (!match) throw new Error(`File not found in search: ${fileName}`);

    const contentRes = await fetch(
      `${GRAPH_BASE}/sites/${encodedSiteId}/drives/${driveId}/items/${encodeURIComponent(match.id)}/content`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!contentRes.ok) throw new Error(`Failed to download: ${await contentRes.text()}`);
    const buffer = Buffer.from(await contentRes.arrayBuffer());
    return {
      contentBytes: buffer.toString('base64'),
      contentType: match.file?.mimeType ?? 'application/octet-stream',
      name: match.name,
    };
  }

  const meta = (await metaRes.json()) as { id: string; name: string; file?: { mimeType?: string } };
  const contentRes = await fetch(
    `${GRAPH_BASE}/sites/${encodedSiteId}/drives/${driveId}/items/${encodeURIComponent(meta.id)}/content`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!contentRes.ok) throw new Error(`Failed to download: ${await contentRes.text()}`);
  const buffer = Buffer.from(await contentRes.arrayBuffer());
  return {
    contentBytes: buffer.toString('base64'),
    contentType: meta.file?.mimeType ?? 'application/octet-stream',
    name: meta.name,
  };
}

/**
 * Create a tool that sends email with file attachments from SharePoint.
 * Downloads and sends via the agent's Agent365 agentic Graph token (same identity as MailTools).
 */
function createSendEmailWithAttachmentTool(senderMailbox: string, agentRole?: CompanyAgentRole): ToolDefinition {
  return {
    name: 'reply_email_with_attachments',
    description:
      'Send an email with file attachments from SharePoint. This is the ONLY tool that ' +
      'can attach files to emails — send_email and reply_to_email CANNOT attach files. ' +
      'For replies, set subject to "RE: <original subject>". ' +
      'Provide SharePoint file paths or webUrls and this tool downloads the files and ' +
      'attaches them to the email. Do NOT use markdown in the body.',
    parameters: {
      to: {
        type: 'string',
        description: 'Recipient email address(es), comma-separated',
        required: true,
      },
      subject: {
        type: 'string',
        description: 'Email subject. Use "RE: <original subject>" for replies.',
        required: true,
      },
      body: {
        type: 'string',
        description: 'Email body content. Plain text, no markdown.',
        required: true,
      },
      file_paths: {
        type: 'string',
        description:
          'SharePoint file path(s) or webUrl(s) to attach, comma-separated if multiple. ' +
          'Examples: "Legal/Articles of Incorporation.pdf" or a full SharePoint webUrl.',
        required: true,
      },
      cc: {
        type: 'string',
        description: 'CC recipients, comma-separated (founders are auto-CC\'d on peer emails)',
        required: false,
      },
    },
    execute: async (params, ctx) => {
      try {
        const role = (agentRole ?? ctx.agentRole) as CompanyAgentRole | undefined;
        if (!role) {
          return { success: false, error: 'reply_email_with_attachments requires agent context' };
        }
        const mailToken = await getAgenticGraphToken(role);
        if (!mailToken) {
          return {
            success: false,
            error:
              'Could not acquire agentic Graph token for mail send. Ensure Agent365 is enabled and this agent has blueprintSpId/entraUserId configured.',
          };
        }
        // Accept both array and comma-separated string
        let filePaths: string[];
        if (Array.isArray(params.file_paths)) {
          filePaths = params.file_paths as string[];
        } else if (typeof params.file_paths === 'string') {
          filePaths = (params.file_paths as string).split(',').map((s) => s.trim()).filter(Boolean);
        } else {
          return { success: false, error: 'file_paths is required' };
        }
        if (filePaths.length === 0) {
          return { success: false, error: 'file_paths must contain at least one path' };
        }

        console.log(`[reply_email_with_attachments] Sending from ${senderMailbox} to ${params.to} with ${filePaths.length} files: ${filePaths.join('; ')}`);

        // Download all files from SharePoint
        const attachments = await Promise.all(
          filePaths.map(async (fp) => {
            try {
              console.log(`[reply_email_with_attachments] Downloading: ${fp}`);
              const result = await downloadSharePointFileForAttachment(fp, role);
              console.log(`[reply_email_with_attachments] Downloaded: ${result.name} (${result.contentType}, ${Math.round(result.contentBytes.length * 3 / 4 / 1024)}KB)`);
              return result;
            } catch (err) {
              console.error(`[reply_email_with_attachments] Download failed for "${fp}":`, (err as Error).message);
              throw new Error(`Failed to download "${fp}": ${(err as Error).message}`);
            }
          }),
        );

        // Parse recipients
        const toStr = params.to as string;
        const toRecipients = toStr.split(/[;,]/).map((e) => e.trim()).filter(Boolean).map((email) => ({
          emailAddress: { address: email },
        }));

        const ccStr = (params.cc as string) ?? '';
        const ccRecipients = ccStr
          ? ccStr.split(/[;,]/).map((e) => e.trim()).filter(Boolean).map((email) => ({
              emailAddress: { address: email },
            }))
          : [];

        const allRecipients = [
          ...toRecipients.map((r) => r.emailAddress.address),
          ...ccRecipients.map((r) => r.emailAddress.address),
        ];
        const internalOnly = allRecipients.length > 0 && allRecipients.every((email) => isGlyphorInternalEmail(email));
        const signedBody = appendGlyphorEmailSignature(params.body as string, senderMailbox, {
          format: 'html',
          internal: internalOnly,
        });

        // Build Graph API sendMail payload
        const payload = {
          message: {
            subject: params.subject as string,
            body: {
              contentType: 'HTML',
              content: signedBody,
            },
            toRecipients,
            ...(ccRecipients.length > 0 && { ccRecipients }),
            attachments: attachments.map((a) => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: a.name,
              contentType: a.contentType,
              contentBytes: a.contentBytes,
            })),
          },
          saveToSentItems: true,
        };

        const response = await fetch(
          `${GRAPH_BASE}/users/${encodeURIComponent(senderMailbox)}/sendMail`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${mailToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
        );

        if (!response.ok) {
          const text = await response.text();
          console.error(`[reply_email_with_attachments] Send failed (${response.status}): ${text.slice(0, 500)}`);
          await logMicrosoftWriteAudit({
            agentRole: role,
            action: 'mail.send_attachments',
            resource: `users/${senderMailbox}/sendMail`,
            identityType: 'agent365',
            workspaceKey: 'glyphor-internal',
            toolName: 'reply_email_with_attachments',
            outcome: 'failure',
            fallbackUsed: false,
            targetType: 'mailbox',
            targetId: senderMailbox,
            responseCode: response.status,
            responseSummary: text.slice(0, 500),
          });
          return { success: false, error: `Failed to send email (${response.status}): ${text}` };
        }

        const fileNames = attachments.map((a) => a.name).join(', ');
        console.log(`[reply_email_with_attachments] SUCCESS: sent to ${toStr} with ${fileNames}`);
        await logMicrosoftWriteAudit({
          agentRole: role,
          action: 'mail.send_attachments',
          resource: `users/${senderMailbox}/sendMail`,
          identityType: 'agent365',
          workspaceKey: 'glyphor-internal',
          toolName: 'reply_email_with_attachments',
          outcome: 'success',
          fallbackUsed: false,
          targetType: 'mailbox',
          targetId: senderMailbox,
          responseCode: response.status,
          responseSummary: `sent to ${toStr}`,
        });
        return {
          success: true,
          data: `Email sent from ${senderMailbox} to ${toStr} with attachments: ${fileNames}`,
        };
      } catch (err) {
        return { success: false, error: `reply_email_with_attachments failed: ${(err as Error).message}` };
      }
    },
  };
}

/**
 * Shut down all Agent 365 MCP connections.
 * Call this at process shutdown or between runs to clean up.
 */
export async function closeAgent365Bridge(agentRole?: string): Promise<void> {
  if (agentRole) {
    const cacheKey = getBridgeCacheKey(agentRole);
    const bridge = activeBridges.get(cacheKey);
    if (!bridge) return;
    await bridge.close();
    activeBridges.delete(cacheKey);
    return;
  }

  for (const bridge of activeBridges.values()) {
    await bridge.close();
  }
  activeBridges.clear();
}
