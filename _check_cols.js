const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'127.0.0.1',port:6543,database:'glyphor',user:'glyphor_app',password:process.env.PGPASSWORD});
  await c.connect();
  const res = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'world_state'");
  console.log(res.rows.map(r => r.column_name));
  await c.end();
})();
