/**
 * Active roster: company_agents.model as stored vs resolveModel() canonical.
 *   npx tsx --env-file=.env scripts/list-configured-agent-models.ts
 */
import { pool, closePool } from '@glyphor/shared/db';
import { resolveModel } from '@glyphor/shared/models';

async function main(): Promise<void> {
  const { rows } = await pool.query<{
    role: string;
    display_name: string;
    model: string;
    temperature: number;
    max_turns: number;
  }>(
    `SELECT role, display_name, model, temperature, max_turns
     FROM company_agents
     WHERE status = 'active'
     ORDER BY role`,
  );

  const out = rows.map((r) => ({
    role: r.role,
    display_name: r.display_name,
    configured_model_raw: r.model,
    resolved_model: resolveModel(r.model),
    temperature: r.temperature,
    max_turns: r.max_turns,
  }));

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), agents: out }, null, 2));
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => {});
  process.exit(1);
});
