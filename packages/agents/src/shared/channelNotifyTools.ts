/**
 * Channel Notify Tools — Shared tools for posting updates to Teams channels
 *
 * Every agent gets `post_to_briefings` so they can report status directly
 * to the #briefings channel as their own identity (via Agent 365 agentic user).
 *
 * Flow:
 *   1. Agent calls post_to_briefings with a summary of work done
 *   2. Tool gets A365TeamsChatClient for the agent's role
 *   3. Posts to #briefings channel via Graph API with agent's own token
 *   4. Message appears as the agent (e.g. "Maya Brooks"), not as a human
 */

import type { ToolDefinition, ToolResult, CompanyAgentRole } from '@glyphor/agent-runtime';
import { AGENT_EMAIL_MAP } from '@glyphor/agent-runtime';
import { A365TeamsChatClient, buildDeliverablesFounderMentions } from '@glyphor/integrations';
import { systemQuery } from '@glyphor/shared/db';

type FounderTarget = 'kristina' | 'andrew';

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen', cto: 'Marcus Reeves', cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor', cmo: 'Maya Brooks',
  'vp-sales': 'Rachel Kim', 'vp-design': 'Mia Tanaka', ops: 'Atlas Vega',
  'platform-engineer': 'Alex Park', 'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes', 'user-researcher': 'Priya Sharma',
  'competitive-intel': 'Daniel Ortiz', 'content-creator': 'Tyler Reed',
  'seo-analyst': 'Lisa Chen', 'social-media-manager': 'Kai Johnson',
  'm365-admin': 'Riley Morgan', 'global-admin': 'Morgan Blake',
  'head-of-hr': 'Ava Martinez', clo: 'Legal', 'vp-research': 'Research Lead',
  'platform-intel': 'Nexus',
};

const FOUNDER_DISPLAY_NAMES: Record<FounderTarget, string> = {
  kristina: process.env.TEAMS_FOUNDER_KRISTINA_DISPLAY_NAME?.trim() || 'Kristina Denney',
  andrew: process.env.TEAMS_FOUNDER_ANDREW_DISPLAY_NAME?.trim() || 'Andrew Zwelling',
};

function inferFounderTargetsFromMessage(message: string): FounderTarget[] {
  const targets: FounderTarget[] = [];
  const normalized = message.toLowerCase();
  if (/\b@?kristina\b|\bkristina denney\b/.test(normalized)) targets.push('kristina');
  if (/\b@?andrew\b|\bandrew zwelling\b/.test(normalized)) targets.push('andrew');
  return targets;
}

function plainFounderFooter(targets: FounderTarget[]): string {
  const requested: FounderTarget[] = targets.length > 0 ? targets : ['kristina', 'andrew'];
  const names = requested.map((target) => FOUNDER_DISPLAY_NAMES[target]).join(' & ');
  return `${names} — review requested.`;
}

export function createChannelNotifyTools(): ToolDefinition[] {
  const teamId = process.env.TEAMS_TEAM_ID?.trim();
  const briefingsChannelId = process.env.TEAMS_CHANNEL_BRIEFINGS_ID?.trim();
  const deliverablesChannelId = process.env.TEAMS_CHANNEL_DELIVERABLES_ID?.trim();

  return [
    {
      name: 'post_to_briefings',
      description:
        'Post an update to the #briefings Teams channel so both founders see it. ' +
        'Use this at the end of any run where you did meaningful work. ' +
        'The message appears as YOU (your agent identity), not as a bot or human. ' +
        'Keep messages concise: 2-4 sentences summarizing what you did and any next steps. ' +
        'NEVER include fabricated numbers, dollar amounts, or percentages — only facts from tool results.',
      parameters: {
        title: {
          type: 'string',
          description: 'Short headline for the update (e.g. "Completed SEO audit", "Blocker: need API key")',
          required: true,
        },
        message: {
          type: 'string',
          description: 'The update body — 2-4 sentences summarizing what you did, the outcome, and next steps',
          required: true,
        },
        type: {
          type: 'string',
          description: 'Notification type',
          required: false,
          enum: ['update', 'completed', 'blocker', 'fyi'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const role = ctx?.agentRole as CompanyAgentRole | undefined;
        if (!role) {
          return { success: false, error: 'Agent role not available in context' };
        }

        const title = params.title as string;
        const message = params.message as string;
        const type = (params.type as string) ?? 'update';
        const agentName = AGENT_DISPLAY_NAMES[role] ?? role;

        if (!teamId || !briefingsChannelId) {
          return {
            success: false,
            error: 'TEAMS_TEAM_ID or TEAMS_CHANNEL_BRIEFINGS_ID not configured. Cannot post to channel.',
          };
        }

        // Dedup: check if we posted a very similar message recently
        try {
          const recent = await systemQuery<{ details: string }>(
            `SELECT details FROM activity_log
             WHERE agent_role = $1 AND action = 'channel_post'
               AND created_at > NOW() - interval '2 hours'
             ORDER BY created_at DESC LIMIT 3`,
            [role],
          );
          const newWords = new Set(message.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          for (const row of recent) {
            try {
              const prevMsg = (typeof row.details === 'string' ? row.details : '').toLowerCase();
              const prevWords = new Set(prevMsg.split(/\s+/).filter(w => w.length > 3));
              if (newWords.size === 0 || prevWords.size === 0) continue;
              const overlap = [...newWords].filter(w => prevWords.has(w)).length;
              if (overlap / Math.max(newWords.size, prevWords.size) > 0.6) {
                return {
                  success: false,
                  error: 'Duplicate suppressed — you posted a similar update within the last 2 hours.',
                };
              }
            } catch { continue; }
          }
        } catch {
          // dedup check failed, proceed anyway
        }

        // Format the message with agent identity header
        const typeLabel = type === 'blocker' ? '🔴 BLOCKER'
          : type === 'completed' ? '✅ COMPLETED'
          : type === 'fyi' ? 'ℹ️ FYI'
          : '📋 UPDATE';
        const formatted = `**${typeLabel} — ${title}**\n\n_From: ${agentName} (${role})_\n\n${message}`;

        // Post using agent's own A365 identity
        const a365Client = A365TeamsChatClient.fromEnv(role);
        if (a365Client) {
          try {
            await a365Client.postChannelMessage(teamId, briefingsChannelId, formatted, role);

            // Log success
            try {
              await systemQuery(
                `INSERT INTO activity_log (agent_role, action, details, created_at) VALUES ($1, $2, $3, NOW())`,
                [role, 'channel_post', `${title}: ${message}`.substring(0, 500)],
              );
            } catch { /* logging failure is non-fatal */ }

            return {
              success: true,
              data: { channel: '#briefings', method: 'agent-identity', agent: agentName },
            };
          } catch (err) {
            console.warn(`[post_to_briefings] A365 channel post failed for ${role}:`, (err as Error).message);
            // Fall through to delegated Graph fallback
          }
        }

        // Fallback: use the shared delegated Graph token (postCardToChannel)
        try {
          const { postTextToChannel } = await import('@glyphor/integrations');
          const result = await postTextToChannel('briefings', formatted, null, role);
          if (result.method !== 'none') {
            try {
              await systemQuery(
                `INSERT INTO activity_log (agent_role, action, details, created_at) VALUES ($1, $2, $3, NOW())`,
                [role, 'channel_post', `${title}: ${message}`.substring(0, 500)],
              );
            } catch { /* logging failure is non-fatal */ }

            return {
              success: true,
              data: { channel: '#briefings', method: result.method, agent: agentName },
            };
          }
          return { success: false, error: `Channel post unavailable: ${result.error}` };
        } catch (err) {
          return { success: false, error: `Channel post failed: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'post_to_deliverables',
      description:
        'Post a message to the #Deliverables Teams channel. ' +
        'Use when an assignment is complete and founders need to review output. ' +
        'Founders get real Teams @mentions when TEAMS_FOUNDER_KRISTINA_AAD_ID and TEAMS_FOUNDER_ANDREW_AAD_ID are set (Entra user Object IDs). ' +
        'The message should appear as YOUR agent identity (Agent365 per-role entraUserId). If it shows as a human, A365 posting failed and a fallback token was used — check logs.',
      parameters: {
        title: {
          type: 'string',
          description: 'Short headline (e.g. assignment or deliverable title)',
          required: true,
        },
        message: {
          type: 'string',
          description: 'Full output for founder review — include complete text, not a summary, when posting finished work',
          required: true,
        },
        type: {
          type: 'string',
          description: 'Notification type',
          required: false,
          enum: ['update', 'completed', 'blocker', 'fyi'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const role = ctx?.agentRole as CompanyAgentRole | undefined;
        if (!role) {
          return { success: false, error: 'Agent role not available in context' };
        }

        const title = params.title as string;
        const message = params.message as string;
        const type = (params.type as string) ?? 'update';
        const agentName = AGENT_DISPLAY_NAMES[role] ?? role;

        if (!teamId || !deliverablesChannelId) {
          return {
            success: false,
            error: 'TEAMS_TEAM_ID or TEAMS_CHANNEL_DELIVERABLES_ID not configured. Cannot post to channel.',
          };
        }

        try {
          const recent = await systemQuery<{ details: string }>(
            `SELECT details FROM activity_log
             WHERE agent_role = $1 AND action = 'deliverables_channel_post'
               AND created_at > NOW() - interval '2 hours'
             ORDER BY created_at DESC LIMIT 3`,
            [role],
          );
          const newWords = new Set(message.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          for (const row of recent) {
            try {
              const prevMsg = (typeof row.details === 'string' ? row.details : '').toLowerCase();
              const prevWords = new Set(prevMsg.split(/\s+/).filter(w => w.length > 3));
              if (newWords.size === 0 || prevWords.size === 0) continue;
              const overlap = [...newWords].filter(w => prevWords.has(w)).length;
              if (overlap / Math.max(newWords.size, prevWords.size) > 0.6) {
                return {
                  success: false,
                  error: 'Duplicate suppressed — you posted a similar update to #Deliverables within the last 2 hours.',
                };
              }
            } catch { continue; }
          }
        } catch {
          // dedup check failed, proceed anyway
        }

        const typeLabel = type === 'blocker' ? '🔴 BLOCKER'
          : type === 'completed' ? '✅ COMPLETED'
          : type === 'fyi' ? 'ℹ️ FYI'
          : '📋 UPDATE';
        const baseMarkdown =
          `**${typeLabel} — ${title}**\n\n_From: ${agentName} (${role})_\n\n${message}`;
        const explicitFounderTargets = inferFounderTargetsFromMessage(message);
        const hasExplicitFounderMentions = explicitFounderTargets.length > 0;

        // Only auto-append review mentions when the message did not already mention founders.
        const founderRich = hasExplicitFounderMentions
          ? null
          : buildDeliverablesFounderMentions();
        const markdownWithPlainFooter = hasExplicitFounderMentions || founderRich
          ? baseMarkdown
          : `${baseMarkdown}\n\n${plainFounderFooter([])}`;

        const a365Client = A365TeamsChatClient.fromEnv(role);
        if (a365Client) {
          try {
            await a365Client.postChannelMessage(
              teamId,
              deliverablesChannelId,
              founderRich ? baseMarkdown : markdownWithPlainFooter,
              role,
              founderRich
                ? { appendHtml: founderRich.appendHtml, mentions: founderRich.mentions }
                : undefined,
            );

            try {
              await systemQuery(
                `INSERT INTO activity_log (agent_role, action, details, created_at) VALUES ($1, $2, $3, NOW())`,
                [role, 'deliverables_channel_post', `${title}: ${message}`.substring(0, 500)],
              );
            } catch { /* non-fatal */ }

            return {
              success: true,
              data: { channel: '#Deliverables', method: 'agent-identity', agent: agentName },
            };
          } catch (err) {
            console.warn(`[post_to_deliverables] A365 channel post failed for ${role}:`, (err as Error).message);
          }
        }

        try {
          const { postTextToChannel } = await import('@glyphor/integrations');
          const result = await postTextToChannel(
            'deliverables',
            founderRich ? baseMarkdown : markdownWithPlainFooter,
            null,
            role,
            founderRich ?? undefined,
          );
          if (result.method !== 'none') {
            try {
              await systemQuery(
                `INSERT INTO activity_log (agent_role, action, details, created_at) VALUES ($1, $2, $3, NOW())`,
                [role, 'deliverables_channel_post', `${title}: ${message}`.substring(0, 500)],
              );
            } catch { /* non-fatal */ }

            return {
              success: true,
              data: { channel: '#Deliverables', method: result.method, agent: agentName },
            };
          }
          return { success: false, error: `Channel post unavailable: ${result.error}` };
        } catch (err) {
          return { success: false, error: `Channel post failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
