/**
 * Main smoketest logic — loaded dynamically after dotenv injects env vars.
 */

import type { SmokeTestConfig, LayerRunner } from './types.js';
import { printLayerResults, printSummaryTable } from './utils/report.js';

import { run as layer00 } from './layers/layer00-infra.js';
import { run as layer01 } from './layers/layer01-data-syncs.js';
import { run as layer02 } from './layers/layer02-model-clients.js';
import { run as layer03 } from './layers/layer03-heartbeat.js';
import { run as layer04 } from './layers/layer04-orchestration.js';
import { run as layer05 } from './layers/layer05-communication.js';
import { run as layer06 } from './layers/layer06-authority.js';
import { run as layer07 } from './layers/layer07-intelligence.js';
import { run as layer08 } from './layers/layer08-knowledge.js';
import { run as layer09 } from './layers/layer09-strategy.js';
import { run as layer10 } from './layers/layer10-specialists.js';
import { run as layer11 } from './layers/layer11-dashboard.js';
import { run as layer12 } from './layers/layer12-voice.js';
import { run as layer13 } from './layers/layer13-m365.js';
import { run as layer14 } from './layers/layer14-migrations.js';
import { run as layer15 } from './layers/layer15-agent-autonomy.js';

const ALL_LAYERS: LayerRunner[] = [
  layer00, layer01, layer02, layer03, layer04, layer05,
  layer06, layer07, layer08, layer09, layer10, layer11, layer12, layer13,
  layer14, layer15,
];

function loadConfig(): SmokeTestConfig {
  const args = process.argv.slice(2);

  let selectedLayers: number[] | null = null;
  const layerIdx = args.indexOf('--layer');
  if (layerIdx !== -1 && args[layerIdx + 1]) {
    selectedLayers = args[layerIdx + 1].split(',').map(Number);
    for (const n of selectedLayers) {
      if (isNaN(n) || n < 0 || n > 15) {
        console.error(`Invalid layer number: ${n}. Must be 0-15.`);
        process.exit(1);
      }
    }
  }

  const interactive = args.includes('--interactive');

  const required = (name: string): string => {
    const val = process.env[name];
    if (!val) {
      console.error(`Missing required environment variable: ${name}`);
      process.exit(1);
    }
    return val;
  };

  return {
    schedulerUrl: required('SCHEDULER_URL').replace(/\/$/, ''),
    dashboardUrl: required('DASHBOARD_URL').replace(/\/$/, ''),
    voiceGatewayUrl: required('VOICE_GATEWAY_URL').replace(/\/$/, ''),
    gcpProject: process.env.GCP_PROJECT ?? 'ai-glyphor-company',
    interactive,
    selectedLayers,
  };
}

export async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║         Glyphor Architecture Smoke Test Suite       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  const config = loadConfig();

  const layersToRun = config.selectedLayers ?? ALL_LAYERS.map((_, i) => i);
  console.log(`Running layers: ${layersToRun.join(', ')}`);
  console.log(`Interactive mode: ${config.interactive ? 'ON' : 'OFF'}`);
  console.log(`Scheduler: ${config.schedulerUrl}`);
  console.log('');

  const results = [];
  for (const layerNum of layersToRun) {
    const runner = ALL_LAYERS[layerNum];
    if (!runner) {
      console.error(`Layer ${layerNum} not found. Skipping.`);
      continue;
    }
    console.log(`\n▶ Starting Layer ${layerNum}...`);
    const result = await runner(config);
    results.push(result);
  }

  printLayerResults(results);
  printSummaryTable(results);

  const hasFail = results.some(r => r.tests.some(t => t.status === 'fail'));
  process.exit(hasFail ? 1 : 0);
}
