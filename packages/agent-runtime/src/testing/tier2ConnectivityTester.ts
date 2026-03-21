import { loadRegisteredTool } from '../toolRegistry.js';
import type { ToolDefinition } from '../types.js';
import { ToolClassification } from './toolClassifier.js';
import { buildTestContext } from './testContext.js';
import { systemQuery as dbQuery } from '@glyphor/shared/db';
import { executeDynamicTool } from '../dynamicToolExecutor.js';

let staticToolMapPromise: Promise<Map<string, ToolDefinition>> | null = null;

function dynamicImportModule(modulePath: string): Promise<any> {
  return new Function('p', 'return import(p);')(modulePath) as Promise<any>;
}

async function getStaticToolMap(): Promise<Map<string, ToolDefinition>> {
  if (!staticToolMapPromise) {
    staticToolMapPromise = (async () => {
      try {
        const mod = await dynamicImportModule('../../../smoketest/src/layers/layer16-tools.js');
        const collect = mod?.collectLayer16ToolDefinitions;
        if (typeof collect !== 'function') {
          console.warn('[Tier2] collectLayer16ToolDefinitions export not found; static fallback unavailable');
          return new Map<string, ToolDefinition>();
        }

        const defs = collect() as ToolDefinition[];
        return new Map(defs.map((def) => [def.name, def]));
      } catch (err) {
        console.warn('[Tier2] Failed to load static tool catalog:', String(err));
        return new Map<string, ToolDefinition>();
      }
    })();
  }

  return staticToolMapPromise;
}

async function loadStaticToolDefinition(toolName: string): Promise<ToolDefinition | null> {
  const map = await getStaticToolMap();
  return map.get(toolName) ?? null;
}

async function executeStaticTool(
  tool: ToolDefinition,
  testInput: Record<string, unknown>,
  startedAt: number,
): Promise<ConnectivityResult> {
  try {
    const context = buildTestContext();
    const result = await Promise.race([
      tool.execute(testInput, context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT: static tool execution exceeded 8000ms')), 8000),
      ),
    ]);

    if (!result || typeof result.success !== 'boolean') {
      return {
        ok: false,
        responseMs: Date.now() - startedAt,
        connectivityOk: null,
        executionOk: false,
        error: 'Static tool returned invalid result shape',
        errorType: 'unknown',
      };
    }

    if (result.success === false) {
      const err = result.error ?? 'Static tool returned success=false';
      const errorType = classifyError(err);
      return {
        ok: false,
        responseMs: Date.now() - startedAt,
        connectivityOk: errorType === 'connection' ? false : true,
        executionOk: false,
        response: result,
        error: err,
        errorType,
      };
    }

    return {
      ok: true,
      responseMs: Date.now() - startedAt,
      connectivityOk: true,
      executionOk: true,
      response: result,
    };
  } catch (err: any) {
    const errorType = classifyError(err);
    return {
      ok: false,
      responseMs: Date.now() - startedAt,
      connectivityOk: errorType === 'connection' ? false : null,
      executionOk: false,
      error: String(err),
      errorType,
    };
  }
}

export interface ConnectivityResult {
  ok: boolean;
  responseMs: number;
  connectivityOk: boolean | null;
  executionOk: boolean | null;
  response?: any;
  error?: string;
  errorType?: string;
  skipReason?: string;
  statusCode?: number;
}

export async function runConnectivityTest(
  toolName: string,
  classification: ToolClassification
): Promise<ConnectivityResult> {

  const start = Date.now();

  try {
    if (classification.riskTier === 'read_only') {
      const tool = await loadRegisteredTool(toolName);
      if (!tool) {
        const staticTool = await loadStaticToolDefinition(toolName);
        if (!staticTool) {
          return {
            ok: true,
            responseMs: 0,
            connectivityOk: null,
            executionOk: null,
            skipReason: 'Static tool not found in Layer 16 factory catalog',
          };
        }

        const staticInput = classification.testInput ?? buildSafeTestInput(staticTool);
        return executeStaticTool(staticTool, staticInput, start);
      }
      
      const testInput = classification.testInput ?? buildSafeTestInput(tool);
      const result = await executeDynamicTool(toolName, testInput);

      if (!result) throw new Error('Dynamic tool execute returned null');

      if (result.success === false) {
        const err = result.error ?? 'Dynamic tool returned success=false';
        const errorType = classifyError(err);
        return {
          ok: false,
          responseMs: Date.now() - start,
          connectivityOk: errorType === 'connection' ? false : true,
          executionOk: false,
          response: result,
          error: err,
          errorType,
        };
      }

      return {
        ok: true,
        responseMs: Date.now() - start,
        connectivityOk: true,
        executionOk: true,
        response: result,
      };
    }

    if (classification.riskTier === 'external_api') {
      // Probe the service health endpoint, not the tool itself
      const serviceUrl = getServiceHealthUrl(toolName);
      if (!serviceUrl) {
        return { ok: true, responseMs: 0, connectivityOk: true, executionOk: null,
          skipReason: 'No health endpoint known for this service' };
      }

      const response = await fetch(serviceUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      return {
        ok: response.ok,
        responseMs: Date.now() - start,
        connectivityOk: response.ok,
        executionOk: null,  // not tested at tier 2 for external APIs
        statusCode: response.status,
      };
    }

  } catch (err: any) {
    return {
      ok: false,
      responseMs: Date.now() - start,
      connectivityOk: false,
      executionOk: false,
      error: String(err),
      errorType: classifyError(err),
    };
  }

  return { ok: true, responseMs: 0, connectivityOk: null, executionOk: null };
}

function buildSafeTestInput(tool: any): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const params = tool.parameters?.properties || tool.parameters || {};
  const requiredFromSchema = Array.isArray(tool.parameters?.required)
    ? tool.parameters.required
    : [];
  const requiredFromDefs = Object.entries(params)
    .filter(([, def]) => Boolean((def as any)?.required))
    .map(([name]) => name);
  const required = new Set<string>([...requiredFromSchema, ...requiredFromDefs]);

  for (const [name, param] of Object.entries(params)) {
    const p = param as any;
    if (!required.has(name)) continue;

    const type = Array.isArray(p.type)
      ? p.type.find((t: string) => t !== 'null') ?? p.type[0]
      : p.type;

    switch (type) {
      case 'string':  input[name] = p.enum?.[0] ?? 'test'; break;
      case 'number':  input[name] = 0; break;
      case 'integer': input[name] = 0; break;
      case 'boolean': input[name] = false; break;
      case 'array':   input[name] = []; break;
      case 'object':  input[name] = {}; break;
      default:        input[name] = null; break;
    }
  }
  return input;
}

function classifyError(err: unknown): string {
  const msg = String(err).toLowerCase();
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')
      || msg.includes('forbidden') || msg.includes('api key')) return 'auth';
  if (msg.includes('404') || msg.includes('not found')) return 'not_found';
  if (msg.includes('timeout') || msg.includes('econnrefused')
      || msg.includes('network') || msg.includes('abort_err')) return 'connection';
  if (msg.includes('enotfound') || msg.includes('dns')) return 'connection';
  return 'unknown';
}

function getServiceHealthUrl(toolName: string): string | null {
  const serviceMap: Record<string, string> = {
    'post_to_slack': 'https://slack.com/api/api.test',
    'send_teams_dm': 'https://graph.microsoft.com/v1.0/$metadata',
    'create_github_pr': 'https://api.github.com',
    'mcp_MailTools': (process.env.AGENT365_MCP_URL ?? 'http://127.0.0.1:4000') + '/health',
  };

  for (const [pattern, url] of Object.entries(serviceMap)) {
    if (toolName.includes(pattern)) return url;
  }
  return null;
}

const TIER2_CONCURRENCY = 5;
const TIER2_DELAY_MS = 200;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runTier2(testRunId: string, tools: ToolClassification[]) {
  const tier2Tools = tools.filter(t =>
    t.testStrategy === 'live' || t.testStrategy === 'probe'
  );

  console.log(`Running Tier 2 connectivity tests for ${tier2Tools.length} tools...`);

  for (let i = 0; i < tier2Tools.length; i += TIER2_CONCURRENCY) {
    const batch = tier2Tools.slice(i, i + TIER2_CONCURRENCY);
    await Promise.all(batch.map(async t => {
      const result = await runConnectivityTest(t.toolName, t);
      const status = result.skipReason ? 'skip' : (result.ok ? 'pass' : 'fail');
      await dbQuery(`
        INSERT INTO tool_test_results (
          test_run_id, tool_name, risk_tier, test_strategy, status,
          response_ms, connectivity_ok, execution_ok, error_message, error_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        testRunId, 
        t.toolName,
        t.riskTier,
        t.testStrategy,
        status,
        result.responseMs,
        result.connectivityOk,
        result.executionOk,
        result.skipReason || result.error || null,
        result.errorType || null,
      ]);
    }));
    if (i + TIER2_CONCURRENCY < tier2Tools.length) {
      await sleep(TIER2_DELAY_MS);
    }
  }
}
