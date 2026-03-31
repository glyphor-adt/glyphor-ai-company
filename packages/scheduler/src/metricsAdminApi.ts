import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  computeFleetMetrics,
  getAgentMetricsWindows,
  getBenchmarkReport,
  getExceptionLog,
  getReversalStats,
  listActionReversals,
  listAgentMetrics,
  type ExceptionLogFilters,
  type ReversalLogFilters,
} from '@glyphor/shared';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function parseWindow(value: string | null, fallback = 30): 7 | 30 | 90 {
  const parsed = Number(value ?? fallback);
  if (parsed === 7 || parsed === 30 || parsed === 90) return parsed;
  return fallback as 7 | 30 | 90;
}

function parsePositiveInteger(value: string | null, fallback: number, max = 200): number {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}

export async function handleMetricsAdminApi(
  _req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;
  if (!url.startsWith('/admin/metrics')) return false;

  const params = new URLSearchParams(queryString);

  try {
    if (url === '/admin/metrics/agents') {
      const windowDays = parseWindow(params.get('window'));
      const agents = await listAgentMetrics(windowDays);
      json(res, 200, { windowDays, agents });
      return true;
    }

    const agentMatch = url.match(/^\/admin\/metrics\/agents\/([^/]+)$/);
    if (agentMatch) {
      const agentId = decodeURIComponent(agentMatch[1]);
      const [metrics, reversal7, reversal30, reversal90] = await Promise.all([
        getAgentMetricsWindows(agentId),
        getReversalStats(agentId, 7),
        getReversalStats(agentId, 30),
        getReversalStats(agentId, 90),
      ]);
      json(res, 200, {
        ...metrics,
        reversalStats: {
          7: reversal7,
          30: reversal30,
          90: reversal90,
        },
      });
      return true;
    }

    if (url === '/admin/metrics/fleet') {
      const windowDays = parseWindow(params.get('window'));
      json(res, 200, await computeFleetMetrics(windowDays));
      return true;
    }

    if (url === '/admin/metrics/exceptions') {
      const filters: ExceptionLogFilters = {
        agentId: params.get('agentId') ?? undefined,
        startDate: params.get('startDate') ?? undefined,
        endDate: params.get('endDate') ?? undefined,
        resolutionStatus: (params.get('resolutionStatus') as ExceptionLogFilters['resolutionStatus']) ?? 'all',
        page: parsePositiveInteger(params.get('page'), 1, 100000),
        pageSize: parsePositiveInteger(params.get('pageSize'), 50, 200),
      };
      json(res, 200, await getExceptionLog(filters));
      return true;
    }

    if (url === '/admin/metrics/reversals') {
      const filters: ReversalLogFilters = {
        agentId: params.get('agentId') ?? undefined,
        windowDays: params.get('window') ? Number(params.get('window')) : undefined,
        page: parsePositiveInteger(params.get('page'), 1, 100000),
        pageSize: parsePositiveInteger(params.get('pageSize'), 50, 200),
      };
      json(res, 200, await listActionReversals(filters));
      return true;
    }

    if (url === '/admin/metrics/benchmark-report') {
      json(res, 200, await getBenchmarkReport(parseWindow(params.get('window'), 90)));
      return true;
    }

    return false;
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}