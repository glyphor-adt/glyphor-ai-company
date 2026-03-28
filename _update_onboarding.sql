UPDATE customer_tenants
SET settings = COALESCE(settings, '{}'::jsonb) || '{"onboarding_phase": "awaiting_connect", "onboarding_dm": "D0APELD8FEW", "installer_user_id": "U0963M51FQF", "channels": {"dm_owner": "D0APELD8FEW"}}'::jsonb,
    updated_at = NOW()
WHERE id = 'acf2a335-bdc4-4d33-96a6-060be1358076'
RETURNING id, settings->>'onboarding_phase' AS phase, settings->>'onboarding_dm' AS dm;
