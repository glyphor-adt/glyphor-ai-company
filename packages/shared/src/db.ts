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

function basePoolConfig(): Pick<PoolConfig, 'max' | 'idleTimeoutMillis' | 'connectionTimeoutMillis'> {
  return {
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
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
  return firstDefined(
    process.env.DB_USER,
    process.env.PGUSER,
    process.env.DATABASE_URL ? readUrlUser(process.env.DATABASE_URL) : undefined
  );
}

function buildPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL?.trim();
  const fallbackPassword = firstDefined(process.env.DB_PASSWORD, process.env.PGPASSWORD);

  if (connectionString) {
    const passwordFromUrl = readUrlPassword(connectionString);

    return {
      connectionString,
      // Prefer explicit env password so rotated secrets can override stale DATABASE_URL values.
      // Ensure SCRAM auth always receives a string even if env setup is partial.
      password: fallbackPassword ?? passwordFromUrl ?? '',
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
  if (process.env.DATABASE_URL?.trim()) {
    return 'DATABASE_URL is set but missing a usable password. Provide postgres://user:pass@host/db or set DB_PASSWORD/PGPASSWORD.';
  }
  return 'Set DB_PASSWORD (or PGPASSWORD) from GCP Secret Manager before running DB scripts.';
}

function buildAuthFailureGuidance(): string {
  const user = resolvedDbUser();
  const connectionString = process.env.DATABASE_URL?.trim();
  const urlUser = connectionString ? readUrlUser(connectionString) : undefined;
  const hasExplicitPassword = Boolean(firstDefined(process.env.DB_PASSWORD, process.env.PGPASSWORD));
  const hasUrlPassword = Boolean(connectionString && readUrlPassword(connectionString));

  const hints: string[] = [];
  hints.push(`Database authentication failed${user ? ` for user \"${user}\"` : ''}.`);

  if (connectionString && hasExplicitPassword && hasUrlPassword) {
    hints.push('Both DATABASE_URL and DB_PASSWORD/PGPASSWORD are set; DB_PASSWORD/PGPASSWORD is used as override. Ensure it matches the active DB user password.');
  } else if (connectionString && hasUrlPassword) {
    hints.push('Using password from DATABASE_URL. If the password was rotated, update DATABASE_URL or provide DB_PASSWORD/PGPASSWORD to override it.');
  } else {
    hints.push('Set DB_PASSWORD/PGPASSWORD (or include the password in DATABASE_URL).');
  }

  if (connectionString) {
    hints.push('When DATABASE_URL is set, the DB user comes from DATABASE_URL (not DB_USER/PGUSER).');
  }
  if (urlUser && process.env.DB_USER && process.env.DB_USER !== urlUser) {
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
