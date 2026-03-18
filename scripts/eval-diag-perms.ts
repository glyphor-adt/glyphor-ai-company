import { pool } from '@glyphor/shared/db';

async function main() {
  // Check current user
  const { rows: [me] } = await pool.query("SELECT current_user, current_database()");
  console.log(`Current user: ${me.current_user}, DB: ${me.current_database}`);

  // Check table ownership
  const { rows: owners } = await pool.query(`
    SELECT tableowner, tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'task_run_outcomes'
  `);
  console.log(`task_run_outcomes owner: ${owners[0]?.tableowner}`);

  // Check roles
  const { rows: roles } = await pool.query(`
    SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles
    WHERE rolname IN ('glyphor_system_user', 'glyphor_app', 'cloudsqlsuperuser', 'postgres')
  `);
  roles.forEach(r => console.log(`  ${r.rolname}: super=${r.rolsuper}, createdb=${r.rolcreatedb}`));

  // Check grants on public schema
  const { rows: schemaGrants } = await pool.query(`
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_name = 'task_run_outcomes' AND grantee = 'glyphor_system_user'
  `);
  console.log(`\ngrants on task_run_outcomes for system_user:`, schemaGrants.map(r => r.privilege_type));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
