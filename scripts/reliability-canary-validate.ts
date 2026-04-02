import fs from 'node:fs';
import path from 'node:path';
import { pool } from '@glyphor/shared/db';

interface ValidationRow {
  check_name?: string;
  status?: string;
  [key: string]: unknown;
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => `${part};`);
}

function toCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function printRows(title: string, rows: ValidationRow[]): void {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  console.log(keys.join('\t'));
  for (const row of rows) {
    console.log(keys.map((key) => toCell(row[key])).join('\t'));
  }
}

async function runValidation(sqlPathArg?: string): Promise<number> {
  const sqlPath = sqlPathArg
    ? path.resolve(sqlPathArg)
    : path.resolve('scripts/sql/reliability_canary_validation.sql');

  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Validation SQL file not found: ${sqlPath}`);
  }

  const rawSql = fs.readFileSync(sqlPath, 'utf8');
  const statements = splitSqlStatements(rawSql);
  const client = await pool.connect();
  let failures = 0;

  try {
    for (let i = 0; i < statements.length; i += 1) {
      const statement = statements[i]!;
      const result = await client.query(statement);
      if (!result.rows || result.rows.length === 0) continue;

      const rows = result.rows as ValidationRow[];
      const hasStatus = rows.some((row) => typeof row.status === 'string');
      if (hasStatus) {
        printRows(`Check ${i + 1}`, rows);
        for (const row of rows) {
          if (String(row.status).toUpperCase() === 'FAIL') failures += 1;
        }
      } else {
        printRows(`Diagnostic ${i + 1}`, rows);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\nValidation Summary');
  if (failures > 0) {
    console.log(`FAIL (${failures} failing checks)`);
    return 1;
  }
  console.log('PASS (no failing checks)');
  return 0;
}

runValidation(process.argv[2])
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[reliability-canary-validate] ${message}`);
    process.exitCode = 1;
  });
