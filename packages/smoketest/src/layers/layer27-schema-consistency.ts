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
  'information_schema.tables',
  'pg_tables',
  'spatial_ref_sys',
  'schema_migrations',
  'geography_columns',
  'geometry_columns',
  'raster_columns',
  'raster_overviews',
]);

const IGNORED_SQL_IDENTIFIERS = new Set([
  'lateral',
  'set',
  'where',
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

function normalizeIdentifier(value: string): string {
  const normalized = value.replace(/["'`]/g, '').trim().toLowerCase();
  if (SYSTEM_TABLES.has(normalized) || normalized.startsWith('information_schema.')) return normalized;
  const parts = normalized.split('.');
  return parts[parts.length - 1] ?? normalized;
}

function parseMigrations(): MigrationSchema {
  const migrationsDir = resolve(REPO_ROOT, process.env.MIGRATIONS_DIR || 'db/migrations');
  const tables = new Set<string>();

  let files: string[] = [];
  try {
    files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  } catch {
    return { tables };
  }

  const createTableRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?("?[\w.]+"?)/gi;
  const createViewRe = /CREATE(?: MATERIALIZED)? VIEW\s+(?:IF NOT EXISTS\s+)?("?[\w.]+"?)/gi;
  const alterRe = /ALTER TABLE\s+(?:IF EXISTS\s+)?("?[\w.]+"?)/gi;

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    let match: RegExpExecArray | null;
    while ((match = createTableRe.exec(sql)) !== null) {
      tables.add(normalizeIdentifier(match[1]));
     }
    while ((match = createViewRe.exec(sql)) !== null) {
      tables.add(normalizeIdentifier(match[1]));
    }
    while ((match = alterRe.exec(sql)) !== null) {
      tables.add(normalizeIdentifier(match[1]));
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

function extractSqlLiterals(content: string): string[] {
  const literals = content.match(/`[\s\S]*?`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g) ?? [];
  return literals
    .map((literal) => {
      const quote = literal[0];
      const inner = literal.slice(1, -1);
      return quote === '`' ? inner.replace(/\$\{[\s\S]*?\}/g, '__expr__') : inner;
    })
    .filter((literal) =>
      /^\s*(?:SELECT\b[\s\S]*\bFROM\b|INSERT\s+INTO\b|UPDATE\b[\s\S]*\bSET\b|DELETE\s+FROM\b|ALTER\s+TABLE\b|WITH\b[\s\S]*\bAS\s*\()/i.test(literal),
    );
}

function stripSqlComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function extractSqlTableReferences(content: string): Set<string> {
  const refs = new Set<string>();
  const sqlLiterals = extractSqlLiterals(content).map(stripSqlComments);
  const ctes = new Set<string>(sqlLiterals.flatMap((literal) => Array.from(extractCteNames(literal))));
  const patterns = [
    /\bFROM\s+("?[\w.]+"?)/gi,
    /\bJOIN\s+("?[\w.]+"?)/gi,
    /(?:^|;)\s*UPDATE\s+("?[\w.]+"?)/gi,
    /(?:^|;)\s*INSERT\s+INTO\s+("?[\w.]+"?)/gi,
    /(?:^|;)\s*DELETE\s+FROM\s+("?[\w.]+"?)/gi,
    /(?:^|;)\s*ALTER\s+TABLE\s+("?[\w.]+"?)/gi,
    /queryTable(?:<[^>]+>)?\(\s*'([a-z_][a-z0-9_]*)'/gi,
  ];

  for (const sql of sqlLiterals) {
    for (const pattern of patterns.slice(0, 6)) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sql)) !== null) {
        const trailing = sql.slice(pattern.lastIndex);
        const table = normalizeIdentifier(match[1]);
        if (/^\s*[\(\)]/.test(trailing)) continue;
        if (table.includes('__expr__') || table.length <= 1 || IGNORED_SQL_IDENTIFIERS.has(table)) continue;
        if (ctes.has(table) || SYSTEM_TABLES.has(table)) continue;
        refs.add(table);
      }
    }
  }

  const queryTablePattern = patterns[6];
  let match: RegExpExecArray | null;
  while ((match = queryTablePattern.exec(content)) !== null) {
    const table = normalizeIdentifier(match[1]);
    if (!SYSTEM_TABLES.has(table)) {
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
    targets.set(match[1], normalizeIdentifier(match[2]));
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
