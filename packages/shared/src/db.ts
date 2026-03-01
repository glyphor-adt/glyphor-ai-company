import { Pool } from 'pg';
import type { PoolClient } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function tenantQuery<T = any>(
  tenantId: string,
  sql: string,
  params?: any[]
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET app.current_tenant = $1`, [tenantId]);
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
  const client = await pool.connect();
  try {
    await client.query('SET ROLE glyphor_system');
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET app.current_tenant = $1`, [tenantId]);
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET ROLE glyphor_system');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.query('RESET ROLE').catch(() => {});
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

export { pool, Pool };
