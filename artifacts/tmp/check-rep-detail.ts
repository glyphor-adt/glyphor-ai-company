import { pool } from '@glyphor/shared/db';

async function main() {
  // Get tool_reputation columns
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='tool_reputation' ORDER BY ordinal_position`);
  console.log('=== TOOL_REPUTATION COLUMNS ===', cols.rows.map((r: any) => r.column_name).join(', '));

  // Full row for create_decision
  const cd = await pool.query(`SELECT * FROM tool_reputation WHERE tool_name = 'create_decision'`);
  console.log('=== create_decision FULL ROW ===');
  if (cd.rows[0]) console.log(JSON.stringify(cd.rows[0], null, 2));

  // Full row for propose_initiative
  const pi = await pool.query(`SELECT * FROM tool_reputation WHERE tool_name = 'propose_initiative'`);
  console.log('=== propose_initiative FULL ROW ===');
  if (pi.rows[0]) console.log(JSON.stringify(pi.rows[0], null, 2));

  // Full row for send_briefing
  const sb = await pool.query(`SELECT * FROM tool_reputation WHERE tool_name = 'send_briefing'`);
  console.log('=== send_briefing FULL ROW ===');
  if (sb.rows[0]) console.log(JSON.stringify(sb.rows[0], null, 2));

  await pool.end();
}
main();
