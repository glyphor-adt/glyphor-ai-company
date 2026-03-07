/**
 * Shared types for the smoke test suite.
 */

export type TestStatus = 'pass' | 'fail' | 'skipped' | 'blocked';

export interface TestResult {
  id: string;
  name: string;
  status: TestStatus;
  message: string;
  durationMs: number;
}

export interface LayerResult {
  layer: number;
  name: string;
  tests: TestResult[];
}

export interface SmokeTestConfig {
  schedulerUrl: string;
  dashboardUrl: string;
  voiceGatewayUrl: string;
  workerUrl: string;
  graphragUrl: string;
  gcpProject: string;
  interactive: boolean;
  selectedLayers: number[] | null; // null = all
}

/** Each layer module exports this signature. */
export type LayerRunner = (config: SmokeTestConfig) => Promise<LayerResult>;
