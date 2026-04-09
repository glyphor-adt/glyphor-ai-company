import pg from 'pg';

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Update infrastructure KB entry with full secrets/integrations inventory
const newContent = `GCP Cloud Run, Cloud SQL PostgreSQL, Cloud Scheduler, Cloud Tasks, Redis, Secret Manager, Artifact Registry. Region: us-central1.

All secrets and integrations below are ALREADY PROVISIONED in GCP Secret Manager and mounted as environment variables on every Cloud Run service. Do NOT create assignments to "add" or "configure" these — they are live and working.

AI & API keys: GOOGLE_AI_API_KEY, AZURE_FOUNDRY_ENDPOINT, AZURE_FOUNDRY_API
Database: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD (Cloud SQL PostgreSQL)
GitHub: GITHUB_TOKEN (PAT with repo access), GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_INSTALLATION_ID, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
Microsoft 365 / Teams: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, TEAMS_TEAM_ID, all TEAMS_CHANNEL_* IDs, TEAMS_USER_* IDs, AGENT365_* credentials
Payments & Banking: STRIPE_SECRET_KEY, MERCURY_API_TOKEN
Creative tools: PULSE_SERVICE_ROLE_KEY, PULSE_MCP_ENDPOINT
Infrastructure: GCP_PROJECT_ID, GCS_BUCKET
Design: FIGMA_ACCESS_TOKEN, CANVA credentials, VERCEL_TOKEN

If a tool returns a "not configured" error for any of the above, the issue is a code bug — not a missing secret. Escalate to Marcus (CTO), do not self-block.`;

await c.query(
  'UPDATE company_knowledge_base SET content = $1, updated_at = NOW() WHERE id = $2',
  [newContent, '5e715278-8b03-4ac2-b5cf-e28fd42a62f9']
);
console.log('Infrastructure KB entry updated');

// Also add a new "assignment_rules" entry to the KB that all agents see
const assignmentRulesContent = `Before marking any assignment as "blocked":
1. Try using the tools first. All infrastructure (GitHub tokens, API keys, database access, Figma, Vercel, Stripe, etc.) is already configured and available. If a task says "add a secret" or "configure access" — check whether it already works before blocking.
2. If a tool returns an error, that is a bug to escalate — not a reason to block. Send a message to Marcus (CTO) or Atlas (Ops) with the error details.
3. If you need a deliverable from another agent, ask them directly via send_agent_message instead of blocking and waiting.
4. Never block on setup tasks. Secrets, env vars, API tokens, and integrations are managed by the infrastructure team and are already live.`;

// Check if it exists first
const existing = await c.query(
  "SELECT id FROM company_knowledge_base WHERE section = 'operations' AND title = 'Assignment Rules'"
);

if (existing.rows.length === 0) {
  await c.query(
    `INSERT INTO company_knowledge_base (id, section, title, content, audience, last_edited_by, version, is_active)
     VALUES (gen_random_uuid(), 'operations', 'Assignment Rules', $1, 'all', 'system', 1, true)`,
    [assignmentRulesContent]
  );
  console.log('Assignment Rules KB entry created');
} else {
  await c.query(
    'UPDATE company_knowledge_base SET content = $1, updated_at = NOW() WHERE id = $2',
    [assignmentRulesContent, existing.rows[0].id]
  );
  console.log('Assignment Rules KB entry updated');
}

await c.end();
