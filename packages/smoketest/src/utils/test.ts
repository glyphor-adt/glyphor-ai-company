/**
 * Shared test runner utility.
 * Auto-detects DB auth failures and returns 'skipped' instead of 'fail'.
 */

import type { TestResult } from '../types.js';

const DB_SKIP_PATTERNS = [
  'SASL',
  'client password must be a string',
  'Connection terminated',
  'connect ECONNREFUSED',
];

export async function runTest(
  id: string,
  name: string,
  fn: () => Promise<string>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    const message = await fn();
    return { id, name, status: 'pass', message, durationMs: Date.now() - start };
  } catch (err) {
    const msg = (err as Error).message;
    if (DB_SKIP_PATTERNS.some(p => msg.includes(p))) {
      return {
        id,
        name,
        status: 'skipped',
        message: 'DB credentials not configured — add DATABASE_URL or DB_PASSWORD to .env',
        durationMs: Date.now() - start,
      };
    }
    return { id, name, status: 'fail', message: msg, durationMs: Date.now() - start };
  }
}
