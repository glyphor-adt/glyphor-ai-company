const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor' });
c.connect().then(async () => {
  // Check what roles glyphor_system_user can SET ROLE to
  const r = await c.query("SELECT r.rolname FROM pg_roles r JOIN pg_auth_members m ON r.oid = m.roleid WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'glyphor_system_user')");
  console.log('glyphor_system_user member of:', r.rows);
  
  // Check glyphor_app
  const r2 = await c.query("SELECT rolname, rolsuper, rolcreatedb FROM pg_roles WHERE rolname = 'glyphor_app'");
  console.log('glyphor_app role:', r2.rows);

  // Check who owns public schema
  const r3 = await c.query("SELECT nspname, pg_catalog.pg_get_userbyid(nspowner) as owner FROM pg_namespace WHERE nspname = 'public'");
  console.log('public schema owner:', r3.rows);

  // Try SET ROLE to glyphor_app
  try {
    await c.query('SET ROLE glyphor_app');
    console.log('SET ROLE glyphor_app succeeded');
    const r4 = await c.query("SELECT has_schema_privilege('glyphor_app', 'public', 'CREATE') as create_priv");
    console.log('glyphor_app CREATE:', r4.rows[0]);
  } catch (e) {
    console.log('SET ROLE glyphor_app failed:', e.message);
  }
  
  // List all roles
  const r5 = await c.query("SELECT rolname FROM pg_roles ORDER BY rolname");
  console.log('all roles:', r5.rows.map(r => r.rolname));
  
  await c.end();
}).catch(e => console.error(e.message));
