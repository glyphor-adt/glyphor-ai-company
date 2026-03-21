const { execFileSync } = require('child_process');
const { Client } = require('pg');

function getSecret(secretName) {
  try {
    return execFileSync('gcloud', [
      'secrets', 'versions', 'access', 'latest',
      `--secret=${secretName}`,
      '--project=ai-glyphor-company',
    ], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function test(port, user, password, label) {
  const client = new Client({
    host: '127.0.0.1',
    port,
    database: 'glyphor',
    user,
    password,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const result = await client.query(
      'select current_user as user_name, inet_server_addr()::text as server_addr, inet_server_port() as server_port'
    );
    console.log(JSON.stringify({ label, ok: true, row: result.rows[0] }));
  } catch (error) {
    console.log(JSON.stringify({ label, ok: false, error: String(error.message || error) }));
  } finally {
    try { await client.end(); } catch {}
  }
}

(async () => {
  const appPassword = getSecret('db-password');
  const systemPassword = getSecret('db-system-password');

  console.log(JSON.stringify({
    appPasswordLoaded: Boolean(appPassword),
    appPasswordLength: appPassword ? appPassword.length : 0,
    systemPasswordLoaded: Boolean(systemPassword),
    systemPasswordLength: systemPassword ? systemPassword.length : 0,
  }));

  const combos = [
    ['glyphor_app', appPassword, 'app+db-password'],
    ['glyphor_app', systemPassword, 'app+db-system-password'],
    ['glyphor_system_user', appPassword, 'system+db-password'],
    ['glyphor_system_user', systemPassword, 'system+db-system-password'],
  ];

  for (const port of [15432, 6543]) {
    for (const [user, password, combo] of combos) {
      const label = `${combo}@${port}`;
      if (!password) {
        console.log(JSON.stringify({ label, ok: false, error: 'secret_unavailable' }));
        continue;
      }
      await test(port, user, password, label);
    }
  }
})();
