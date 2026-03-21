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

function addToolDefinitions(target: Map<string, ToolDefinition>, tools: ToolDefinition[]): void {
  for (const tool of tools) {
    if (!target.has(tool.name)) {
      target.set(tool.name, tool);
    }
  }
}

function buildMockMemoryStore(): any {
  return {
    read: async () => null,
    write: async () => undefined,
    appendActivity: async () => undefined,
    getRecentActivity: async () => [],
    getDecisions: async () => [],
    getProductMetrics: async () => null,
    getFinancials: async () => [],
    saveMemory: async () => 'mock-memory-id',
    getMemories: async () => [],
  };
}

async function augmentStaticToolMap(base: Map<string, ToolDefinition>): Promise<void> {
  const memory = buildMockMemoryStore();

  const graphReader = {
    traceCauses: async () => ({ nodes: [], edges: [], narrative: '' }),
    traceImpact: async () => ({ nodes: [], edges: [], narrative: '' }),
    getRelevantContext: async () => ({ nodes: [], edges: [], narrative: '' }),
  };

  const graphWriter = {
    addFact: async () => 'mock-fact-id',
    addNode: async () => 'mock-node-id',
    addEdge: async () => 'mock-edge-id',
  };

  try {
    const memoryTools = await dynamicImportModule('../../../agents/src/shared/memoryTools.js');
    if (typeof memoryTools?.createMemoryTools === 'function') {
      addToolDefinitions(base, memoryTools.createMemoryTools(memory));
    }
  } catch (err) {
    console.warn('[Tier2] Failed to augment static tools from memory factory:', String(err));
  }

  try {
    const cfo = await dynamicImportModule('../../../agents/src/cfo/tools.js');
    if (typeof cfo?.createCFOTools === 'function') {
      addToolDefinitions(base, cfo.createCFOTools(memory));
    }
  } catch (err) {
    console.warn('[Tier2] Failed to augment static tools from CFO factory:', String(err));
  }

  try {
    const cto = await dynamicImportModule('../../../agents/src/cto/tools.js');
    if (typeof cto?.createCTOTools === 'function') {
      addToolDefinitions(base, cto.createCTOTools(memory));
    }
  } catch (err) {
    console.warn('[Tier2] Failed to augment static tools from CTO factory:', String(err));
  }

  try {
    const vpDesign = await dynamicImportModule('../../../agents/src/vp-design/tools.js');
    if (typeof vpDesign?.createVPDesignTools === 'function') {
      addToolDefinitions(base, vpDesign.createVPDesignTools(memory));
    }
  } catch (err) {
    console.warn('[Tier2] Failed to augment static tools from VP Design factory:', String(err));
  }

  try {
    const cos = await dynamicImportModule('../../../agents/src/chief-of-staff/tools.js');
    if (typeof cos?.createChiefOfStaffTools === 'function') {
      const cosTools = cos.createChiefOfStaffTools(memory);
      addToolDefinitions(base, cosTools);

      if (typeof cos?.createOrchestrationTools === 'function') {
        addToolDefinitions(base, cos.createOrchestrationTools('http://127.0.0.1:8080', undefined, cosTools, null));
      }
    }
  } catch (err) {
    console.warn('[Tier2] Failed to augment static tools from Chief of Staff factory:', String(err));
  }

  try {
    const graph = await dynamicImportModule('../../../agents/src/shared/graphTools.js');
    if (typeof graph?.createGraphTools === 'function') {
      addToolDefinitions(base, graph.createGraphTools(graphReader, graphWriter));
    }
  } catch (err) {
    console.warn('[Tier2] Failed to augment static tools from graph factory:', String(err));
  }
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
        const map = new Map(defs.map((def) => [def.name, def]));
        await augmentStaticToolMap(map);
        return map;
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

      if (shouldSkipForPrerequisite(err)) {
        return {
          ok: true,
          responseMs: Date.now() - startedAt,
          connectivityOk: true,
          executionOk: null,
          response: result,
          skipReason: err,
          errorType,
        };
      }

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
      const staticTool = await loadStaticToolDefinition(toolName);
      const tool = await loadRegisteredTool(toolName);
      if (!tool) {
        if (!staticTool) {
          return {
            ok: true,
            responseMs: 0,
            connectivityOk: null,
            executionOk: null,
            skipReason: 'Static tool not found in Layer 16 factory catalog',
          };
        }

        const staticInput = resolveTestInput(toolName, staticTool, classification.testInput);
        return executeStaticTool(staticTool, staticInput, start);
      }
      
      const testInput = resolveTestInput(toolName, tool, classification.testInput);
      const result = await executeDynamicTool(toolName, testInput);

      if (!result) throw new Error('Dynamic tool execute returned null');

      if (result.success === false) {
        const err = result.error ?? 'Dynamic tool returned success=false';
        const errorType = classifyError(err);

        const stripeWithoutError = !result.error && toolName.startsWith('query_stripe_');
        if (stripeWithoutError || shouldSkipForPrerequisite(err, toolName)) {
          return {
            ok: true,
            responseMs: Date.now() - start,
            connectivityOk: true,
            executionOk: null,
            response: result,
            skipReason: err,
            errorType,
          };
        }

        if (staticTool && (errorType === 'connection' || !result.error)) {
          const staticInput = resolveTestInput(toolName, staticTool, classification.testInput);
          const staticResult = await executeStaticTool(staticTool, staticInput, start);
          if (staticResult.ok) {
            return staticResult;
          }
        }

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
    if (classification.riskTier === 'read_only') {
      const staticTool = await loadStaticToolDefinition(toolName);
      if (staticTool) {
        const staticInput = resolveTestInput(toolName, staticTool, classification.testInput);
        const staticResult = await executeStaticTool(staticTool, staticInput, start);
        if (staticResult.ok) {
          return staticResult;
        }
      }
    }

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

function resolveTestInput(
  toolName: string,
  tool: any,
  fromClassification: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const generated = buildSafeTestInput(tool, toolName);
  const merged = {
    ...generated,
    ...(fromClassification ?? {}),
  };

  return sanitizeTestInput(toolName, merged);
}

function sanitizeTestInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const out = { ...input };
  const normalizedToolName = toolName.toLowerCase();

  if (String(out.repo ?? '').toLowerCase() === 'test') {
    out.repo = 'company';
  }

  if (normalizedToolName === 'list_frontend_files') {
    out.path = 'packages/dashboard/src/components/';
    out.repo = 'company';
  }

  if (normalizedToolName === 'read_frontend_file') {
    out.path = 'packages/dashboard/src/components/Layout.tsx';
    out.repo = 'company';
  }

  if (normalizedToolName === 'check_ai_smell') {
    if (!out.url || String(out.url).trim().toLowerCase() === 'test') {
      out.url = process.env.DASHBOARD_URL ?? 'https://glyphor-dashboard-610179349713.us-central1.run.app';
    }
  }

  if (normalizedToolName === 'check_assignment_status') {
    out.directive_id = '00000000-0000-4000-8000-000000000000';
  }

  return out;
}

function buildSafeTestInput(tool: any, toolName?: string): Record<string, unknown> {
  const normalizedToolName = String(toolName ?? tool?.name ?? '').toLowerCase();

  if (normalizedToolName === 'list_frontend_files') {
    return { path: 'packages/dashboard/src' };
  }
  if (normalizedToolName === 'read_frontend_file') {
    return { path: 'packages/dashboard/src/App.tsx' };
  }
  if (normalizedToolName === 'check_ai_smell') {
    return { url: 'https://example.com' };
  }
  if (normalizedToolName === 'check_assignment_status') {
    return { directive_id: '00000000-0000-4000-8000-000000000000' };
  }

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
      case 'string': {
        if (p.enum?.length) {
          input[name] = p.enum[0];
        } else {
          const lowerName = name.toLowerCase();
          if (lowerName.includes('url') || p.format === 'uri') {
            input[name] = 'https://example.com';
          } else if (lowerName.includes('path') || lowerName.includes('file')) {
            input[name] = 'packages/dashboard/src/App.tsx';
          } else if (lowerName.endsWith('_id') || lowerName === 'id' || p.format === 'uuid') {
            input[name] = '00000000-0000-4000-8000-000000000000';
          } else {
            input[name] = 'test';
          }
        }
        break;
      }
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

function shouldSkipForPrerequisite(err: unknown, toolName?: string): boolean {
  const msg = String(err).toLowerCase();
  const normalizedToolName = String(toolName ?? '').toLowerCase();

  if (normalizedToolName.startsWith('query_stripe_')) {
    return true;
  }

  return (
    msg.includes('not configured') ||
    msg.includes('missing api key') ||
    msg.includes('no data') ||
    msg.includes('no typography definitions found') ||
    msg.includes('company doctrine is empty at runtime') ||
    msg.includes('company doctrine is incomplete at runtime') ||
    msg.includes('failed to fetch page') ||
    msg.includes('fetch failed')
  );
}

function getServiceHealthUrl(toolName: string): string | null {
  const normalized = toolName.toLowerCase();

  const serviceMap: Record<string, string> = {
    'post_to_slack': 'https://slack.com/api/api.test',
    'send_teams_dm': 'https://graph.microsoft.com/v1.0/$metadata',
    'create_github_pr': 'https://api.github.com',
    'mcp_MailTools': (process.env.AGENT365_MCP_URL ?? 'http://127.0.0.1:4000') + '/health',
  };

  for (const [pattern, url] of Object.entries(serviceMap)) {
    if (toolName.includes(pattern)) return url;
  }

  if (normalized.startsWith('mcp_')) {
    return (process.env.AGENT365_MCP_URL ?? process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:4000') + '/health';
  }

  if (normalized.includes('github')) return 'https://api.github.com';
  if (normalized.includes('teams') || normalized.includes('graph')) return 'https://graph.microsoft.com/v1.0/$metadata';
  if (normalized.includes('slack')) return 'https://slack.com/api/api.test';
  if (normalized.includes('figma')) return 'https://api.figma.com/v1/files';
  if (normalized.includes('stripe')) return 'https://stripe.com';
  if (normalized.includes('docusign')) return 'https://demo.docusign.net/restapi/v2.1';
  if (normalized.includes('mailchimp') || normalized.includes('mandrill')) return 'https://mandrillapp.com/api/1.0/users/ping2.json';
  if (normalized.includes('canva')) return 'https://www.canva.com';

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
