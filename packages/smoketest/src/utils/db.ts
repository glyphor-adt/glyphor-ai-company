/**
 * Database query helpers using @glyphor/shared direct pg connection.
 */

import { systemQuery } from '@glyphor/shared/db';

/**
 * Run a raw SQL query via the shared pg pool.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return systemQuery<T>(sql, params);
}

/**
 * Query a table with optional filters, ordering, and limits.
 */
export async function queryTable<T = Record<string, unknown>>(
  table: string,
  select: string = '*',
  filters?: Record<string, unknown>,
  options?: { order?: string; limit?: number; desc?: boolean },
): Promise<T[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      clauses.push(`${key} = $${paramIdx++}`);
      values.push(value);
    }
  }

  let sql = `SELECT ${select} FROM ${table}`;
  if (clauses.length > 0) {
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }
  if (options?.order) {
    sql += ` ORDER BY ${options.order}${options.desc ? ' DESC' : ' ASC'}`;
  }
  if (options?.limit) {
    sql += ` LIMIT ${options.limit}`;
  }

  return systemQuery<T>(sql, values);
}

/**
 * Count rows in a table with optional filters.
 */
export async function countRows(
  table: string,
  filters?: Record<string, unknown>,
): Promise<number> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      clauses.push(`${key} = $${paramIdx++}`);
      values.push(value);
    }
  }

  let sql = `SELECT COUNT(*)::int AS count FROM ${table}`;
  if (clauses.length > 0) {
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }

  const rows = await systemQuery<{ count: number }>(sql, values);
  return rows[0]?.count ?? 0;
}
