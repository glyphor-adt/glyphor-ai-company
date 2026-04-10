/**
 * Sandbox Dev Tools — Full autonomous development environment for agents
 *
 * Provides 4 tools that give agents Claude-Code-level autonomy inside a
 * sandboxed E2B microVM:
 *
 *   sandbox_shell      — Execute any shell command (git, npm, tsc, python, etc.)
 *   sandbox_file_read  — Read any file in the workspace
 *   sandbox_file_write — Create or overwrite any file
 *   sandbox_file_edit  — In-place find-and-replace editing (exact string match)
 *
 * Architecture:
 *   - All tools operate inside an ephemeral E2B container
 *   - The repo is cloned on first use (lazy session creation)
 *   - Nothing escapes the sandbox — agents commit changes via git push
 *   - Sessions auto-destroy after idle timeout (default 15 min)
 *
 * Usage:
 *
 *   import { createSandboxDevTools } from '../shared/sandboxDevTools.js';
 *
 *   const tools = createSandboxDevTools({
 *     repo: 'glyphor-adt/glyphor-ai-company',
 *     branch: 'feature/agent-fix-123',
 *     agentRole: 'frontend-engineer',
 *     runId: 'ava-fix-2026-04-06',
 *     allowedShellPatterns: ['npm *', 'git *', 'node *', 'tsc *'],
 *   });
 *
 * Permission model:
 *   - Deny list: destructive host-escape patterns are always blocked
 *   - Allow list (optional): restrict to known-safe command prefixes
 *   - All operations are sandboxed — worst case is wasted compute, not data loss
 */

import type { ToolDefinition, ToolResult, ToolContext } from '@glyphor/agent-runtime';
import { buildTool } from '@glyphor/agent-runtime';
import {
  createSandboxSession,
  type SandboxSession,
  type SandboxSessionConfig,
  type ShellResult,
} from './sandboxSession.js';

// ─── Configuration ────────────────────────────────────────────────────────────

/** One checkout inside the E2B sandbox (multi-repo = Claude-Code–style multi-root). */
export interface SandboxWorkspaceSpec {
  /** Stable id passed as \`workspace_id\` on sandbox tools (e.g. \`glyphor-ai-company\`). */
  id: string;
  /** GitHub org/repo (e.g., 'glyphor-adt/glyphor-ai-company'). */
  repo: string;
  /** Branch to clone. Defaults to 'main'. */
  branch?: string;
}

export interface SandboxDevToolsConfig {
  /**
   * Multiple repos in one run — each tool call must pass \`workspace_id\` (or omit when only one workspace).
   * Prefer this for Marcus/Mia so they can work in glyphor-ai-company and glyphor-site like a Claude agent.
   */
  workspaces?: SandboxWorkspaceSpec[];
  /** Single-repo shorthand — converted to one workspace with id \`default\`. */
  repo?: string;
  /** Branch when using \`repo\` shorthand. Defaults to 'main'. */
  branch?: string;
  /** Agent role (for audit + git user identity). */
  agentRole: string;
  /** Run ID (for audit trail). */
  runId: string;
  /**
   * Optional allowlist of shell command prefixes. When set, only commands
   * starting with one of these prefixes are allowed. When empty/undefined,
   * all commands are allowed (deny list still applies).
   *
   * Examples: ['npm ', 'git ', 'node ', 'tsc ', 'python ', 'cat ', 'ls ', 'grep ']
   */
  allowedShellPatterns?: string[];
  /** Max file size for reads (bytes). Default 2 MB. */
  maxFileReadBytes?: number;
  /** Max file size for writes (bytes). Default 1 MB. */
  maxFileWriteBytes?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

function normalizeWorkspaces(config: SandboxDevToolsConfig): SandboxWorkspaceSpec[] {
  if (config.workspaces && config.workspaces.length > 0) {
    return config.workspaces;
  }
  if (config.repo) {
    return [{ id: 'default', repo: config.repo, branch: config.branch }];
  }
  throw new Error('[sandboxDevTools] Provide workspaces[] or repo for sandbox tools.');
}

const DEFAULT_MAX_READ = 2 * 1024 * 1024;   // 2 MB
const DEFAULT_MAX_WRITE = 1 * 1024 * 1024;  // 1 MB

// ─── Lazy session management ──────────────────────────────────────────────────

/**
 * Creates a lazy-initialized session holder. The sandbox is only provisioned
 * on the first tool call, avoiding cost when tools are registered but unused.
 */
function createLazySession(binding: SandboxSessionConfig) {
  let session: SandboxSession | null = null;
  let sessionPromise: Promise<SandboxSession> | null = null;

  async function getSession(): Promise<SandboxSession> {
    if (session?.isAlive()) return session;

    if (!sessionPromise) {
      sessionPromise = createSandboxSession(binding).then(s => {
        session = s;
        sessionPromise = null;
        return s;
      }).catch(err => {
        sessionPromise = null;
        throw err;
      });
    }

    return sessionPromise;
  }

  return { getSession };
}

function workspaceIdHelp(workspaces: SandboxWorkspaceSpec[], multi: boolean): string {
  const ids = workspaces.map(w => w.id).join(', ');
  if (!multi) {
    return `workspace_id is optional (defaults to "${workspaces[0]?.id ?? 'default'}").`;
  }
  return `workspace_id is REQUIRED. Valid values: ${ids}. Use glyphor-ai-company for the monorepo (agents, scheduler, dashboard) and glyphor-site for the public marketing site.`;
}

function resolveWorkspaceId(
  params: Record<string, unknown>,
  workspaces: SandboxWorkspaceSpec[],
): { ok: true; id: string } | { ok: false; error: string } {
  const multi = workspaces.length > 1;
  const raw = typeof params.workspace_id === 'string' ? params.workspace_id.trim() : '';
  const ids = new Set(workspaces.map(w => w.id));
  if (multi) {
    if (!raw) {
      return { ok: false, error: `workspace_id is required. Valid: ${[...ids].join(', ')}` };
    }
    if (!ids.has(raw)) {
      return { ok: false, error: `Unknown workspace_id "${raw}". Valid: ${[...ids].join(', ')}` };
    }
    return { ok: true, id: raw };
  }
  if (raw && !ids.has(raw)) {
    return { ok: false, error: `Unknown workspace_id "${raw}". Valid: ${[...ids].join(', ')}` };
  }
  return { ok: true, id: raw || workspaces[0]!.id };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSandboxDevTools(config: SandboxDevToolsConfig): ToolDefinition[] {
  const {
    allowedShellPatterns,
    maxFileReadBytes = DEFAULT_MAX_READ,
    maxFileWriteBytes = DEFAULT_MAX_WRITE,
  } = config;

  const workspaces = normalizeWorkspaces(config);
  const multi = workspaces.length > 1;
  const wsHelp = workspaceIdHelp(workspaces, multi);

  const sessionById = new Map<string, ReturnType<typeof createLazySession>>();
  for (const ws of workspaces) {
    sessionById.set(
      ws.id,
      createLazySession({
        repo: ws.repo,
        branch: ws.branch,
        agentRole: config.agentRole,
        runId: `${config.runId}-${ws.id}`,
        signal: config.signal,
      }),
    );
  }

  async function resolveSession(params: Record<string, unknown>): Promise<
    { ok: true; session: SandboxSession; workspaceId: string } | { ok: false; error: string }
  > {
    const resolved = resolveWorkspaceId(params, workspaces);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const holder = sessionById.get(resolved.id);
    if (!holder) return { ok: false, error: `No sandbox session for workspace ${resolved.id}` };
    try {
      const session = await holder.getSession();
      return { ok: true, session, workspaceId: resolved.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const workspaceParam = {
    workspace_id: {
      type: 'string',
      description: wsHelp,
      required: false,
    },
  } as const;

  // ─── Tool 1: sandbox_shell ─────────────────────────────────────────────────

  const sandboxShell: ToolDefinition = {
    name: 'sandbox_shell',
    description:
      'Execute a shell command in a sandboxed development environment with the full repo checkout. ' +
      'Supports git, npm, node, tsc, python, grep, find, cat, sed, and any CLI tool available in the container. ' +
      'Use this for: running tests, installing dependencies, building code, checking git status, ' +
      'running linters, searching code, and any development task. ' +
      'The working directory defaults to the project root. ' +
      'Commands run in an isolated container — nothing affects the host or production. ' +
      wsHelp,
    parameters: {
      ...workspaceParam,
      command: {
        type: 'string',
        description: 'The shell command to execute (e.g., "npm test", "git diff", "grep -r TODO src/")',
        required: true,
      },
      timeout_ms: {
        type: 'number',
        description: 'Command timeout in milliseconds (default 120000, max 600000)',
        required: false,
      },
      working_directory: {
        type: 'string',
        description: 'Working directory relative to project root (e.g., "packages/dashboard")',
        required: false,
      },
    },
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const command = String(params.command ?? '').trim();
      if (!command) {
        return { success: false, error: 'command is required' };
      }

      // Allowlist check (if configured)
      if (allowedShellPatterns && allowedShellPatterns.length > 0) {
        const allowed = allowedShellPatterns.some(p => command.startsWith(p));
        if (!allowed) {
          return {
            success: false,
            error: `Command not in allowlist. Allowed prefixes: ${allowedShellPatterns.join(', ')}`,
          };
        }
      }

      try {
        const rs = await resolveSession(params);
        if (!rs.ok) return { success: false, error: rs.error };
        const { session, workspaceId } = rs;
        const cwd = params.working_directory
          ? `${session.projectDir}/${String(params.working_directory)}`
          : undefined;

        const result = await session.exec(command, {
          timeoutMs: typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined,
          cwd,
        });

        return {
          success: result.exitCode === 0,
          data: {
            workspace_id: workspaceId,
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exitCode,
            truncated: result.truncated,
            duration_ms: result.durationMs,
          },
          ...(result.exitCode !== 0 ? { error: `Command exited with code ${result.exitCode}` } : {}),
        };
      } catch (err) {
        return {
          success: false,
          error: `Sandbox shell error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };

  // ─── Tool 2: sandbox_file_read (parallel-safe reads — Claude Code parity) ─

  const sandboxFileRead = buildTool({
    name: 'sandbox_file_read',
    description:
      'Read the contents of a file from the sandboxed development environment. ' +
      'Path is relative to the project root (e.g., "src/index.ts", "package.json"). ' +
      'Can read any file in the repo checkout — no path restrictions. ' +
      wsHelp,
    parameters: {
      ...workspaceParam,
      path: {
        type: 'string',
        description: 'File path relative to project root',
        required: true,
      },
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    timeoutMs: 120_000,
    execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
      const filePath = String(params.path ?? '').trim();
      if (!filePath) {
        return { success: false, error: 'path is required' };
      }

      try {
        const rs = await resolveSession(params);
        if (!rs.ok) return { success: false, error: rs.error };
        const { session, workspaceId } = rs;
        const content = await session.readFile(filePath);

        if (Buffer.byteLength(content, 'utf8') > maxFileReadBytes) {
          return {
            success: false,
            error: `File exceeds ${maxFileReadBytes} byte read limit. Use sandbox_shell with head/tail/grep to read portions.`,
          };
        }

        return {
          success: true,
          data: { workspace_id: workspaceId, path: filePath, content, size_bytes: Buffer.byteLength(content, 'utf8') },
        };
      } catch (err) {
        return {
          success: false,
          error: `Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });

  // ─── Tool 3: sandbox_file_write ────────────────────────────────────────────

  const sandboxFileWrite: ToolDefinition = {
    name: 'sandbox_file_write',
    description:
      'Create or overwrite a file in the sandboxed development environment. ' +
      'Path is relative to the project root. Parent directories are created automatically. ' +
      'Use this for creating new files or replacing entire file contents. ' +
      'For surgical edits to existing files, prefer sandbox_file_edit. ' +
      wsHelp,
    parameters: {
      ...workspaceParam,
      path: {
        type: 'string',
        description: 'File path relative to project root',
        required: true,
      },
      content: {
        type: 'string',
        description: 'The full file content to write',
        required: true,
      },
    },
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const filePath = String(params.path ?? '').trim();
      const content = String(params.content ?? '');

      if (!filePath) {
        return { success: false, error: 'path is required' };
      }

      if (Buffer.byteLength(content, 'utf8') > maxFileWriteBytes) {
        return {
          success: false,
          error: `Content exceeds ${maxFileWriteBytes} byte write limit.`,
        };
      }

      try {
        const rs = await resolveSession(params);
        if (!rs.ok) return { success: false, error: rs.error };
        const { session, workspaceId } = rs;
        await session.writeFile(filePath, content);
        return {
          success: true,
          data: { workspace_id: workspaceId, path: filePath, size_bytes: Buffer.byteLength(content, 'utf8') },
          filesWritten: 1,
        };
      } catch (err) {
        return {
          success: false,
          error: `Failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };

  // ─── Tool 4: sandbox_file_edit ─────────────────────────────────────────────

  const sandboxFileEdit: ToolDefinition = {
    name: 'sandbox_file_edit',
    description:
      'Make a surgical edit to an existing file in the sandboxed development environment. ' +
      'Finds an exact string match of old_string and replaces it with new_string. ' +
      'The old_string must match EXACTLY (including whitespace and indentation). ' +
      'If old_string is empty, the new_string is appended to the file. ' +
      'Only replaces the FIRST occurrence. For multiple replacements, call multiple times. ' +
      wsHelp,
    parameters: {
      ...workspaceParam,
      path: {
        type: 'string',
        description: 'File path relative to project root',
        required: true,
      },
      old_string: {
        type: 'string',
        description: 'The exact text to find in the file (must match precisely including whitespace)',
        required: true,
      },
      new_string: {
        type: 'string',
        description: 'The replacement text',
        required: true,
      },
    },
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const filePath = String(params.path ?? '').trim();
      const oldString = String(params.old_string ?? '');
      const newString = String(params.new_string ?? '');

      if (!filePath) {
        return { success: false, error: 'path is required' };
      }

      try {
        const rs = await resolveSession(params);
        if (!rs.ok) return { success: false, error: rs.error };
        const { session, workspaceId } = rs;

        // Read current content
        const content = await session.readFile(filePath);

        // Append mode
        if (oldString === '') {
          const updated = content + newString;
          await session.writeFile(filePath, updated);
          return {
            success: true,
            data: {
              workspace_id: workspaceId,
              path: filePath,
              action: 'appended',
              bytes_added: Buffer.byteLength(newString, 'utf8'),
            },
            filesWritten: 1,
          };
        }

        // Find-and-replace mode
        const index = content.indexOf(oldString);
        if (index === -1) {
          // Provide a helpful snippet of what the file actually contains near the intended edit
          const lines = content.split('\n');
          const preview = lines.length > 20
            ? `File has ${lines.length} lines. First 10:\n${lines.slice(0, 10).join('\n')}`
            : content.slice(0, 500);
          return {
            success: false,
            error: `old_string not found in ${filePath}. Ensure it matches exactly including whitespace.\n\nFile preview:\n${preview}`,
          };
        }

        // Check for ambiguous matches
        const secondIndex = content.indexOf(oldString, index + 1);
        const multipleMatches = secondIndex !== -1;

        const updated = content.slice(0, index) + newString + content.slice(index + oldString.length);

        if (Buffer.byteLength(updated, 'utf8') > maxFileWriteBytes) {
          return {
            success: false,
            error: `Edited file would exceed ${maxFileWriteBytes} byte write limit.`,
          };
        }

        await session.writeFile(filePath, updated);

        return {
          success: true,
          data: {
            workspace_id: workspaceId,
            path: filePath,
            action: 'replaced',
            line: content.slice(0, index).split('\n').length,
            ...(multipleMatches ? { warning: 'Multiple matches found — only the first was replaced' } : {}),
          },
          filesWritten: 1,
        };
      } catch (err) {
        return {
          success: false,
          error: `Failed to edit ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };

  return [sandboxShell, sandboxFileRead, sandboxFileWrite, sandboxFileEdit];
}

// ─── Convenience: push sandbox changes back to GitHub ─────────────────────────

/**
 * Helper to commit and push all changes from a sandbox session.
 * Call this after the agent finishes its work to persist changes.
 */
export async function pushSandboxChanges(
  session: SandboxSession,
  opts: {
    branch: string;
    commitMessage: string;
    /** Push to remote? Default true. */
    push?: boolean;
  },
): Promise<ShellResult> {
  const { branch, commitMessage, push = true } = opts;

  // Create branch if needed
  await session.exec(`git checkout -B ${branch}`);

  // Stage all changes
  await session.exec('git add -A');

  // Commit
  const sanitizedMessage = commitMessage.replace(/'/g, "'\\''");
  const commitResult = await session.exec(`git commit -m '${sanitizedMessage}' --allow-empty`);

  if (!push) return commitResult;

  // Push
  return session.exec(`git push origin ${branch} --force-with-lease`, { timeoutMs: 60_000 });
}
