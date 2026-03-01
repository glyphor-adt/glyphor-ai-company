/**
 * Supabase client factory and query helper.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SmokeTestConfig } from '../types.js';

let client: SupabaseClient | null = null;

export function getSupabase(config: SmokeTestConfig): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseKey);
  }
  return client;
}

/**
 * Run a raw SQL query via Supabase's rpc or from().
 * Uses the `rpc` endpoint with a helper function, or falls back to `.from()`.
 */
export async function query<T = Record<string, unknown>>(
  config: SmokeTestConfig,
  sql: string,
): Promise<T[]> {
  const sb = getSupabase(config);
  // Use Supabase's raw SQL via the `exec_sql` rpc if available
  const { data, error } = await sb.rpc('exec_sql', { query: sql });
  if (error) {
    throw new Error(`Supabase query failed: ${error.message}\nSQL: ${sql}`);
  }
  return (data ?? []) as T[];
}

/**
 * Query a Supabase table directly using the PostgREST API.
 */
export async function queryTable<T = Record<string, unknown>>(
  config: SmokeTestConfig,
  table: string,
  select: string = '*',
  filters?: Record<string, unknown>,
  options?: { order?: string; limit?: number; desc?: boolean },
): Promise<T[]> {
  const sb = getSupabase(config);
  let q = sb.from(table).select(select);

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      q = q.eq(key, value);
    }
  }

  if (options?.order) {
    q = q.order(options.order, { ascending: !(options.desc ?? false) });
  }
  if (options?.limit) {
    q = q.limit(options.limit);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`Supabase query on ${table} failed: ${error.message}`);
  }
  return (data ?? []) as T[];
}

/**
 * Count rows in a table with optional filters.
 */
export async function countRows(
  config: SmokeTestConfig,
  table: string,
  filters?: Record<string, unknown>,
): Promise<number> {
  const sb = getSupabase(config);
  let q = sb.from(table).select('*', { count: 'exact', head: true });

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      q = q.eq(key, value);
    }
  }

  const { count, error } = await q;
  if (error) {
    throw new Error(`Supabase count on ${table} failed: ${error.message}`);
  }
  return count ?? 0;
}
