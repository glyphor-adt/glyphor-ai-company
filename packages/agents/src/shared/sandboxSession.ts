/**
 * Sandbox Session Manager — Ephemeral E2B dev environments for autonomous agents
 *
 * Provisions an E2B microVM with a full repo checkout, giving agents:
 *   - Shell access (git, npm, tsc, python, etc.)
 *   - Unrestricted file I/O within the sandbox
 *   - Safe isolation: nothing escapes the container
 *
 * Lifecycle:
 *   1. createSandboxSession()  → provisions VM, clones repo, installs deps
 *   2. session.exec(cmd)        → run arbitrary shell commands
 *   3. session.readFile(path)   → read file contents
 *   4. session.writeFile(path)  → create/overwrite files
 *   5. session.destroy()        → kill the VM (auto-called on timeout)
 *
 * Environment variables:
 *   E2B_API_KEY        — Required. E2B account key.
 *   E2B_DEV_TEMPLATE   — Optional. Pre-built template with Node/Python/Git.
 *   GITHUB_TOKEN        — Required for repo clone.
 *   SANDBOX_IDLE_TIMEOUT_MS — Optional. Default 15 min.
 */

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_CMD_TIMEOUT_MS = 120_000;          // 2 minutes per command
const MAX_CMD_TIMEOUT_MS = 600_000;              // 10 minutes hard cap
const MAX_OUTPUT_BYTES = 256 * 1024;             // 256 KB output cap per command
const PROJECT_DIR = '/home/user/project';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SandboxSessionConfig {
  /** GitHub org/repo to clone (e.g., 'glyphor-adt/glyphor-ai-company'). */
  repo: string;
  /** Branch to check out. Defaults to 'main'. */
  branch?: string;
  /** Agent role for audit trail. */
  agentRole: string;
  /** Agent run ID for audit trail. */
  runId: string;
  /** Idle timeout before auto-destroy. */
  idleTimeoutMs?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True when output was truncated to MAX_OUTPUT_BYTES. */
  truncated: boolean;
  durationMs: number;
}

export interface SandboxSession {
  /** Unique session identifier. */
  sessionId: string;
  /** Working directory inside the sandbox. */
  projectDir: string;
  /** Execute a shell command inside the sandbox. */
  exec(command: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<ShellResult>;
  /** Read a file from the sandbox filesystem. */
  readFile(filePath: string): Promise<string>;
  /** Write a file to the sandbox filesystem. */
  writeFile(filePath: string, content: string): Promise<void>;
  /** List directory contents. */
  listDir(dirPath: string): Promise<string[]>;
  /** Destroy the sandbox VM. */
  destroy(): Promise<void>;
  /** Whether the session is still alive. */
  isAlive(): boolean;
}

// ─── Blocked command patterns (deny list — fail-closed) ───────────────────────

const DENIED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-\w*r\w*f|--no-preserve-root)\s+\/\s*$/i, reason: 'Recursive root delete is blocked' },
  { pattern: /\bmkfs\b/i, reason: 'Filesystem formatting is blocked' },
  { pattern: /\bdd\b.*\bof=\s*\/dev\//i, reason: 'Raw device writes are blocked' },
  { pattern: /:(){ :\|:& };:/i, reason: 'Fork bomb detected' },
  { pattern: /\bcurl\b.*\|\s*(bash|sh|zsh)\b/i, reason: 'Piping remote scripts to shell is blocked' },
  { pattern: /\bwget\b.*\|\s*(bash|sh|zsh)\b/i, reason: 'Piping remote scripts to shell is blocked' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'System power commands are blocked' },
];

function checkDeniedCommand(command: string): string | null {
  for (const { pattern, reason } of DENIED_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

// ─── Output truncation ───────────────────────────────────────────────────────

function truncateOutput(text: string): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= MAX_OUTPUT_BYTES) return { text, truncated: false };
  // Keep first 64KB + last 64KB with truncation notice
  const head = text.slice(0, 65_536);
  const tail = text.slice(-65_536);
  return {
    text: `${head}\n\n... [${bytes - 131_072} bytes truncated] ...\n\n${tail}`,
    truncated: true,
  };
}

// ─── E2B sandbox interface (dynamic import) ───────────────────────────────────

interface E2BSandbox {
  commands: {
    run(cmd: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<{
      stdout?: string;
      stderr?: string;
      exitCode?: number;
    }>;
  };
  files: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    list(path: string): Promise<Array<{ name: string; isDir: boolean }>>;
  };
  kill(): Promise<void>;
}

async function createE2BSandbox(signal?: AbortSignal): Promise<E2BSandbox> {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('E2B_API_KEY is required for sandbox sessions');
  }

  // Dynamic import to avoid breaking cold starts when e2b isn't installed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('e2b') as any;
  const SandboxClass = mod.default ?? mod.Sandbox;
  if (!SandboxClass?.create) {
    throw new Error('E2B Sandbox.create not found — ensure e2b package is installed');
  }

  if (signal?.aborted) throw new Error('Aborted before sandbox creation');

  const templateId = process.env.E2B_DEV_TEMPLATE?.trim() || process.env.E2B_TEMPLATE_ID?.trim();
  const sandbox = await SandboxClass.create({
    apiKey,
    ...(templateId ? { template: templateId } : {}),
    timeoutMs: 900_000, // 15 min sandbox lifetime
  }) as E2BSandbox;

  return sandbox;
}

// ─── Session factory ──────────────────────────────────────────────────────────

let sessionCounter = 0;

export async function createSandboxSession(config: SandboxSessionConfig): Promise<SandboxSession> {
  const {
    repo,
    branch = 'main',
    agentRole,
    runId,
    idleTimeoutMs = Number(process.env.SANDBOX_IDLE_TIMEOUT_MS) || DEFAULT_IDLE_TIMEOUT_MS,
    signal,
  } = config;

  const sessionId = `sandbox-${agentRole}-${++sessionCounter}-${Date.now()}`;
  console.log(`[SandboxSession] Creating ${sessionId} for ${repo}@${branch}`);

  const sandbox = await createE2BSandbox(signal);
  let alive = true;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  // Auto-destroy on idle
  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      console.warn(`[SandboxSession] ${sessionId} idle timeout — destroying`);
      session.destroy().catch(() => {});
    }, idleTimeoutMs);
  }

  // Auto-destroy on abort
  if (signal) {
    signal.addEventListener('abort', () => {
      session.destroy().catch(() => {});
    }, { once: true });
  }

  // Clone the repo
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  if (!ghToken) throw new Error('GITHUB_TOKEN required for repo clone');

  const cloneUrl = `https://x-access-token:${ghToken}@github.com/${repo}.git`;
  const cloneResult = await sandbox.commands.run(
    `git clone --depth=1 --branch=${branch} ${cloneUrl} ${PROJECT_DIR} 2>&1`,
    { timeoutMs: 180_000 },
  );
  if ((cloneResult.exitCode ?? 1) !== 0) {
    await sandbox.kill().catch(() => {});
    throw new Error(`Repo clone failed: ${cloneResult.stderr || cloneResult.stdout || 'unknown error'}`);
  }

  // Configure git for commits
  await sandbox.commands.run(
    `cd ${PROJECT_DIR} && git config user.name "glyphor-agent[${agentRole}]" && git config user.email "agent-${agentRole}@glyphor.ai"`,
    { timeoutMs: 10_000 },
  );

  console.log(`[SandboxSession] ${sessionId} ready — repo cloned to ${PROJECT_DIR}`);
  resetIdleTimer();

  // ─── Session object ─────────────────────────────────────────────────────────

  const session: SandboxSession = {
    sessionId,
    projectDir: PROJECT_DIR,

    async exec(command: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<ShellResult> {
      if (!alive) throw new Error(`Session ${sessionId} is destroyed`);
      resetIdleTimer();

      // Deny-list check
      const denied = checkDeniedCommand(command);
      if (denied) {
        return {
          stdout: '',
          stderr: `DENIED: ${denied}`,
          exitCode: 126,
          truncated: false,
          durationMs: 0,
        };
      }

      const timeout = Math.min(opts?.timeoutMs ?? DEFAULT_CMD_TIMEOUT_MS, MAX_CMD_TIMEOUT_MS);
      const cwd = opts?.cwd ?? PROJECT_DIR;
      const startMs = Date.now();

      const result = await sandbox.commands.run(
        `cd "${cwd}" && ${command} 2>&1`,
        { timeoutMs: timeout },
      );

      const rawStdout = result.stdout ?? '';
      const rawStderr = result.stderr ?? '';
      const stdoutResult = truncateOutput(rawStdout);
      const stderrResult = truncateOutput(rawStderr);

      return {
        stdout: stdoutResult.text,
        stderr: stderrResult.text,
        exitCode: result.exitCode ?? 1,
        truncated: stdoutResult.truncated || stderrResult.truncated,
        durationMs: Date.now() - startMs,
      };
    },

    async readFile(filePath: string): Promise<string> {
      if (!alive) throw new Error(`Session ${sessionId} is destroyed`);
      resetIdleTimer();

      // Resolve relative paths against project dir
      const resolved = filePath.startsWith('/') ? filePath : `${PROJECT_DIR}/${filePath}`;
      return await sandbox.files.read(resolved);
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      if (!alive) throw new Error(`Session ${sessionId} is destroyed`);
      resetIdleTimer();

      const resolved = filePath.startsWith('/') ? filePath : `${PROJECT_DIR}/${filePath}`;
      // Ensure parent directory exists
      const dir = resolved.slice(0, resolved.lastIndexOf('/'));
      if (dir) {
        await sandbox.commands.run(`mkdir -p "${dir}"`, { timeoutMs: 10_000 });
      }
      await sandbox.files.write(resolved, content);
    },

    async listDir(dirPath: string): Promise<string[]> {
      if (!alive) throw new Error(`Session ${sessionId} is destroyed`);
      resetIdleTimer();

      const resolved = dirPath.startsWith('/') ? dirPath : `${PROJECT_DIR}/${dirPath}`;
      const entries = await sandbox.files.list(resolved);
      return entries.map(e => e.isDir ? `${e.name}/` : e.name).sort();
    },

    async destroy(): Promise<void> {
      if (!alive) return;
      alive = false;
      if (idleTimer) clearTimeout(idleTimer);
      console.log(`[SandboxSession] Destroying ${sessionId}`);
      await sandbox.kill().catch(() => {});
    },

    isAlive(): boolean {
      return alive;
    },
  };

  return session;
}
