const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'127.0.0.1',port:6543,database:'glyphor',user:'glyphor_app',password:process.env.PGPASSWORD});
  await c.connect();
  try {
     const res = await c.query("INSERT INTO world_state (domain, entity_id, key, value, written_by_agent, confidence) VALUES ('test', 'test', 'test', '{}', 'test', 1.0) ON CONFLICT (domain, entity_id, key) DO UPDATE SET value = EXCLUDED.value RETURNING id");
     console.log('OK', res.rows);
  } catch(e) {
     console.log('ERR', e.message);
  }
  await c.end();
})();
