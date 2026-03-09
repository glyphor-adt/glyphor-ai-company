const {Client}=require('pg');
const c=new Client({host:'127.0.0.1',port:5434,user:'glyphor_app',password:'lGHMxoC8zpmngKUaYv9cOTwJ',database:'glyphor'});
(async()=>{
  await c.connect();

  console.log('=== 1. HEARTBEAT RUNS ===');
  const r1=await c.query("SELECT started_at, status, turns, LEFT(output,500) as output_preview, LEFT(error,300) as error_preview FROM agent_runs WHERE task='heartbeat' ORDER BY started_at DESC LIMIT 5");
  console.table(r1.rows);

  console.log('\n=== 2. WORK LOOPS (last 10 min) ===');
  const r2=await c.query("SELECT agent_id as agent_role, started_at, status, turns, LEFT(output,200) as output_preview, LEFT(error,200) as error_preview FROM agent_runs WHERE task='work_loop' AND started_at > NOW() - INTERVAL '10 minutes' ORDER BY started_at DESC");
  console.table(r2.rows);

  console.log('\n=== 3. WORK ASSIGNMENTS ===');
  const r3=await c.query("SELECT wa.assigned_to, wa.status, wa.updated_at, LEFT(wa.task_description,80) as task FROM work_assignments wa WHERE wa.status IN ('dispatched','in_progress','completed') ORDER BY wa.updated_at DESC LIMIT 10");
  console.table(r3.rows);

  console.log('\n=== 4. WAKE QUEUE ===');
  const r4=await c.query("SELECT agent_role, task, status, created_at FROM agent_wake_queue ORDER BY created_at DESC LIMIT 10");
  console.table(r4.rows);

  console.log('\n=== 5. RECENT EVENTS (last 10 min) ===');
  const r5=await c.query("SELECT type, source, processed_by, timestamp FROM events WHERE timestamp > NOW() - INTERVAL '10 minutes' ORDER BY timestamp DESC LIMIT 10");
  console.table(r5.rows);

  await c.end();
})().catch(e=>{console.error(e.message);c.end()});
