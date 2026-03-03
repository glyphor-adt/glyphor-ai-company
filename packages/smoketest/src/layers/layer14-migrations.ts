/**
 * Layer 14 – Migration & Schema Integrity
 * Validates that all tables/columns defined in db/migrations/ exist in the live
 * database, and flags anything that looks like a missed migration.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { query } from '../utils/db.js';
import { runTest } from '../utils/test.js';

// ─── Parse migration SQL files ──────────────────────────────────────

interface MigrationSchema {
  tables: Set<string>;
  /** table → set of columns we can reliably extract */
  columns: Map<string, Set<string>>;
  /** migration filename → tables it touches */
  fileMap: Map<string, string[]>;
}

function parseMigrations(): MigrationSchema {
  const migrationsDir = resolve(
    process.cwd(),
    process.env.MIGRATIONS_DIR || 'db/migrations',
  );

  const tables = new Set<string>();
  const columns = new Map<string, Set<string>>();
  const fileMap = new Map<string, string[]>();

  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    return { tables, columns, fileMap };
  }

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const touchedTables: string[] = [];

    // CREATE TABLE [IF NOT EXISTS] <name>
    const createRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(sql)) !== null) {
      const tbl = m[1].toLowerCase();
      tables.add(tbl);
      touchedTables.push(tbl);

      // Extract column names from the CREATE block
      const rest = sql.slice(m.index + m[0].length);
      const parenDepth = extractParenBlock(rest);
      if (parenDepth) {
        const cols = extractColumnNames(parenDepth);
        if (!columns.has(tbl)) columns.set(tbl, new Set());
        for (const c of cols) columns.get(tbl)!.add(c);
      }
    }

    // ALTER TABLE <name> ADD COLUMN [IF NOT EXISTS] <col>
    const alterRe =
      /ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)/gi;
    while ((m = alterRe.exec(sql)) !== null) {
      const tbl = m[1].toLowerCase();
      const col = m[2].toLowerCase();
      tables.add(tbl);
      if (!columns.has(tbl)) columns.set(tbl, new Set());
      columns.get(tbl)!.add(col);
      if (!touchedTables.includes(tbl)) touchedTables.push(tbl);
    }

    if (touchedTables.length > 0) {
      fileMap.set(file, touchedTables);
    }
  }

  return { tables, columns, fileMap };
}

/** Extract the first balanced parenthesised block from text. */
function extractParenBlock(text: string): string | null {
  let depth = 1;
  let i = 0;
  while (i < text.length && depth > 0) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    i++;
  }
  return depth === 0 ? text.slice(0, i - 1) : null;
}

/** Pull column-name–looking tokens from a CREATE TABLE body. */
function extractColumnNames(body: string): string[] {
  const cols: string[] = [];
  const SKIP = new Set([
    'primary', 'unique', 'check', 'constraint', 'foreign', 'exclude',
    'create', 'index', 'grant', 'alter', 'references', 'on', 'if',
  ]);
  for (const line of body.split('\n')) {
    const trimmed = line.trim().replace(/--.*$/, '');
    if (!trimmed) continue;
    const tok = trimmed.split(/\s+/)[0].replace(/[^a-z0-9_]/gi, '').toLowerCase();
    if (tok && !SKIP.has(tok) && /^[a-z]/.test(tok)) {
      cols.push(tok);
    }
  }
  return cols;
}

// ─── Live DB introspection ──────────────────────────────────────────

async function getLiveTables(): Promise<Set<string>> {
  const rows = await query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return new Set(rows.map((r) => r.tablename.toLowerCase()));
}

async function getLiveColumns(
  table: string,
): Promise<Set<string>> {
  const rows = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((r) => r.column_name.toLowerCase()));
}

// ─── Layer runner ───────────────────────────────────────────────────

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];
  const schema = parseMigrations();

  // T14.1 — Migration files parseable
  tests.push(
    await runTest('T14.1', 'Migration files parseable', async () => {
      if (schema.tables.size === 0) {
        throw new Error(
          'No tables found in db/migrations/ — check MIGRATIONS_DIR or file location',
        );
      }
      return `Parsed ${schema.fileMap.size} migration files defining ${schema.tables.size} tables`;
    }),
  );

  // T14.2 — All migration-defined tables exist in the live DB
  tests.push(
    await runTest('T14.2', 'All expected tables exist', async () => {
      const liveTables = await getLiveTables();
      const missing: string[] = [];
      for (const tbl of schema.tables) {
        if (!liveTables.has(tbl)) missing.push(tbl);
      }
      if (missing.length > 0) {
        throw new Error(
          `${missing.length} table(s) defined in migrations but missing from DB: ${missing.join(', ')}`,
        );
      }
      return `All ${schema.tables.size} expected tables present in database`;
    }),
  );

  // T14.3 — Key columns exist (spot-check ALTER TABLE ADD COLUMN migrations)
  tests.push(
    await runTest('T14.3', 'Migration columns applied', async () => {
      const missingCols: string[] = [];
      // Check a representative set — tables with the most column additions
      const tablesToCheck = Array.from(schema.columns.entries())
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 20);

      for (const [tbl, expectedCols] of tablesToCheck) {
        let liveCols: Set<string>;
        try {
          liveCols = await getLiveColumns(tbl);
        } catch {
          missingCols.push(`${tbl} (table not queryable)`);
          continue;
        }
        for (const col of expectedCols) {
          if (!liveCols.has(col)) {
            missingCols.push(`${tbl}.${col}`);
          }
        }
      }

      if (missingCols.length > 0) {
        throw new Error(
          `${missingCols.length} column(s) missing — migrations not applied: ${missingCols.slice(0, 15).join(', ')}${missingCols.length > 15 ? ` (+${missingCols.length - 15} more)` : ''}`,
        );
      }
      const totalCols = tablesToCheck.reduce((n, [, s]) => n + s.size, 0);
      return `Checked ${totalCols} columns across ${tablesToCheck.length} tables — all present`;
    }),
  );

  // T14.4 — No orphan tables (in DB but not in any migration)
  tests.push(
    await runTest('T14.4', 'No orphan tables', async () => {
      const liveTables = await getLiveTables();
      // Exclude Postgres/extension internals
      const SYSTEM_TABLES = new Set([
        'spatial_ref_sys', 'pg_stat_statements', 'schema_migrations',
        'geography_columns', 'geometry_columns', 'raster_columns',
        'raster_overviews',
      ]);
      const orphans: string[] = [];
      for (const tbl of liveTables) {
        if (!schema.tables.has(tbl) && !SYSTEM_TABLES.has(tbl)) {
          orphans.push(tbl);
        }
      }
      if (orphans.length > 0) {
        // This is a warning, not a hard failure — tables may be created by extensions
        return `⚠ ${orphans.length} table(s) in DB not tracked by migrations: ${orphans.join(', ')}`;
      }
      return `All ${liveTables.size} live tables accounted for in migrations`;
    }),
  );

  // T14.5 — Recent migrations applied (last 5 migration files should have their tables)
  tests.push(
    await runTest('T14.5', 'Recent migrations applied', async () => {
      const liveTables = await getLiveTables();
      const liveCols = new Map<string, Set<string>>();
      const files = Array.from(schema.fileMap.entries()).slice(-5);
      const issues: string[] = [];

      for (const [file, tables] of files) {
        for (const tbl of tables) {
          if (!liveTables.has(tbl)) {
            issues.push(`${file}: table '${tbl}' missing`);
            continue;
          }
          // Check columns for this table from this migration
          const expectedCols = schema.columns.get(tbl);
          if (expectedCols && expectedCols.size > 0) {
            if (!liveCols.has(tbl)) {
              liveCols.set(tbl, await getLiveColumns(tbl));
            }
            const live = liveCols.get(tbl)!;
            for (const col of expectedCols) {
              if (!live.has(col)) {
                issues.push(`${file}: ${tbl}.${col} missing`);
              }
            }
          }
        }
      }

      if (issues.length > 0) {
        throw new Error(
          `Recent migration(s) not fully applied:\n  ${issues.join('\n  ')}`,
        );
      }
      return `Last ${files.length} migrations verified — all tables and columns present`;
    }),
  );

  return { layer: 14, name: 'Migration & Schema Integrity', tests };
}
