const {systemQuery}=require('./packages/shared/dist/db/index.js');
(async()=>{
  const r=await systemQuery.query("SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name = 'tool_test_classifications'");
  console.log(r.rows);
  systemQuery.end?.();
})();
