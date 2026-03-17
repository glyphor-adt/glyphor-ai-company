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

import { type ToolDefinition, type CompanyAgentRole, AGENT_EMAIL_MAP } from '@glyphor/agent-runtime';
import { getAgentBlueprintSpId, getAgentEntraUserId } from '@glyphor/agent-runtime';
import type { Agent365ToolBridge } from '@glyphor/integrations';
import { createAgent365Tools as initAgent365Bridge, getM365Token } from '@glyphor/integrations';

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

/** Full supported Microsoft Agent 365 MCP server catalog. */
export const ALL_M365_SERVERS = [
  ...STANDARD_M365_SERVERS,
  'mcp_UserProfile',
  'mcp_SharePointLists',
] as const;

/** All agents get the full M365 MCP server catalog — every agent has an Agent365 license. */
function getDefaultAgent365Servers(_agentRole?: string): readonly string[] {
  return ALL_M365_SERVERS;
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
 *                     Defaults to ALL_M365_SERVERS so the full supported catalog is available.
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
    console.warn(`[Agent365] No identity found for agent ${agentRole ?? 'unknown'}. Set blueprintSpId/entraUserId in agentIdentities.json or AGENT365_APP_INSTANCE_ID/AGENT365_AGENTIC_USER_ID env vars. Skipping.`);
    if (agentRole) {
      const fallbackTools: ToolDefinition[] = [];
      const fallbackTool = createReadInboxFallback(agentRole as CompanyAgentRole);
      if (fallbackTool) fallbackTools.push(fallbackTool);
      const mailbox = AGENT_EMAIL_MAP[agentRole as CompanyAgentRole]?.email;
      if (mailbox) fallbackTools.push(createSendEmailWithAttachmentTool(mailbox));
      if (fallbackTools.length > 0) {
        console.log(`[Agent365] Identity missing for ${agentRole}; using Graph fallback tools: ${fallbackTools.map(t => t.name).join(', ')}`);
        return fallbackTools;
      }
    }
    return [];
  }

  if (agentRole) {
    console.log(`[Agent365] Using per-agent identity for ${agentRole}: instanceId=${agentAppInstanceId.slice(0, 8)}…`);
  }

  const MCP_INIT_TIMEOUT_MS = 30_000;

  try {
    const bridgePromise = initAgent365Bridge({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      tenantId: credentials.tenantId,
      agenticAppId: process.env.AGENT365_BLUEPRINT_ID,
      agentAppInstanceId,
      agenticUserId,
    }, serverFilter);

    // Timeout guard: if MCP init hangs beyond 15s, fall back to core tools only
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
    if (agentRole) {
      const hasInboxReader = tools.some((tool) => tool.name.toLowerCase() === 'read_inbox');
      if (!hasInboxReader) {
        const fallbackTool = createReadInboxFallback(agentRole as CompanyAgentRole);
        if (fallbackTool) {
          tools.unshift(fallbackTool);
          console.log(`[Agent365] Added Graph fallback read_inbox for ${agentRole}`);
        }
      }
    }

    // Add reply_email_with_attachments tool — bypasses MCP MailTools for attachments.
    // The MCP send_email's attachmentUris and reply_to_email both fail with file attachments.
    // This tool downloads files from SharePoint via Graph API (AZURE_FILES) and sends
    // the email via Graph API sendMail (AZURE_MAIL) with inline base64 attachments.
    if (agentRole) {
      const mailbox = AGENT_EMAIL_MAP[agentRole as CompanyAgentRole]?.email;
      if (mailbox) {
        tools.push(createSendEmailWithAttachmentTool(mailbox));
        console.log(`[Agent365] Added reply_email_with_attachments for ${agentRole} (${mailbox})`);
      }
    }

    activeBridges.set(cacheKey, { ...bridge, tools });
    console.log(`[Agent365] Initialized ${tools.length} MCP tools`);
    return tools;
  } catch (err) {
    console.error('[Agent365] Failed to initialize MCP bridge (falling back to core tools):', (err as Error).message);
    if (agentRole) {
      const fallbackTools: ToolDefinition[] = [];
      const fallbackTool = createReadInboxFallback(agentRole as CompanyAgentRole);
      if (fallbackTool) fallbackTools.push(fallbackTool);
      const mailbox = AGENT_EMAIL_MAP[agentRole as CompanyAgentRole]?.email;
      if (mailbox) fallbackTools.push(createSendEmailWithAttachmentTool(mailbox));
      if (fallbackTools.length > 0) {
        console.log(`[Agent365] MCP init failed for ${agentRole}; using Graph fallback tools: ${fallbackTools.map(t => t.name).join(', ')}`);
        return fallbackTools;
      }
    }
    return [];
  }
}

function createReadInboxFallback(agentRole: CompanyAgentRole): ToolDefinition | null {
  const mailbox = AGENT_EMAIL_MAP[agentRole]?.email;
  if (!mailbox) return null;

  return {
    name: 'read_inbox',
    description: 'Fallback inbox reader via Microsoft Graph when Agent365 MailTools inbox listing is unavailable.',
    parameters: {
      limit: {
        type: 'number',
        description: 'Max messages to return (default: 10, max: 50).',
        required: false,
      },
      from_filter: {
        type: 'string',
        description: 'Optional sender filter (substring match).',
        required: false,
      },
      include_read: {
        type: 'boolean',
        description: 'Include read messages. Default false.',
        required: false,
      },
      mark_as_read: {
        type: 'boolean',
        description: 'Mark unread returned messages as read. Default false.',
        required: false,
      },
    },
    execute: async (params) => {
      try {
        const token = await getM365Token('agent365_mail_read_inbox');
        const limitRaw = typeof params.limit === 'number' ? params.limit : 10;
        const limit = Math.max(1, Math.min(50, Math.floor(limitRaw)));
        const includeRead = params.include_read === true;
        const markAsRead = params.mark_as_read === true;
        const fromFilter = typeof params.from_filter === 'string' ? params.from_filter.trim() : '';

        const query = new URLSearchParams({
          $top: String(limit),
          $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments',
          $orderby: 'receivedDateTime desc',
        });

        const filters: string[] = [];
        if (!includeRead) filters.push('isRead eq false');
        if (fromFilter) filters.push(`contains(from/emailAddress/address, '${fromFilter.replace(/'/g, "''")}')`);
        if (filters.length > 0) query.set('$filter', filters.join(' and '));

        const response = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?${query.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        );

        if (!response.ok) {
          const text = await response.text();
          return { success: false, error: `Graph read_inbox fallback failed (${response.status}): ${text.slice(0, 300)}` };
        }

        interface GraphMessage {
          id: string;
          subject: string;
          from?: { emailAddress?: { address?: string; name?: string } };
          receivedDateTime: string;
          bodyPreview?: string;
          isRead?: boolean;
          hasAttachments?: boolean;
        }

        const payload = (await response.json()) as { value?: GraphMessage[] };
        const messages = (payload.value ?? []).map((message) => ({
          id: message.id,
          subject: message.subject ?? '(no subject)',
          from: message.from?.emailAddress?.address ?? '',
          fromName: message.from?.emailAddress?.name ?? '',
          receivedAt: message.receivedDateTime,
          preview: message.bodyPreview ?? '',
          isRead: message.isRead ?? false,
          hasAttachments: message.hasAttachments ?? false,
        }));

        if (markAsRead) {
          const unreadIds = messages.filter((m) => !m.isRead).map((m) => m.id);
          if (unreadIds.length > 0) {
            await Promise.all(
              unreadIds.map((id) =>
                fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}`, {
                  method: 'PATCH',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ isRead: true }),
                }),
              ),
            );
          }
        }

        return {
          success: true,
          data: {
            mailbox,
            count: messages.length,
            messages,
          },
        };
      } catch (err) {
        return { success: false, error: `Graph read_inbox fallback failed: ${(err as Error).message}` };
      }
    },
  };
}

// ── Email with Attachments (Graph API bypass) ────────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Download a file from SharePoint by path or webUrl and return base64 bytes.
 * Uses AZURE_FILES credentials (Sites.Selected scope).
 */
async function downloadSharePointFileForAttachment(
  filePathOrUrl: string,
): Promise<{ contentBytes: string; contentType: string; name: string }> {
  const token = await getM365Token('read_sharepoint');
  const siteId = (process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  // If it's a SharePoint webUrl, extract the file path from it.
  // URLs may have %20 for spaces, so decode first before matching.
  let filePath = filePathOrUrl;
  const decoded = decodeURIComponent(filePathOrUrl);
  const spUrlMatch = decoded.match(/\/Shared\s+Documents\/(.+)$/i);
  if (spUrlMatch) {
    filePath = spUrlMatch[1]; // already decoded
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
 * Downloads files via Graph API (AZURE_FILES) and sends via Graph API (AZURE_MAIL).
 */
function createSendEmailWithAttachmentTool(senderMailbox: string): ToolDefinition {
  return {
    name: 'reply_email_with_attachments',
    description:
      'Send an email with file attachments from SharePoint. Use this when you need to ' +
      'reply to an email with attached documents, or send a new email with attachments. ' +
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
        type: 'array',
        description:
          'SharePoint file paths or webUrls to attach. ' +
          'Examples: "Legal/Articles of Incorporation.pdf" or full SharePoint webUrl.',
        required: true,
        items: { type: 'string', description: 'SharePoint file path or webUrl' },
      },
      cc: {
        type: 'string',
        description: 'CC recipients, comma-separated (founders are auto-CC\'d on peer emails)',
        required: false,
      },
    },
    execute: async (params) => {
      try {
        const filePaths = params.file_paths as string[];
        if (!filePaths || filePaths.length === 0) {
          return { success: false, error: 'file_paths is required and must contain at least one path' };
        }

        // Download all files from SharePoint
        const attachments = await Promise.all(
          filePaths.map(async (fp) => {
            try {
              return await downloadSharePointFileForAttachment(fp);
            } catch (err) {
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

        // Build Graph API sendMail payload
        const payload = {
          message: {
            subject: params.subject as string,
            body: {
              contentType: 'Text',
              content: params.body as string,
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

        // Send via Graph API using AZURE_MAIL credentials
        const mailToken = await getM365Token('agent365_mail_send');
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
          return { success: false, error: `Failed to send email (${response.status}): ${text}` };
        }

        const fileNames = attachments.map((a) => a.name).join(', ');
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
