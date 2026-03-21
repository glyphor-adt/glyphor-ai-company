/**
 * company_knowledge_base: founders, operations audience, brand_guide owner, deprecate layer-3 standing_orders.
 * Run: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/apply-ckb-founder-ops-brand-standing.ts
 */
import { closePool, systemTransaction } from '@glyphor/shared/db';

const FOUNDERS_CONTENT =
  'Kristina Denney is CEO and the sole technical architect. Andrew Zwelling is COO and owns operations, business development, and partnerships.\n\n' +
  'Technical architecture, infrastructure, agent-system design, product direction, and go-to-market strategy escalate to Kristina. Operational risk, financial models, partnerships, and spending decisions escalate to Andrew. Pricing decisions require both founders. Red-tier decisions require both founders.';

async function main(): Promise<void> {
  await systemTransaction(async (client) => {
    const r1 = await client.query(
      `UPDATE company_knowledge_base SET
        content = $1,
        version = version + 1,
        last_verified_at = NOW()
      WHERE section = 'founders'`,
      [FOUNDERS_CONTENT],
    );
    const r2 = await client.query(
      `UPDATE company_knowledge_base SET
        audience = 'all',
        version = version + 1
      WHERE section = 'operations'`,
    );
    const r3 = await client.query(
      `UPDATE company_knowledge_base SET
        owner_agent_id = 'cmo',
        version = version + 1
      WHERE section = 'brand_guide'`,
    );
    const r4 = await client.query(
      `UPDATE company_knowledge_base SET
        is_stale = TRUE,
        version = version + 1
      WHERE section = 'standing_orders'
        AND layer = 3`,
    );
    process.stdout.write(
      `founders=${r1.rowCount} operations=${r2.rowCount} brand_guide=${r3.rowCount} standing_orders(L3)=${r4.rowCount}\n`,
    );
  });
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
