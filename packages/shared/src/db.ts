import { Pool, PoolClient, types, type PoolConfig } from 'pg';

// PostgreSQL NUMERIC (OID 1700) returns strings by default.
// Parse as floats so dashboard code can call .toFixed() etc.
types.setTypeParser(1700, (val: string) => parseFloat(val));

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Pool defaults tuned for Cloud Run (scheduler/worker share this package).
 * Cloud SQL `max_connections` is 200 (see infra/terraform/main.tf). Each Cloud Run
 * instance is one process = one pool; Tier2 tool health runs batches of 5 concurrent
 * tools, each may hold 1+ DB clients briefly — a low max causes
 * "timeout exceeded when trying to connect" under burst load.
 *
 * Override: PG_POOL_MAX (1–100), PG_POOL_CONNECTION_TIMEOUT_MS, PG_POOL_IDLE_TIMEOUT_MS
 */
function basePoolConfig(): Pick<PoolConfig, 'max' | 'idleTimeoutMillis' | 'connectionTimeoutMillis'> {
  const maxRaw = process.env.PG_POOL_MAX?.trim();
  let max = 32;
  if (maxRaw) {
    const n = parseInt(maxRaw, 10);
    if (Number.isFinite(n)) {
      max = Math.min(100, Math.max(1, n));
    }
  }

  const connTimeoutRaw = process.env.PG_POOL_CONNECTION_TIMEOUT_MS?.trim();
  let connectionTimeoutMillis = 10_000;
  if (connTimeoutRaw) {
    const n = parseInt(connTimeoutRaw, 10);
    if (Number.isFinite(n) && n >= 1000 && n <= 120_000) {
      connectionTimeoutMillis = n;
    }
  }

  const idleRaw = process.env.PG_POOL_IDLE_TIMEOUT_MS?.trim();
  let idleTimeoutMillis = 30_000;
  if (idleRaw) {
    const n = parseInt(idleRaw, 10);
    if (Number.isFinite(n) && n >= 1000 && n <= 600_000) {
      idleTimeoutMillis = n;
    }
  }

  return {
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  };
}

function readUrlPassword(connectionString: string): string | undefined {
  try {
    const parsed = new URL(connectionString);
    return parsed.password ? decodeURIComponent(parsed.password) : undefined;
  } catch {
    return undefined;
  }
}

function readUrlUser(connectionString: string): string | undefined {
  try {
    const parsed = new URL(connectionString);
    return parsed.username ? decodeURIComponent(parsed.username) : undefined;
  } catch {
    return undefined;
  }
}

function resolvedDbUser(): string | undefined {
  const authSource = resolveAuthSource();
  if (authSource === 'database_url') {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (connectionString) return readUrlUser(connectionString);
  }

  return firstDefined(
    process.env.DB_USER,
    process.env.PGUSER,
    process.env.DATABASE_URL ? readUrlUser(process.env.DATABASE_URL) : undefined
  );
}

type DbAuthSource = 'database_url' | 'env';

function resolveAuthSource(): DbAuthSource {
  const explicit = process.env.DB_AUTH_SOURCE?.trim().toLowerCase();
  if (explicit === 'database_url' || explicit === 'url') return 'database_url';
  if (explicit === 'env' || explicit === 'host') return 'env';

  // Default to DATABASE_URL when present to keep one canonical source.
  return process.env.DATABASE_URL?.trim() ? 'database_url' : 'env';
}

function buildPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL?.trim();
  const fallbackPassword = firstDefined(process.env.DB_PASSWORD, process.env.PGPASSWORD);
  const authSource = resolveAuthSource();

  if (authSource === 'database_url') {
    if (!connectionString) {
      throw new Error('DB auth configuration invalid: DB_AUTH_SOURCE resolves to DATABASE_URL, but DATABASE_URL is not set.');
    }

    const passwordFromUrl = readUrlPassword(connectionString);

    return {
      connectionString,
      // Keep DATABASE_URL as the single source of truth when selected.
      password: passwordFromUrl ?? '',
      ...basePoolConfig(),
    };
  }

  const portStr = firstDefined(process.env.DB_PORT, process.env.PGPORT);
  return {
    host: firstDefined(process.env.DB_HOST, process.env.PGHOST),
    port: portStr ? parseInt(portStr, 10) : undefined,
    database: firstDefined(process.env.DB_NAME, process.env.PGDATABASE),
    user: firstDefined(process.env.DB_USER, process.env.PGUSER),
    // Empty string yields a standard auth failure instead of opaque type error.
    password: fallbackPassword ?? '',
    ...basePoolConfig(),
  };
}

function buildPasswordGuidance(): string {
  if (resolveAuthSource() === 'database_url') {
    return 'DATABASE_URL auth is selected but DATABASE_URL is missing a usable password. Update DATABASE_URL with the current DB credentials.';
  }
  return 'Set DB_PASSWORD (or PGPASSWORD) from GCP Secret Manager before running DB scripts.';
}

function buildAuthFailureGuidance(): string {
  const user = resolvedDbUser();
  const connectionString = process.env.DATABASE_URL?.trim();
  const urlUser = connectionString ? readUrlUser(connectionString) : undefined;
  const authSource = resolveAuthSource();
  const hasExplicitPassword = Boolean(firstDefined(process.env.DB_PASSWORD, process.env.PGPASSWORD));
  const hasUrlPassword = Boolean(connectionString && readUrlPassword(connectionString));

  const hints: string[] = [];
  hints.push(`Database authentication failed${user ? ` for user \"${user}\"` : ''}.`);

  if (authSource === 'database_url') {
    hints.push('DATABASE_URL is the source of truth for DB credentials in this process.');
    if (hasExplicitPassword) {
      hints.push('DB_PASSWORD/PGPASSWORD is set but ignored while DATABASE_URL auth is active.');
    }
    hints.push('If credentials were rotated, update DATABASE_URL to match the active DB user password.');
  } else if (hasExplicitPassword) {
    hints.push('Using DB_PASSWORD/PGPASSWORD with host-based DB config. Ensure DB_USER and password come from the same secret pairing.');
  } else if (connectionString && hasUrlPassword) {
    hints.push('DATABASE_URL is present but DB_AUTH_SOURCE is env; set DB_PASSWORD/PGPASSWORD or switch DB_AUTH_SOURCE to database_url.');
  } else {
    hints.push('Set DB_PASSWORD/PGPASSWORD (or include the password in DATABASE_URL).');
  }

  if (authSource === 'database_url' && connectionString) {
    hints.push('When DATABASE_URL is set, the DB user comes from DATABASE_URL (not DB_USER/PGUSER).');
  }
  if (authSource === 'database_url' && urlUser && process.env.DB_USER && process.env.DB_USER !== urlUser) {
    hints.push(`DB_USER (${process.env.DB_USER}) differs from DATABASE_URL user (${urlUser}); align them or unset DATABASE_URL for host-based local proxy auth.`);
  }

  if (user === 'glyphor_system_user') {
    hints.push('For local/cloud consistency, pair glyphor_system_user with the db-system-password secret value.');
  }

  return hints.join(' ');
}

const pool = new Pool(buildPoolConfig());

async function connectClient(): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (message.includes('client password must be a string')) {
      throw new Error(`Database auth configuration invalid: ${buildPasswordGuidance()}`);
    }
    if (message.includes('password authentication failed for user')) {
      throw new Error(buildAuthFailureGuidance());
    }
    throw error;
  }
}

export async function tenantQuery<T = any>(
  tenantId: string,
  sql: string,
  params?: any[]
): Promise<T[]> {
  const client = await connectClient();
  try {
    await client.query(`SET app.current_tenant = $1`, [tenantId]).catch(() => {});
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function systemQuery<T = any>(
  sql: string,
  params?: any[]
): Promise<T[]> {
  const client = await connectClient();
  try {
    await client.query('SET ROLE glyphor_system').catch(() => {});
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.query('RESET ROLE').catch(() => {});
    client.release();
  }
}

export async function tenantTransaction<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await connectClient();
  try {
    await client.query('BEGIN');
    await client.query(`SET app.current_tenant = $1`, [tenantId]).catch(() => {});
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function systemTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await connectClient();
  let roleWasEscalated = false;
  try {
    // Avoid poisoning the transaction state when runtime DB users cannot SET ROLE.
    try {
      await client.query('SET ROLE glyphor_system');
      roleWasEscalated = true;
    } catch {
      roleWasEscalated = false;
    }

    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (roleWasEscalated) {
      await client.query('RESET ROLE').catch(() => {});
    }
    client.release();
  }
}

export async function insertReturning<T = any>(
  tenantId: string,
  table: string,
  data: Record<string, any>
): Promise<T> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columns = keys.join(', ');
  const sql = `INSERT INTO ${table} (tenant_id, ${columns}) VALUES ('${tenantId}', ${placeholders}) RETURNING *`;
  const rows = await tenantQuery<T>(tenantId, sql, values);
  return rows[0];
}

export async function updateById<T = any>(
  tenantId: string,
  table: string,
  id: string,
  data: Record<string, any>
): Promise<T> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const sql = `UPDATE ${table} SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`;
  const rows = await tenantQuery<T>(tenantId, sql, [...values, id]);
  return rows[0];
}

export async function checkDbHealth(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1');
    return result.rows.length === 1;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export { pool, Pool, PoolClient };
