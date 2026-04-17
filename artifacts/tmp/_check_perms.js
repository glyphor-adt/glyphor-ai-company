const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor' });
c.connect().then(async () => {
  await c.query('SET ROLE glyphor_system');
  const r = await c.query("SELECT has_schema_privilege('glyphor_system', 'public', 'CREATE') as create_priv");
  console.log('glyphor_system CREATE:', r.rows[0]);
  const r2 = await c.query("SELECT current_user, session_user");
  console.log('roles:', r2.rows[0]);
  const r3 = await c.query("SELECT rolname, rolsuper FROM pg_roles WHERE rolname IN ('glyphor_system','glyphor_system_user')");
  console.log('role details:', r3.rows);
  const r4 = await c.query("SELECT grantor, grantee, privilege_type FROM information_schema.role_usage_grants WHERE object_schema = 'public' LIMIT 20");
  console.log('schema grants:', r4.rows);
  // Try a simple table create
  try {
    await c.query('CREATE TABLE IF NOT EXISTS cz_test_perm (id int)');
    console.log('CREATE TABLE succeeded');
    await c.query('DROP TABLE cz_test_perm');
  } catch (e) {
    console.log('CREATE TABLE failed:', e.message);
  }
  await c.end();
}).catch(e => console.error(e.message));
