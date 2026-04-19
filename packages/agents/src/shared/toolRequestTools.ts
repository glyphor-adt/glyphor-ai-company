/**
 * Shared Tool Request Tools
 *
 * Allows agents to request new tools and additional access without
 * directly activating live capabilities.
 *
 * Requests are stored in the `tool_requests` table. Activation remains an
 * admin-controlled step after review and registry validation.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { isKnownToolAsync, getAllKnownTools, invalidateGrantCache } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { evaluateToolPermissionGate } from './toolPermissionPolicy.js';

const KNOWLEDGE_ARTIFACT_PATTERN = /(sharepoint|toolkit|playbook|guide|guidelines|primer|document|deck|brief|policy|template|style\s*guide|brand\s*guide|asset\s*library)/i;

function looksLikeKnowledgeArtifact(value: string): boolean {
  return KNOWLEDGE_ARTIFACT_PATTERN.test(value);
}

/**
 * Fuzzy-match guard — finds existing tools that look like duplicates of a
 * proposed new tool name. Added 2026-04-19 after agents requested 40+ tools
 * that were duplicates of existing capabilities (sandbox_shell, sandbox_file_read,
 * read_founder_directives, get_infrastructure_costs, github_*).
 *
 * Strategy:
 *  1. Normalize both sides: lowercase, strip common noise suffixes
 *     (_v2, _db, _api, _query, _new), strip common verb prefixes where
 *     the rest is shared (get_, query_, fetch_, read_, list_).
 *  2. Exact-equal after normalization -> duplicate.
 *  3. Word-token overlap >= 2 AND the proposed name's "root" is a substring of
 *     an existing tool's root (or vice-versa) -> duplicate.
 *  4. Levenshtein distance <= 2 on the raw names -> duplicate (catches typos).
 */
const NOISE_SUFFIXES = [
  '_v2', '_v3', '_db', '_api', '_query', '_new', '_fn', '_request',
];
const NOISE_PREFIXES = [
  'get_', 'query_', 'fetch_', 'read_', 'list_', 'find_', 'lookup_',
];

function normalizeToolName(name: string): string {
  let n = name.toLowerCase();
  for (const s of NOISE_SUFFIXES) if (n.endsWith(s)) n = n.slice(0, -s.length);
  for (const p of NOISE_PREFIXES) if (n.startsWith(p)) n = n.slice(p.length);
  return n;
}

function stem(token: string): string {
  // Very light English stemmer — enough to make cost/costs, directive/directives,
  // update/updates/updated collapse together.
  let t = token;
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && (t.endsWith('ing') || t.endsWith('ers'))) return t.slice(0, -3);
  if (t.length > 3 && (t.endsWith('es') || t.endsWith('ed'))) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

function tokenize(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[_\s\-\/]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
      .map(stem),
  );
}

/** Two tokens "match" if equal, or one contains the other with len >= 4. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let current = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(
        prev[j] + 1,        // deletion
        current + 1,        // insertion
        prev[j - 1] + cost, // substitution
      );
      prev[j - 1] = current;
      current = next;
    }
    prev[b.length] = current;
  }
  return prev[b.length];
}

/**
 * Return up to 5 existing tool names that look like duplicates of the
 * proposed `toolName` (and its description). Empty = no duplicate detected.
 * Exported for unit testing.
 */
export function findFuzzyDuplicates(
  toolName: string,
  description: string,
  existing: readonly string[],
): string[] {
  const normProposed = normalizeToolName(toolName);
  const tokensProposed = tokenize(toolName);
  // Add tokens from the description too — some agents name the tool
  // vaguely (e.g., "grep") but describe it precisely ("search codebase").
  for (const t of tokenize(description)) tokensProposed.add(t);

  const matches: Array<{ name: string; score: number }> = [];

  for (const candidate of existing) {
    if (candidate === toolName) continue; // caught by exact-match guard already
    // Skip MCP-qualified tools — they're namespaced and unlikely to collide.
    if (candidate.startsWith('mcp_')) continue;

    const normCandidate = normalizeToolName(candidate);

    // Rule 1: exact match after normalization
    if (normCandidate === normProposed && normProposed.length >= 3) {
      matches.push({ name: candidate, score: 100 });
      continue;
    }

    // Rule 2: Levenshtein distance <= 2 on raw names (typo catch)
    const rawDist = levenshtein(toolName.toLowerCase(), candidate.toLowerCase());
    if (rawDist <= 2 && Math.max(toolName.length, candidate.length) >= 6) {
      matches.push({ name: candidate, score: 90 - rawDist });
      continue;
    }

    // Rule 3: substring containment on normalized roots (e.g.,
    // `founder_directives` contained in `read_founder_directives`)
    if (
      normProposed.length >= 6 &&
      normCandidate.length >= 6 &&
      (normCandidate.includes(normProposed) || normProposed.includes(normCandidate))
    ) {
      matches.push({ name: candidate, score: 80 });
      continue;
    }

    // Rule 4: token overlap >= 2 meaningful words
    const tokensCandidate = tokenize(candidate);
    let overlap = 0;
    for (const t of tokensProposed) {
      for (const c of tokensCandidate) {
        if (tokensMatch(t, c)) { overlap++; break; }
      }
    }
    if (overlap >= 2) {
      matches.push({ name: candidate, score: 50 + overlap * 5 });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  // De-dupe and cap.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    out.push(m.name);
    if (out.length >= 5) break;
  }
  return out;
}

const ADMIN_REVIEW_ASSIGNEES = ['cto', 'global-admin'];
const RESTRICTED_REVIEW_ASSIGNEES = ['kristina', ...ADMIN_REVIEW_ASSIGNEES];

async function queueToolReviewDecision(input: {
  title: string;
  summary: string;
  proposedBy: string;
  reasoning: string;
  requiresApproval: boolean;
  data: Record<string, unknown>;
}): Promise<void> {
  await systemQuery(
    'INSERT INTO decisions (tier, status, title, summary, proposed_by, reasoning, assigned_to, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [
      'yellow',
      'pending',
      input.title,
      input.summary,
      input.proposedBy,
      input.reasoning,
      input.requiresApproval ? RESTRICTED_REVIEW_ASSIGNEES : ADMIN_REVIEW_ASSIGNEES,
      JSON.stringify(input.data),
    ],
  );
}

export function createToolRequestTools(): ToolDefinition[] {
  return [
    {
      name: 'list_my_tools',
      description:
        'List tool visibility for the current agent. Returns active self-service grants and, optionally, known system tools for discovery.',
      parameters: {
        search: {
          type: 'string',
          description: 'Optional case-insensitive substring filter applied to tool names.',
          required: false,
        },
        include_known_tools: {
          type: 'boolean',
          description: 'When true, include known system tools (can be large). Defaults to false.',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Max known tools to return when include_known_tools=true. Defaults to 200.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const search = String(params.search ?? '').trim().toLowerCase();
        const includeKnown = Boolean(params.include_known_tools);
        const limitRaw = Number(params.limit ?? 200);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;

        const grants = await systemQuery<{ tool_name: string; reason: string | null; granted_by: string | null; updated_at: string | null }>(
          `SELECT tool_name, reason, granted_by, updated_at
             FROM agent_tool_grants
            WHERE agent_role = $1 AND is_active = true
            ORDER BY tool_name ASC`,
          [ctx.agentRole],
        );

        const grantedTools = search
          ? grants.filter((row) => row.tool_name.toLowerCase().includes(search))
          : grants;

        let knownTools: string[] = [];
        if (includeKnown) {
          const rows = await systemQuery<{ tool_name: string }>(
            `SELECT DISTINCT tool_name
               FROM (
                      SELECT tool_name FROM agent_tool_grants WHERE agent_role = $1 AND is_active = true
                      UNION ALL
                      SELECT name AS tool_name FROM tool_registry WHERE is_active = true
                    ) t
              ORDER BY tool_name ASC`,
            [ctx.agentRole],
          );

          knownTools = rows
            .map((r) => r.tool_name)
            .filter((name) => (search ? name.toLowerCase().includes(search) : true))
            .slice(0, limit);
        }

        return {
          success: true,
          data: {
            agent_role: ctx.agentRole,
            granted_count: grantedTools.length,
            granted_tools: grantedTools,
            known_tools: knownTools,
            note:
              'Runtime tool visibility is the intersection of loaded tool declarations, MCP server health/auth, and role/task filtering. If a needed tool is missing, call request_tool_access or request_new_tool.',
          },
        };
      },
    },

    {
      name: 'tool_search',
      description:
        'Search discoverable tool names by keyword. Compatibility helper for agents that attempt tool discovery via tool_search.',
      parameters: {
        query: {
          type: 'string',
          description: 'Keyword or partial tool name to search for.',
          required: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum matches to return. Defaults to 50.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const query = String(params.query ?? '').trim().toLowerCase();
        if (!query) return { success: false, error: 'query is required.' };
        const limitRaw = Number(params.limit ?? 50);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;

        const staticMatches = getAllKnownTools()
          .filter((toolName) => toolName.toLowerCase().includes(query));

        const rows = await systemQuery<{ tool_name: string }>(
          `SELECT DISTINCT tool_name
             FROM (
                    SELECT tool_name FROM agent_tool_grants WHERE agent_role = $1 AND is_active = true
                    UNION ALL
                    SELECT name AS tool_name FROM tool_registry WHERE is_active = true
                  ) t
            WHERE LOWER(tool_name) LIKE $2
            ORDER BY tool_name ASC
            LIMIT $3`,
          [ctx.agentRole, `%${query}%`, limit],
        );

        const mergedMatches = Array.from(new Set([
          ...rows.map((r) => r.tool_name),
          ...staticMatches,
        ]))
          .sort((a, b) => a.localeCompare(b))
          .slice(0, limit);

        return {
          success: true,
          data: {
            query,
            count: mergedMatches.length,
            matches: mergedMatches,
            note: 'This searches discoverable registry + active grant names. MCP availability still depends on runtime server auth/health.',
          },
        };
      },
    },

    {
      name: 'check_tool_access',
      description:
        'Pre-dispatch access check. Verifies active grants, grant freshness, and whether each tool exists in the system.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role to evaluate (e.g., "cmo"). Defaults to caller role when omitted.',
          required: false,
        },
        tool_names: {
          type: 'array',
          description: 'List of tool names to validate.',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const agentRole = String(params.agent_role ?? ctx.agentRole);
        const rawToolNames = Array.isArray(params.tool_names) ? params.tool_names : [];
        const toolNames = rawToolNames
          .map((value) => String(value).trim())
          .filter(Boolean);

        if (toolNames.length === 0) {
          return { success: false, error: 'tool_names must contain at least one tool name.' };
        }

        const grants = await systemQuery<{ tool_name: string; last_synced_at: string | null; granted_by: string | null }>(
          `SELECT tool_name, last_synced_at, granted_by
             FROM agent_tool_grants
            WHERE agent_role = $1
              AND tool_name = ANY($2::text[])
              AND is_active = true`,
          [agentRole, toolNames],
        );
        const grantByTool = new Map(grants.map((row) => [row.tool_name, row]));

        const checks = await Promise.all(
          toolNames.map(async (toolName) => {
            const grantRow = grantByTool.get(toolName);
            const existsInSystem = await isKnownToolAsync(toolName);
            const isFresh = Boolean(
              grantRow?.last_synced_at &&
              (Date.now() - new Date(grantRow.last_synced_at).getTime()) < 24 * 60 * 60 * 1000,
            );

            let accessible: 'yes' | 'no' | 'unknown';
            let source: 'active_grant_fresh' | 'active_grant_stale' | 'exists_in_system_only' | 'not_found';

            if (grantRow && isFresh) {
              accessible = 'yes';
              source = 'active_grant_fresh';
            } else if (grantRow && !isFresh) {
              // Active grant exists — the tool IS accessible at runtime.
              // Staleness only means the sync metadata is old, not that the
              // grant is invalid.  Reporting 'unknown' here caused agents to
              // believe they couldn't call the tool.
              accessible = 'yes';
              source = 'active_grant_stale';
            } else if (existsInSystem) {
              accessible = 'unknown';
              source = 'exists_in_system_only';
            } else {
              accessible = 'no';
              source = 'not_found';
            }

            return {
              tool_name: toolName,
              agent_role: agentRole,
              accessible,
              source,
              active_grant: Boolean(grantRow),
              last_synced_at: grantRow?.last_synced_at ?? null,
              granted_by: grantRow?.granted_by ?? null,
              exists_in_system: existsInSystem,
              recommendation:
                source === 'active_grant_stale'
                  ? 'Tool is accessible (active grant exists). Grant metadata is stale — consider re-syncing with grant_tool_access.'
                  : accessible === 'unknown'
                    ? 'No active grant found but tool exists in the system. Grant access with grant_tool_access before dispatching.'
                    : accessible === 'no'
                      ? 'This tool does not exist. Check the tool name or request it via request_new_tool.'
                      : 'Tool confirmed accessible.',
            };
          }),
        );

        const missing = checks.filter((c) => !c.exists_in_system).map((c) => c.tool_name);
        const unknown = checks.filter((c) => c.accessible === 'unknown').map((c) => c.tool_name);
        return {
          success: true,
          data: {
            agent_role: agentRole,
            checks,
            all_tools_exist: missing.length === 0,
            missing_tools: missing,
            unknown_tools: unknown,
            all_tools_confirmed_accessible: checks.every((c) => c.accessible === 'yes'),
          },
        };
      },
    },

    {
      name: 'request_new_tool',
      description:
        'Request a new tool capability that does not currently exist in the system. ' +
        'Creates a tool request for CTO build review. Include a clear description of what the tool should do, ' +
        'why it is needed, and optionally suggest an API configuration if the tool wraps an external API. ' +
        'Approval is required only for paid/spend-impacting or global-admin permissioning tools.',
      parameters: {
        tool_name: {
          type: 'string',
          description:
            'Proposed name for the tool (snake_case, e.g., "get_jira_issues"). Must not already exist.',
          required: true,
        },
        description: {
          type: 'string',
          description: 'What the tool does — be specific about inputs, outputs, and behavior.',
          required: true,
        },
        justification: {
          type: 'string',
          description: 'Why this tool is needed. Reference a directive, blocker, or use case.',
          required: true,
        },
        use_case: {
          type: 'string',
          description: 'Concrete example of how you would use this tool in your work.',
          required: true,
        },
        suggested_category: {
          type: 'string',
          description: 'Category for the tool (e.g., "integration", "analytics", "communication", "data")',
          required: false,
        },
        directive_id: {
          type: 'string',
          description: 'Optional: directive UUID this tool supports',
          required: false,
        },
        suggested_api_config: {
          type: 'object',
          description:
            'Optional: suggested API configuration if the tool wraps an external API. ' +
            'Keys: method (GET/POST/etc), url_template, headers_template, body_template, auth_type (bearer_env/header_env/none), auth_env_var',
          required: false,
        },
        suggested_parameters: {
          type: 'object',
          description:
            'Optional: suggested parameter schema for the tool. Keys are param names, values describe type and description.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!params.tool_name) return { success: false, error: 'tool_name parameter is required' };
        if (!params.description) return { success: false, error: 'description parameter is required' };
        if (!params.justification) return { success: false, error: 'justification parameter is required' };
        const toolName = params.tool_name as string;
        const description = params.description as string;
        const justification = params.justification as string;
        const useCase = params.use_case as string;
        const combinedRequestText = `${toolName}\n${description}\n${justification}\n${useCase}`;
        const permissionPolicy = evaluateToolPermissionGate({
          toolName,
          contextText: [description, justification, useCase],
        });

        if (looksLikeKnowledgeArtifact(combinedRequestText)) {
          return {
            success: false,
            error:
              'This looks like a document/knowledge access request (for example: toolkit/guide/primer), not a missing executable tool. ' +
              'Use SharePoint tools first (mcp_ODSPRemoteServer/findFileOrFolder, mcp_ODSPRemoteServer/listDocumentLibrariesInSite), ' +
              'or call list_my_tools/include_known_tools=true and request_tool_access with the exact existing tool name.',
          };
        }

        // Validate tool name format
        if (!/^[a-z][a-z0-9_]{2,63}$/.test(toolName)) {
          return {
            success: false,
            error:
              'Tool name must be snake_case, start with a letter, and be 3–64 characters (a-z, 0-9, _).',
          };
        }

        // If the requester already has an active grant for this exact name,
        // this is not a "new tool" request.
        const alreadyGranted = await systemQuery<{ id: string }>(
          `SELECT id FROM agent_tool_grants
           WHERE agent_role = $1 AND tool_name = $2 AND is_active = true
           LIMIT 1`,
          [ctx.agentRole, toolName],
        );
        if (alreadyGranted.length > 0) {
          return {
            success: false,
            error: `You already have access to "${toolName}". Use the existing tool instead of requesting a new one.`,
          };
        }

        // Check if tool already exists (static or DB-registered)
        if (await isKnownToolAsync(toolName)) {
          return {
            success: false,
            error: `Tool "${toolName}" already exists. Use grant_tool_access to get access to an existing tool instead.`,
          };
        }

        // Fuzzy-match guard: reject requests that look like duplicates of an
        // existing tool with a different name. Added 2026-04-19 after 40 stale
        // approved requests were bulk-rejected — most were agents reinventing
        // sandbox_shell / sandbox_file_read / read_founder_directives because
        // the CTO sandbox ordering bug was hiding the real tools. This catches
        // suffix/prefix variants (`_v2`, `get_`, `_db`, `_api`) and near-matches
        // before they reach the review queue.
        const fuzzyMatches = findFuzzyDuplicates(toolName, description, getAllKnownTools());
        if (fuzzyMatches.length > 0) {
          return {
            success: false,
            error:
              `This looks like a duplicate of existing tool(s): ${fuzzyMatches.slice(0, 5).join(', ')}. ` +
              `Use list_my_tools / check_tool_access / request_tool_access with the exact existing name. ` +
              `If you genuinely need different behavior, re-file request_new_tool and explicitly explain ` +
              `in the justification why the existing tool(s) cannot be used.`,
          };
        }

        // Check for duplicate pending request
        const existing = await systemQuery(
          'SELECT id, status FROM tool_requests WHERE tool_name = $1 AND status = ANY($2) LIMIT 1',
          [toolName, ['pending', 'pending_approval', 'approved', 'building']],
        );

        if (existing.length > 0) {
          return {
            success: false,
            error: `A request for tool "${toolName}" already exists (status: ${existing[0].status}, id: ${existing[0].id}). Wait for it to be processed.`,
          };
        }

        // Create the tool request
        const [request] = await systemQuery(
          'INSERT INTO tool_requests (requested_by, tool_name, description, justification, use_case, suggested_category, directive_id, suggested_api_config, suggested_parameters, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
          [
            ctx.agentRole,
            toolName,
            description,
            justification,
            useCase,
            (params.suggested_category as string) ?? null,
            (params.directive_id as string) ?? null,
            params.suggested_api_config ?? null,
            params.suggested_parameters ?? null,
            'pending',
          ],
        );

        if (permissionPolicy.requiresApproval) {
          try {
            await queueToolReviewDecision({
              title: `Restricted tool request: ${toolName}`,
              summary: `${ctx.agentRole} requested restricted tool "${toolName}" (${permissionPolicy.reason}).\n\nDescription: ${description}\n\nJustification: ${justification}\n\nUse case: ${useCase}`,
              proposedBy: ctx.agentRole,
              reasoning: justification,
              requiresApproval: true,
              data: {
                type: 'restricted_tool_request',
                tool_name: toolName,
                requested_by: ctx.agentRole,
                restriction_reason: permissionPolicy.reason,
                matches: permissionPolicy.matches,
                request_id: request.id,
              },
            });
          } catch (decisionErr) {
            return {
              success: true,
              data: {
                request_id: request.id,
                tool_name: toolName,
                status: 'pending',
                warning: `Restricted tool request created but approval routing failed: ${(decisionErr as Error).message}.`,
              },
            };
          }

          const [updated] = await systemQuery<{ id: string }>(
            'UPDATE tool_requests SET status = $1, review_notes = $2 WHERE id = $3 RETURNING id',
            ['pending_approval', 'Awaiting restricted admin review before any registry activation.', request.id],
          );

          if (!updated) {
            // The request was already modified (e.g., auto-built by a concurrent process).
            // Return success with the original pending status so the caller is not blocked.
            return {
              success: true,
              data: {
                request_id: request.id,
                tool_name: toolName,
                status: 'pending',
                approval_required: true,
                approval_reason: permissionPolicy.reason,
                message:
                  `Restricted request received (${permissionPolicy.reason}). ` +
                  'Admin review is required before this tool can be activated in the registry.',
              },
            };
          }

          return {
            success: true,
            data: {
              request_id: request.id,
              tool_name: toolName,
              status: 'pending_approval',
              approval_required: true,
              approval_reason: permissionPolicy.reason,
              message:
                `Restricted request received (${permissionPolicy.reason}). ` +
                'Admin review is required before this tool can be activated in the registry.',
            },
          };
        }

        try {
          await queueToolReviewDecision({
            title: `Tool request review: ${toolName}`,
            summary: `${ctx.agentRole} requested new tool "${toolName}". Review the proposal before any live registry activation.\n\nDescription: ${description}\n\nJustification: ${justification}\n\nUse case: ${useCase}`,
            proposedBy: ctx.agentRole,
            reasoning: justification,
            requiresApproval: false,
            data: {
              type: 'tool_request_review',
              tool_name: toolName,
              requested_by: ctx.agentRole,
              request_id: request.id,
            },
          });
        } catch (decisionErr) {
          return {
            success: true,
            data: {
              request_id: request.id,
              tool_name: toolName,
              status: 'pending',
              warning: `Tool request created but admin review routing failed: ${(decisionErr as Error).message}.`,
            },
          };
        }

        return {
          success: true,
          data: {
            request_id: request.id,
            tool_name: toolName,
            status: 'pending',
            approval_required: false,
            message:
              'Tool request submitted for CTO/admin review. No live build, registry activation, or grant occurs until reviewed.',
          },
        };
      },
    },

    {
      name: 'check_tool_request_status',
      description:
        'Check the status of a previously submitted tool request, or list your pending requests.',
      parameters: {
        request_id: {
          type: 'string',
          description: 'Specific request UUID to check. Omit to list all your requests.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          if (params.request_id) {
            const [data] = await systemQuery(
              'SELECT * FROM tool_requests WHERE id = $1',
              [params.request_id as string],
            );
            return { success: true, data };
          }

          // List all requests by this agent
          const data = await systemQuery(
            'SELECT id, tool_name, status, review_notes, created_at FROM tool_requests WHERE requested_by = $1 ORDER BY created_at DESC LIMIT 20',
            [ctx.agentRole],
          );
          return { success: true, data: { requests: data } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'request_tool_access',
      description:
        'Request access to an EXISTING tool you don\'t currently have. Use when execution returns "not granted". ' +
        'Non-restricted tools (most read/research/web tools) are **activated immediately** for your role. ' +
        'Restricted tools (paid billing, IAM, secrets, tenant admin) file a yellow decision for CTO/founder review only.',
      parameters: {
        tool_name: {
          type: 'string',
          description: 'Name of the existing tool you need access to.',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Why you need this tool — reference the task or request you\'re working on.',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const toolName = typeof params.tool_name === 'string' ? params.tool_name.trim() : '';
        const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
        const agentRole = ctx.agentRole;
        if (!toolName) {
          return { success: false, error: 'tool_name is required' };
        }
        if (!reason) {
          return { success: false, error: 'reason is required' };
        }
        // Judge risk from the tool id only — agent-written reasons often mention "cost"/"pricing"
        // and incorrectly tripped the paid-risk patterns.
        const permissionPolicy = evaluateToolPermissionGate({
          toolName,
          contextText: [],
        });

        if (!(await isKnownToolAsync(toolName))) {
          if (looksLikeKnowledgeArtifact(`${toolName}\n${reason}`)) {
            return {
              success: false,
              error:
                `"${toolName}" appears to be a document/resource name, not a tool. ` +
                'Search SharePoint via existing ODSP tools (for example mcp_ODSPRemoteServer/findFileOrFolder), then request access to the exact tool name if needed.',
            };
          }
          return {
            success: false,
            error: `Tool "${toolName}" does not exist in the system. Use request_new_tool to request it be built.`,
          };
        }

        // Check if already granted
        const existing = await systemQuery(
          `SELECT id FROM agent_tool_grants WHERE agent_role = $1 AND tool_name = $2 AND is_active = true`,
          [agentRole, toolName],
        );
        if (existing.length > 0) {
          invalidateGrantCache(agentRole);
          return {
            success: true,
            data: {
              granted: true,
              tool_name: toolName,
              message: `You already have access to "${toolName}". Cache refreshed — retry your tool call now.`,
            },
          };
        }

        if (!permissionPolicy.requiresApproval) {
          try {
            await systemQuery(
              `INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
               VALUES ('00000000-0000-0000-0000-000000000000'::uuid, $1, $2, 'self-service', $3, true)
               ON CONFLICT (agent_role, tool_name) DO UPDATE SET
                 granted_by = EXCLUDED.granted_by,
                 reason = EXCLUDED.reason,
                 is_active = EXCLUDED.is_active,
                 tenant_id = EXCLUDED.tenant_id,
                 updated_at = NOW()`,
              [agentRole, toolName, `Self-service grant: ${reason.slice(0, 480)}`],
            );
          } catch (insErr) {
            return {
              success: false,
              error: `Could not activate grant for "${toolName}": ${(insErr as Error).message}`,
            };
          }
          invalidateGrantCache(agentRole);
          return {
            success: true,
            data: {
              granted: true,
              tool_name: toolName,
              agent_role: agentRole,
              message: `Access to "${toolName}" is now active for your role. Retry your tool call.`,
            },
          };
        }

        try {
          await queueToolReviewDecision({
            title: `Restricted tool access: ${toolName} → ${agentRole}`,
            summary: `${agentRole} requested access to "${toolName}". Restricted capability — admin review before live grant.\n\nReason: ${reason}`,
            proposedBy: agentRole,
            reasoning: reason,
            requiresApproval: true,
            data: {
              type: 'restricted_tool_access_request',
              agent_role: agentRole,
              tool_name: toolName,
              restriction_reason: permissionPolicy.reason,
              matches: permissionPolicy.matches,
            },
          });
        } catch (decisionErr) {
          return {
            success: false,
            error: `Tool access request could not be routed for review: ${(decisionErr as Error).message}`,
          };
        }

        return {
          success: true,
          data: {
            granted: false,
            pending_admin_review: true,
            pending_approval: true,
            tool_name: toolName,
            agent_role: agentRole,
            message:
              `Access request for "${toolName}" was filed for restricted admin review. ` +
              `Ping Marcus (cto) via send_agent_message with tool name and task if urgent.`,
          },
        };
      },
    },
  ];
}
