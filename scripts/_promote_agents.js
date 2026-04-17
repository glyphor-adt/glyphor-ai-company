const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000000';

// Based on analysis:
// CTO: 89.5% completion → L2 (composite ceiling L2)
// CFO: 90% completion → L2 (composite ceiling L2)
// chief-of-staff: 76.7% completion → L1 (composite ceiling L1)
// vp-research: 87.5% completion → L2 (composite ceiling L2)
// CMO: 64.8% → L0 (below 70% for L1)
// CPO: 65.3% → L0
// ops: 39% → L0
// vp-design: 57.5% → L0
// devops-engineer: no runs → L0
// platform-engineer: no runs → L0
// quality-engineer: no runs → L0

const promotions = [
  { agentId: 'cto', fromLevel: 0, toLevel: 2, reason: 'Manual promotion: 89.5% completion, trust 0.501, composite 0.58, threshold fit L2, ceiling L2' },
  { agentId: 'cfo', fromLevel: 0, toLevel: 2, reason: 'Manual promotion: 90% completion, trust 0.500, composite 0.53, threshold fit L2, ceiling L2' },
  { agentId: 'chief-of-staff', fromLevel: 0, toLevel: 1, reason: 'Manual promotion: 76.7% completion, trust 0.503, composite 0.44, threshold fit L1, ceiling L1' },
  { agentId: 'vp-research', fromLevel: 0, toLevel: 2, reason: 'Manual promotion: 87.5% completion, trust 0.500, composite 0.50, threshold fit L2, ceiling L2' },
];

async function main() {
  await c.connect();

  for (const p of promotions) {
    console.log(`Promoting ${p.agentId}: L${p.fromLevel} → L${p.toLevel}`);
    
    // Update config
    await c.query(`
      UPDATE agent_autonomy_config
      SET current_level = $1,
          promoted_at = NOW(),
          last_level_change_at = NOW(),
          last_level_change_reason = $2,
          updated_at = NOW()
      WHERE agent_id = $3
    `, [p.toLevel, p.reason, p.agentId]);

    // Insert history
    await c.query(`
      INSERT INTO autonomy_level_history (
        id, agent_id, from_level, to_level, change_type,
        trust_score_at_change, reason, changed_by, tenant_id, created_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, 'auto_promote',
        (SELECT trust_score FROM agent_trust_scores WHERE agent_role = $1),
        $4, 'system', $5, NOW()
      )
    `, [p.agentId, p.fromLevel, p.toLevel, p.reason, DEFAULT_TENANT]);

    console.log(`  ✓ Done`);
  }

  // Verify
  console.log('\n=== Updated configs ===');
  const configs = await c.query('SELECT agent_id, current_level, max_allowed_level FROM agent_autonomy_config ORDER BY agent_id');
  configs.rows.forEach(r => console.log(`  ${r.agent_id}: L${r.current_level} (max L${r.max_allowed_level})`));

  console.log('\n=== Level history ===');
  const hist = await c.query('SELECT agent_id, from_level, to_level, change_type, created_at FROM autonomy_level_history ORDER BY created_at DESC LIMIT 10');
  hist.rows.forEach(r => console.log(`  ${r.agent_id}: L${r.from_level}→L${r.to_level} ${r.change_type} @ ${r.created_at}`));

  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
