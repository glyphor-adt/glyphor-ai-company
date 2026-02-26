/**
 * GCP Cloud Monitoring — Query Cloud Run metrics
 */

import { MetricServiceClient } from '@google-cloud/monitoring';

let client: MetricServiceClient | null = null;

function getClient(): MetricServiceClient {
  if (!client) client = new MetricServiceClient();
  return client;
}

export interface CloudRunMetrics {
  service: string;
  requestCount: number;
  avgLatencyMs: number;
  errorRate: number;
  clientErrorRate: number;
  instanceCount: number | null;
  instanceStatus: 'running' | 'scaled-to-zero' | 'scaling-down';
  period: string;
}

/** Query Cloud Run metrics for a specific service over a time window */
export async function queryCloudRunMetrics(
  projectId: string,
  serviceId: string,
  hours = 1,
): Promise<CloudRunMetrics> {
  const monitoringClient = getClient();
  const now = Math.floor(Date.now() / 1000);
  const start = now - hours * 3600;

  const interval = {
    startTime: { seconds: start },
    endTime: { seconds: now },
  };

  const serviceName = `projects/${projectId}`;
  const serviceFilter = `resource.type = "cloud_run_revision" AND resource.labels.service_name = "${serviceId}"`;

  const [requestCount, latency, serverErrorCount, clientErrorCount, instances] = await Promise.all([
    queryMetric(monitoringClient, serviceName, `${serviceFilter} AND metric.type = "run.googleapis.com/request_count"`, interval),
    queryMetric(monitoringClient, serviceName, `${serviceFilter} AND metric.type = "run.googleapis.com/request_latencies"`, interval),
    queryMetric(monitoringClient, serviceName, `${serviceFilter} AND metric.type = "run.googleapis.com/request_count" AND metric.labels.response_code_class = "5xx"`, interval),
    queryMetric(monitoringClient, serviceName, `${serviceFilter} AND metric.type = "run.googleapis.com/request_count" AND metric.labels.response_code_class = "4xx"`, interval),
    queryMetric(monitoringClient, serviceName, `${serviceFilter} AND metric.type = "run.googleapis.com/container/instance_count"`, interval),
  ]);

  const totalRequests = sumPoints(requestCount);
  const totalServerErrors = sumPoints(serverErrorCount);
  const totalClientErrors = sumPoints(clientErrorCount);
  const rawInstanceCount = lastPoint(instances);

  return {
    service: serviceId,
    requestCount: totalRequests,
    avgLatencyMs: avgPoints(latency),
    errorRate: totalRequests > 0 ? (totalServerErrors / totalRequests) * 100 : 0,
    clientErrorRate: totalRequests > 0 ? (totalClientErrors / totalRequests) * 100 : 0,
    instanceCount: rawInstanceCount,
    instanceStatus: rawInstanceCount === null
      ? 'scaled-to-zero'
      : rawInstanceCount === 0
        ? 'scaling-down'
        : 'running',
    period: `${hours}h`,
  };
}

/** Query all Cloud Run services for a project */
export async function queryAllServices(
  projectId: string,
  serviceIds: string[],
  hours = 1,
): Promise<CloudRunMetrics[]> {
  return Promise.all(serviceIds.map((id) => queryCloudRunMetrics(projectId, id, hours)));
}

async function queryMetric(
  client: MetricServiceClient,
  name: string,
  filter: string,
  interval: { startTime: { seconds: number }; endTime: { seconds: number } },
) {
  try {
    const [timeSeries] = await client.listTimeSeries({
      name,
      filter,
      interval,
      view: 'FULL',
    });
    return timeSeries ?? [];
  } catch (err) {
    console.warn(`[GCP Monitoring] Query failed for filter "${filter}":`, (err as Error).message);
    return [];
  }
}

function sumPoints(timeSeries: unknown[]): number {
  let total = 0;
  for (const ts of timeSeries) {
    const series = ts as { points?: Array<{ value?: { int64Value?: string; doubleValue?: number } }> };
    for (const point of series.points ?? []) {
      total += Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0);
    }
  }
  return total;
}

function avgPoints(timeSeries: unknown[]): number {
  let total = 0;
  let count = 0;
  for (const ts of timeSeries) {
    const series = ts as { points?: Array<{ value?: { distributionValue?: { mean?: number }; doubleValue?: number } }> };
    for (const point of series.points ?? []) {
      const val = point.value?.distributionValue?.mean ?? point.value?.doubleValue ?? 0;
      total += val;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

function lastPoint(timeSeries: unknown[]): number | null {
  for (const ts of timeSeries) {
    const series = ts as { points?: Array<{ value?: { int64Value?: string; doubleValue?: number } }> };
    if (series.points && series.points.length > 0) {
      const point = series.points[0];
      return Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0);
    }
  }
  return null; // no monitoring data available — distinct from actual 0 instances
}
