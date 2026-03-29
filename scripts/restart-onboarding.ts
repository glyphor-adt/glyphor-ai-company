import { systemQuery } from '@glyphor/shared/db';
import { startOnboarding } from '../packages/slack-app/src/onboardingHandler.js';

const tenantId = process.argv[2] ?? 'acf2a335-bdc4-4d33-96a6-060be1358076';

async function main(): Promise<void> {
  const rows = await systemQuery<{
    bot_token: string;
    installer_user_id: string | null;
    onboarding_dm: string | null;
  }>(
    `SELECT bot_token,
            settings->>'installer_user_id' AS installer_user_id,
            settings->>'onboarding_dm' AS onboarding_dm
     FROM customer_tenants
     WHERE id = $1
     LIMIT 1`,
    [tenantId],
  );

  const tenant = rows[0];
  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }
  if (!tenant.installer_user_id) {
    throw new Error(`Missing installer_user_id for tenant ${tenantId}`);
  }

  await systemQuery(
    `UPDATE customer_tenants
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      tenantId,
      JSON.stringify({
        onboarding_phase: 'awaiting_connect',
        channels: { dm_owner: tenant.onboarding_dm ?? null },
      }),
    ],
  );

  await startOnboarding(tenantId, tenant.bot_token, tenant.installer_user_id);
  console.log(`Restarted onboarding for tenant ${tenantId}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
