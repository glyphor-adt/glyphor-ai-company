import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = await c.query(`
  SELECT started_at, agent_id, task, status, tool_calls, input_tokens, output_tokens, 
         error, LEFT(COALESCE(output,''), 160) AS output_preview 
  FROM agent_runs 
  WHERE started_at >= NOW() - INTERVAL '90 minutes' 
  ORDER BY started_at DESC 
  LIMIT 20
`);
console.log(JSON.stringify(q.rows, null, 2));
await c.end();
