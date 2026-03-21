const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'127.0.0.1',port:6543,database:'glyphor',user:'glyphor_app',password:process.env.PGPASSWORD});
  await c.connect();
  const res = await c.query("SELECT conname, contype, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE conrelid::regclass::text IN ('tool_test_classifications', 'tool_reputation', 'fleet_findings', 'world_state', 'tool_test_runs', 'tool_test_results');");
  console.log(res.rows);
  await c.end();
})();
