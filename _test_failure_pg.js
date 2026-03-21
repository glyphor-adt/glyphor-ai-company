const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'127.0.0.1',port:6543,database:'glyphor',user:'glyphor_app',password:process.env.PGPASSWORD});
  await c.connect();
  try {
     const res = await c.query("INSERT INTO fleet_findings (agent_id, severity, finding_type, description, score_penalty) VALUES ('tool-registry', 'P0', 'tool_health_failure:dummy', 'test desc', 0.15) ON CONFLICT (agent_id, finding_type) DO UPDATE SET description = EXCLUDED.description RETURNING id");
     console.log('OK', res.rows);
  } catch(e) {
     console.log('ERR', e.message);
  }
  await c.end();
})();
