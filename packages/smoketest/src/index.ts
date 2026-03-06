/**
 * Glyphor Smoke Test Runner — CLI entry point.
 *
 * Usage:
 *   node dist/index.js                  # run all layers
 *   node dist/index.js --layer 0        # run only layer 0
 *   node dist/index.js --layer 0,4,11   # run layers 0, 4, and 11
 *   node dist/index.js --interactive    # enable semi-manual tests
 *
 * Environment variables:
 *   SCHEDULER_URL       — Cloud Run scheduler base URL (required)
 *   DASHBOARD_URL       — Cloud Run dashboard base URL (required)
 *   VOICE_GATEWAY_URL   — Cloud Run voice gateway base URL (required)
 *   WORKER_URL          — Cloud Run worker base URL (optional, for T0.6)
 *   GCP_PROJECT         — GCP project ID (default: ai-glyphor-company)
 *   AZURE_TENANT_ID     — Azure tenant ID (for M365 tests, layer 13)
 *   AZURE_CLIENT_ID     — Azure app client ID (for M365 tests)
 *   AZURE_CLIENT_SECRET — Azure app client secret (for M365 tests)
 *   TEAMS_TEAM_ID       — Microsoft Teams team ID (for M365 tests)
 *   SENDGRID_API_KEY    — SendGrid API key (for M365 tests)
 *   GLYPHOR_MCP_ENABLED — Set to 'true' to enable MCP bridge tests (layer 18)
 *   AGENT365_ENABLED    — Set to 'true' to enable Agent 365 bridge tests (layer 18)
 *   AGENT365_CLIENT_ID  — Agent 365 app client ID (layer 18)
 *   AGENT365_CLIENT_SECRET — Agent 365 app client secret (layer 18)
 *   AGENT365_TENANT_ID  — Agent 365 tenant ID (layer 18)
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// Load .env BEFORE any other imports so @glyphor/shared/db Pool
// picks up DATABASE_URL / DB_HOST etc. at module init time.
const __dirname = dirname(fileURLToPath(import.meta.url));
for (let dir = __dirname; dir !== dirname(dir); dir = dirname(dir)) {
  const candidate = resolve(dir, '.env');
  if (existsSync(candidate)) { loadEnv({ path: candidate }); break; }
}

// Dynamic import so layer modules (and @glyphor/shared/db) load AFTER env is set
const { main } = await import('./main.js');
main().catch((err: Error) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
