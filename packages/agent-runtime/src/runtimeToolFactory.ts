/**
 * Runtime Tool Factory — Lets agents define and register new tools mid-run.
 *
 * A runtime tool has a name, description, parameter definitions, and an
 * implementation (HTTP API call, database query, or sandboxed JavaScript).
 * Tools are validated for safety, registered in the current run's tool set,
 * and optionally persisted to the database for future runs.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { ToolDefinition, ToolParameter, ToolResult } from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface RuntimeToolDefinition {
  name: string;                         // e.g. 'analyze_csv_column'
  description: string;                  // What the tool does
  parameters: Record<string, {          // JSON Schema-like parameter definitions (from LLM)
    type: string;
    description: string;
    required?: boolean;
    enum?: string[];
  }>;
  implementation: RuntimeToolImpl;
  uses?: number;                        // Usage counter (from DB)
}

export type RuntimeToolImpl =
  | {
      type: 'http';
      method: 'GET' | 'POST';
      urlTemplate: string;              // Use {{param_name}} for interpolation
      headers?: Record<string, string>;
      bodyTemplate?: string;            // JSON string with {{param_name}} placeholders
    }
  | {
      type: 'db_query';
      table: string;
      select: string;
      filters: Record<string, string>;  // column → value template with {{param_name}}
    }
  | {
      type: 'code';
      language: 'javascript';
      code: string;                     // Sandboxed JS — set `result` variable for output
    };

// ─── Safety constraints ─────────────────────────────────────────

const BLOCKED_CODE_PATTERNS = [
  /process\.(exit|env|kill|pid)/i,
  /require\s*\(/i,
  /import\s+([\w{},\s*]+\s+from\s+)?['"]/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /child_process/i,
  /\bfs\b\./i,
  /\.env\b/i,
  /SUPABASE_SERVICE_KEY/i,
  /DB_PASSWORD/i,
  /GOOGLE_AI_API_KEY/i,
  /OPENAI_API_KEY/i,
  /ANTHROPIC_API_KEY/i,
  /exec\s*\(/i,
  /spawn\s*\(/i,
  /globalThis/i,
  /XMLHttpRequest/i,
  /WebSocket/i,
];

const BLOCKED_TABLES = [
  'tenants', 'tenant_users', 'agent_reasoning_config',
  'platform_iam_state', 'platform_secret_rotation',
  'auth',
];

const BLOCKED_URL_PATTERNS = [
  /localhost/i,
  /127\.0\.0\./,
  /10\.\d+\.\d+\.\d+/,
  /192\.168\./,
  /169\.254\./,
  /metadata\.google/i,
];

const MAX_RUNTIME_TOOLS_PER_RUN = 3;
const MAX_PERSISTED_TOOLS = 20; // Persisted tools don't count against per-run limit
const MAX_CODE_LENGTH = 2000;
const MAX_RESPONSE_LENGTH = 4000;

// ─── Factory ────────────────────────────────────────────────────

export class RuntimeToolFactory {
  private registeredTools: Map<string, {
    definition: RuntimeToolDefinition;
    toolDef: ToolDefinition;
    persisted: boolean;
  }> = new Map();

  /** Count of tools created during this run (excludes persisted loads) */
  private runCreatedCount = 0;

  constructor() {}

  /**
   * Validate and register a runtime tool definition.
   * Returns a ToolDefinition compatible with the existing ToolExecutor.
   */
  register(definition: RuntimeToolDefinition, fromPersisted = false): ToolDefinition {
    // ─── Limit check ───
    if (!fromPersisted) {
      if (this.runCreatedCount >= MAX_RUNTIME_TOOLS_PER_RUN) {
        throw new Error(
          `Runtime tool limit reached (max ${MAX_RUNTIME_TOOLS_PER_RUN} per run). ` +
          `Currently created this run: ${this.runCreatedCount}`,
        );
      }
    } else {
      const persistedCount = Array.from(this.registeredTools.values()).filter(r => r.persisted).length;
      if (persistedCount >= MAX_PERSISTED_TOOLS) {
        throw new Error(`Persisted runtime tool limit reached (max ${MAX_PERSISTED_TOOLS})`);
      }
    }

    // ─── Name validation ───
    if (!definition.name || definition.name.length > 64) {
      throw new Error('Tool name must be 1-64 characters');
    }
    if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
      throw new Error(
        'Tool name must be lowercase, start with a letter, and contain only letters, numbers, and underscores',
      );
    }

    // ─── Implementation validation ───
    this.validateImplementation(definition.implementation);

    // ─── Build ToolDefinition ───
    const prefixedName = `runtime_${definition.name}`;

    // Convert LLM-style parameters to ToolParameter format
    const parameters: Record<string, ToolParameter> = {};
    for (const [key, param] of Object.entries(definition.parameters)) {
      parameters[key] = {
        type: param.type as ToolParameter['type'],
        description: param.description,
        required: param.required,
        ...(param.enum ? { enum: param.enum } : {}),
      };
    }

    // Capture `this` for execute closure
    const factory = this;

    const toolDef: ToolDefinition = {
      name: prefixedName,
      description: `[Runtime Tool] ${definition.description}`,
      parameters,
      execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const result = await factory.executeImpl(prefixedName, params as Record<string, any>);
          return { success: true, data: result };
        } catch (err: any) {
          return { success: false, error: `Runtime tool error: ${err.message}` };
        }
      },
    };

    this.registeredTools.set(prefixedName, { definition, toolDef, persisted: fromPersisted });
    if (!fromPersisted) this.runCreatedCount++;

    return toolDef;
  }

  /**
   * Execute a registered runtime tool.
   */
  async execute(toolName: string, args: Record<string, any>): Promise<string> {
    const result = await this.executeImpl(toolName, args);
    return result;
  }

  /**
   * Get all registered runtime tools as ToolDefinitions (for injection into agent tool set).
   */
  getRegisteredTools(): ToolDefinition[] {
    return Array.from(this.registeredTools.values()).map(r => r.toolDef);
  }

  /**
   * Persist a runtime tool to the database for future runs.
   */
  async persist(toolName: string, createdBy: string): Promise<void> {
    const registered = this.registeredTools.get(toolName);
    if (!registered) {
      throw new Error(`Cannot persist — tool not found: ${toolName}`);
    }

    const def = registered.definition;
    await systemQuery(
      `INSERT INTO runtime_tools (name, description, parameters, implementation, created_by, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, parameters = EXCLUDED.parameters, implementation = EXCLUDED.implementation, created_by = EXCLUDED.created_by, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at`,
      [def.name, def.description, JSON.stringify(def.parameters), JSON.stringify(def.implementation), createdBy, true, new Date().toISOString()],
    );
    registered.persisted = true;
  }

  /**
   * Load all active persisted runtime tools from the database.
   * Called once at the start of each agent run.
   */
  async loadPersisted(): Promise<number> {
    const data = await systemQuery<{
      name: string;
      description: string;
      parameters: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>;
      implementation: RuntimeToolImpl;
      uses: number;
    }>(
      'SELECT * FROM runtime_tools WHERE is_active = true',
      [],
    );

    let loaded = 0;
    for (const tool of data) {
      try {
        // Skip if already registered (avoid duplicates on repeated calls)
        if (this.registeredTools.has(`runtime_${tool.name}`)) continue;
        this.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          implementation: tool.implementation,
          uses: tool.uses,
        }, true);
        loaded++;
      } catch {
        // Skip tools that fail validation (stale, limit reached, etc.)
      }
    }
    return loaded;
  }

  // ─── Implementation Executor (private) ────────────────────────

  private async executeImpl(toolName: string, args: Record<string, any>): Promise<string> {
    const registered = this.registeredTools.get(toolName);
    if (!registered) {
      throw new Error(`Runtime tool not found: ${toolName}`);
    }

    const impl = registered.definition.implementation;
    let result: string;

    switch (impl.type) {
      case 'http':
        result = await this.executeHttp(impl, args);
        break;
      case 'db_query':
        result = await this.executeDbQuery(impl, args);
        break;
      case 'code':
        result = await this.executeCode(impl, args);
        break;
      default:
        throw new Error(`Unknown implementation type: ${(impl as any).type}`);
    }

    // Update usage counter (fire and forget)
    const uses = (registered.definition.uses ?? 0) + 1;
    registered.definition.uses = uses;
    systemQuery(
      'UPDATE runtime_tools SET uses = $1, last_used_at = $2 WHERE name = $3',
      [uses, new Date().toISOString(), registered.definition.name],
    ).catch(() => {});

    return result.slice(0, MAX_RESPONSE_LENGTH);
  }

  // ─── Implementation Executors ─────────────────────────────────

  private async executeHttp(
    impl: Extract<RuntimeToolImpl, { type: 'http' }>,
    args: Record<string, any>,
  ): Promise<string> {
    const url = this.interpolate(impl.urlTemplate, args);

    // Block internal/metadata URLs
    for (const pattern of BLOCKED_URL_PATTERNS) {
      if (pattern.test(url)) {
        throw new Error('URL blocked: internal or metadata addresses are not allowed');
      }
    }

    const fetchOptions: RequestInit = {
      method: impl.method,
      headers: {
        'Content-Type': 'application/json',
        ...(impl.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000), // 10s timeout
    };

    if (impl.method === 'POST' && impl.bodyTemplate) {
      fetchOptions.body = this.interpolate(impl.bodyTemplate, args);
    }

    const response = await fetch(url, fetchOptions);
    return await response.text();
  }

  private async executeDbQuery(
    impl: Extract<RuntimeToolImpl, { type: 'db_query' }>,
    args: Record<string, any>,
  ): Promise<string> {
    const tableLower = impl.table.toLowerCase();
    if (BLOCKED_TABLES.some(t => tableLower.includes(t))) {
      throw new Error(`Access to table '${impl.table}' is not allowed`);
    }

    const filterEntries = Object.entries(impl.filters);
    const conditions = filterEntries.map(([column], i) => `${column} = $${i + 1}`);
    const values = filterEntries.map(([, valueTemplate]) => this.interpolate(valueTemplate, args));

    let sql = `SELECT ${impl.select} FROM ${impl.table}`;
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' LIMIT 50';

    try {
      const data = await systemQuery(sql, values);
      return JSON.stringify(data, null, 2);
    } catch (err: any) {
      return `Query error: ${err.message}`;
    }
  }

  private async executeCode(
    impl: Extract<RuntimeToolImpl, { type: 'code' }>,
    args: Record<string, any>,
  ): Promise<string> {
    const sandbox = {
      args: Object.freeze({ ...args }),
      Math, JSON, String, Array, Object, Date, Number, Boolean,
      parseInt, parseFloat, isNaN, isFinite,
      encodeURIComponent, decodeURIComponent,
      result: undefined as any,
    };

    try {
      const fn = new Function(
        ...Object.keys(sandbox),
        `"use strict";\n${impl.code}\nreturn typeof result !== 'undefined' ? result : 'No result set';`,
      );

      const output = fn(...Object.values(sandbox));
      return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    } catch (err: any) {
      return `Code execution error: ${err.message}`;
    }
  }

  // ─── Validation ───────────────────────────────────────────────

  private validateImplementation(impl: RuntimeToolImpl): void {
    switch (impl.type) {
      case 'code':
        if (!impl.code || impl.code.length > MAX_CODE_LENGTH) {
          throw new Error(`Code must be 1-${MAX_CODE_LENGTH} characters`);
        }
        for (const pattern of BLOCKED_CODE_PATTERNS) {
          if (pattern.test(impl.code)) {
            throw new Error(`Code contains blocked pattern: ${pattern.source}`);
          }
        }
        break;

      case 'db_query':
        if (!impl.table || !impl.select) {
          throw new Error('db_query requires table and select');
        }
        if (BLOCKED_TABLES.some(t => impl.table.toLowerCase().includes(t))) {
          throw new Error(`Table '${impl.table}' is blocked`);
        }
        break;

      case 'http':
        if (!impl.urlTemplate) {
          throw new Error('http requires urlTemplate');
        }
        if (!impl.urlTemplate.startsWith('https://')) {
          throw new Error('HTTP tools must use HTTPS');
        }
        for (const pattern of BLOCKED_URL_PATTERNS) {
          if (pattern.test(impl.urlTemplate)) {
            throw new Error('URL template contains blocked address pattern');
          }
        }
        break;

      default:
        throw new Error(`Unknown implementation type: ${(impl as any).type}`);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private interpolate(template: string, args: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(args)) {
      result = result.replace(
        new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
        String(value),
      );
    }
    return result;
  }
}
