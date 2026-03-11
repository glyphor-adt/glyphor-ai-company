/**
 * Dynamic Tool Executor
 *
 * Executes tools registered in the tool_registry DB table at runtime,
 * without requiring a code deploy. Supports API-backed tools with
 * templated HTTP requests and auth configuration.
 *
 * Flow:
 *   1. Agent calls a tool not in the static tool set
 *   2. ToolExecutor checks tool_registry via loadRegisteredTool()
 *   3. If found with api_config → executeApiTool() makes the HTTP call
 *   4. If found without api_config → returns metadata-only result
 *   5. Result is returned to the agent like any other tool
 */

import type { ToolResult, ToolDeclaration } from './types.js';
import type { RegisteredToolDef, ApiToolConfig } from './toolRegistry.js';
import { loadRegisteredTool } from './toolRegistry.js';
import { isKnownToolAsync } from './toolRegistry.js';
import { systemQuery } from '@glyphor/shared/db';

/**
 * Attempt to execute a dynamically registered tool from tool_registry.
 * Returns null if the tool is not in the dynamic registry.
 */
export async function executeDynamicTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<ToolResult | null> {
  // Check if this tool exists in the dynamic registry
  const isDynamic = await isKnownToolAsync(toolName);
  if (!isDynamic) return null;

  const toolDef = await loadRegisteredTool(toolName);
  if (!toolDef) return null;

  // If the tool has an API config, execute the HTTP call
  if (toolDef.api_config) {
    return executeApiTool(toolDef, params);
  }

  // Metadata-only tool (no api_config) — return the tool definition
  // so the agent knows the tool exists but has no executable backend yet
  return {
    success: false,
    error:
      `Tool "${toolName}" is registered but has no executable backend (no api_config). ` +
      `Ask Marcus (CTO) to add an api_config or implement the tool on an MCP server.`,
  };
}

/**
 * Execute an API-backed dynamic tool by interpolating parameters into
 * the url/headers/body templates and making the HTTP request.
 */
async function executeApiTool(
  toolDef: RegisteredToolDef,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const config = toolDef.api_config!;

  try {
    const url = interpolateTemplate(config.url_template, params);
    const headers = buildHeaders(config, params);
    const body = buildBody(config, params);

    const fetchOptions: RequestInit = {
      method: config.method,
      headers,
      signal: AbortSignal.timeout(30_000), // 30s timeout for external APIs
    };

    if (body !== undefined && config.method !== 'GET' && config.method !== 'HEAD') {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        success: false,
        error: `API call failed: ${response.status} ${response.statusText}${errorBody ? ` — ${errorBody.slice(0, 500)}` : ''}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Apply response_path extraction if configured
    if (config.response_path && typeof data === 'object' && data !== null) {
      data = extractPath(data as Record<string, unknown>, config.response_path);
    }

    return { success: true, data };
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('abort') || message.includes('timeout')) {
      return { success: false, error: `API call to ${toolDef.name} timed out after 30s` };
    }
    return { success: false, error: `API call failed: ${message}` };
  }
}

// ─── Template Helpers ────────────────────────────────────────────

/**
 * Replace {{param}} placeholders with parameter values.
 * Supports {{ENV.VAR_NAME}} for environment variable interpolation.
 * URL-encodes parameter values in URL templates.
 */
function interpolateTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_match, key: string) => {
    if (key.startsWith('ENV.')) {
      const envVar = key.slice(4);
      return process.env[envVar] ?? '';
    }
    const value = params[key];
    if (value === undefined || value === null) return '';
    return encodeURIComponent(String(value));
  });
}

/**
 * Same as interpolateTemplate but does NOT URL-encode values.
 * Used for headers and body where raw values are needed.
 */
function interpolateRaw(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_match, key: string) => {
    if (key.startsWith('ENV.')) {
      const envVar = key.slice(4);
      return process.env[envVar] ?? '';
    }
    const value = params[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/**
 * Build request headers from the config template + auth configuration.
 */
function buildHeaders(
  config: ApiToolConfig,
  params: Record<string, unknown>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  // Interpolate header templates
  if (config.headers_template) {
    for (const [key, template] of Object.entries(config.headers_template)) {
      headers[key] = interpolateRaw(template, params);
    }
  }

  // Apply auth
  if (config.auth_type === 'bearer_env' && config.auth_env_var) {
    const token = process.env[config.auth_env_var];
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } else if (config.auth_type === 'header_env' && config.auth_env_var) {
    // header_env: the env var value is placed directly in the Authorization header
    const token = process.env[config.auth_env_var];
    if (token) {
      headers['Authorization'] = token;
    }
  }

  // Set content-type for request bodies
  if (config.method !== 'GET' && config.method !== 'HEAD' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

/**
 * Build request body from the body_template, interpolating parameter values.
 */
function buildBody(
  config: ApiToolConfig,
  params: Record<string, unknown>,
): unknown | undefined {
  if (!config.body_template) return undefined;

  if (typeof config.body_template === 'string') {
    return interpolateRaw(config.body_template, params);
  }

  // Deep-interpolate object template
  return interpolateObject(config.body_template, params);
}

/**
 * Recursively interpolate {{param}} placeholders in an object.
 */
function interpolateObject(
  obj: unknown,
  params: Record<string, unknown>,
): unknown {
  if (typeof obj === 'string') {
    // If the entire string is a single placeholder, return the raw value (preserves types)
    const singleMatch = obj.match(/^\{\{(\w+)\}\}$/);
    if (singleMatch) {
      const key = singleMatch[1];
      return params[key] ?? null;
    }
    return interpolateRaw(obj, params);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateObject(item, params));
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObject(value, params);
    }
    return result;
  }
  return obj;
}

/**
 * Extract a value from a nested object using a dot-separated path.
 * Supports simple paths like "data.results" or ".data.items".
 */
function extractPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.replace(/^\./, '').split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return current;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ─── Dynamic Tool Declarations ──────────────────────────────────

/** Cache of dynamic tool declarations. Refreshed every 60s. */
let _dynamicDeclCache: ToolDeclaration[] = [];
let _dynamicDeclCacheExpiry = 0;
const DECL_CACHE_TTL = 60_000;

/**
 * Load tool declarations for all active dynamically registered tools.
 * These are merged into the agent's tool set so the LLM can call them.
 * Excludes tools that are already in the agent's static tool set.
 */
export async function loadDynamicToolDeclarations(
  staticToolNames: Set<string>,
): Promise<ToolDeclaration[]> {
  if (Date.now() < _dynamicDeclCacheExpiry && _dynamicDeclCache.length > 0) {
    return _dynamicDeclCache.filter((d) => !staticToolNames.has(d.name));
  }

  try {
    const rows = await systemQuery<{
      name: string;
      description: string;
      parameters: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>;
    }>(
      'SELECT name, description, parameters FROM tool_registry WHERE is_active = true',
      [],
    );

    _dynamicDeclCache = rows.map((row): ToolDeclaration => {
      const required = Object.entries(row.parameters ?? {})
        .filter(([, v]) => v.required)
        .map(([k]) => k);

      const decl: ToolDeclaration = {
        name: row.name,
        description: row.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(row.parameters ?? {}).map(([k, v]) => [
              k,
              {
                type: v.type ?? 'string',
                description: v.description ?? '',
                ...(v.enum ? { enum: v.enum } : {}),
              },
            ]),
          ),
        },
      };

      if (required.length > 0) decl.parameters.required = required;
      return decl;
    });

    _dynamicDeclCacheExpiry = Date.now() + DECL_CACHE_TTL;
  } catch {
    // On DB error, return whatever we have cached
  }

  return _dynamicDeclCache.filter((d) => !staticToolNames.has(d.name));
}
