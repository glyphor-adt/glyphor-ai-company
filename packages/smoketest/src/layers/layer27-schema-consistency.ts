/**
 * Layer 27 — Schema Consistency
 *
 * Statically cross-checks code-level SQL table references and dashboard API
 * aliases against migration-defined tables to catch missing tables and naming
 * mismatches before runtime.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { LayerResult, SmokeTestConfig, TestResult } from '../types.js';
import { runTest } from '../utils/test.js';

interface MigrationSchema {
  tables: Set<string>;
}

const SYSTEM_TABLES = new Set([
  'information_schema.columns',
  'pg_tables',
  'spatial_ref_sys',
  'schema_migrations',
  'geography_columns',
  'geometry_columns',
  'raster_columns',
  'raster_overviews',
]);

function findMonorepoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'turbo.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

const REPO_ROOT = findMonorepoRoot();

function parseMigrations(): MigrationSchema {
  const migrationsDir = resolve(REPO_ROOT, process.env.MIGRATIONS_DIR || 'db/migrations');
  const tables = new Set<string>();

  let files: string[] = [];
  try {
    files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  } catch {
    return { tables };
  }

  const createRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi;
  const alterRe = /ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)/gi;

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    let match: RegExpExecArray | null;
    while ((match = createRe.exec(sql)) !== null) {
      tables.add(match[1].toLowerCase());
    }
    while ((match = alterRe.exec(sql)) !== null) {
      tables.add(match[1].toLowerCase());
    }
  }

  return { tables };
}

function walkFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, files);
      continue;
    }
    const ext = extname(entry.name);
    if (ext === '.ts' || ext === '.tsx') files.push(full);
  }
  return files;
}

function extractCteNames(content: string): Set<string> {
  const names = new Set<string>();
  const cteRe = /(?:WITH|,)\s*([a-z_][a-z0-9_]*)\s+AS\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = cteRe.exec(content)) !== null) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

function extractSqlTableReferences(content: string): Set<string> {
  const refs = new Set<string>();
  const ctes = extractCteNames(content);
  const patterns = [
    /\bFROM\s+([a-z_][a-z0-9_.]*)/gi,
    /\bJOIN\s+([a-z_][a-z0-9_.]*)/gi,
    /\bUPDATE\s+([a-z_][a-z0-9_.]*)/gi,
    /\bINSERT\s+INTO\s+([a-z_][a-z0-9_.]*)/gi,
    /\bDELETE\s+FROM\s+([a-z_][a-z0-9_.]*)/gi,
    /\bALTER\s+TABLE\s+([a-z_][a-z0-9_.]*)/gi,
    /queryTable(?:<[^>]+>)?\(\s*'([a-z_][a-z0-9_]*)'/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const table = match[1].toLowerCase();
      if (ctes.has(table) || SYSTEM_TABLES.has(table)) continue;
      refs.add(table);
    }
  }

  return refs;
}

function extractDashboardApiTargets(content: string): Map<string, string> {
  const targets = new Map<string, string>();
  const mapRe = /'([^']+)':\s*'([a-z_][a-z0-9_]*)'/g;
  let match: RegExpExecArray | null;
  while ((match = mapRe.exec(content)) !== null) {
    targets.set(match[1], match[2].toLowerCase());
  }
  return targets;
}

function formatList(values: string[], max = 12): string {
  return values.slice(0, max).join(', ') + (values.length > max ? ` (+${values.length - max} more)` : '');
}

export async function run(_config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];
  const schema = parseMigrations();
  const packageFiles = walkFiles(resolve(REPO_ROOT, 'packages'));
  const combinedContent = packageFiles.map((file) => ({ file, content: readFileSync(file, 'utf8') }));
  const sqlRefs = new Set<string>();

  for (const file of combinedContent) {
    for (const table of extractSqlTableReferences(file.content)) {
      sqlRefs.add(table);
    }
  }

  tests.push(
    await runTest('T27.1', 'Migration Schema Loaded', async () => {
      if (schema.tables.size === 0) {
        throw new Error('No migration-defined tables found');
      }
      return `Loaded ${schema.tables.size} tables from db/migrations`;
    }),
  );

  tests.push(
    await runTest('T27.2', 'SQL Table References Match Migrations', async () => {
      const missing = Array.from(sqlRefs).filter((table) => !schema.tables.has(table)).sort();
      if (missing.length > 0) {
        throw new Error(`Code references table(s) not defined in migrations: ${formatList(missing)}`);
      }
      return `${sqlRefs.size} code-referenced table names resolve to migration-defined tables`;
    }),
  );

  tests.push(
    await runTest('T27.3', 'Dashboard API Alias Targets Match Schema', async () => {
      const dashboardApiPath = resolve(REPO_ROOT, 'packages/scheduler/src/dashboardApi.ts');
      const content = readFileSync(dashboardApiPath, 'utf8');
      const targets = extractDashboardApiTargets(content);
      const invalid = Array.from(targets.entries())
        .filter(([, table]) => !schema.tables.has(table))
        .map(([alias, table]) => `${alias}→${table}`);

      if (invalid.length > 0) {
        throw new Error(`Dashboard API aliases point to unknown tables: ${formatList(invalid)}`);
      }

      return `${targets.size} dashboard API aliases point to migration-defined tables`;
    }),
  );

  tests.push(
    await runTest('T27.4', 'Critical Architecture Tables Referenced Consistently', async () => {
      const critical = [
        'company_agents',
        'agent_runs',
        'agent_reflections',
        'dashboard_change_requests',
        'policy_versions',
        'slack_approvals',
        'customer_tenants',
        'slack_routing_rules',
      ];
      const missing = critical.filter((table) => !schema.tables.has(table) || !sqlRefs.has(table));
      if (missing.length > 0) {
        throw new Error(`Critical architecture tables missing from schema/code cross-check: ${missing.join(', ')}`);
      }
      return `Critical architecture tables verified: ${critical.join(', ')}`;
    }),
  );

  return { layer: 27, name: 'Schema Consistency', tests };
}
