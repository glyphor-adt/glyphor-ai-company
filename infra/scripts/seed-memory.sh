#!/usr/bin/env bash
# seed-memory.sh — Initialize Cloud SQL with company baseline data
set -euo pipefail

DB_HOST="${DB_HOST:?Set DB_HOST}"
DB_NAME="${DB_NAME:?Set DB_NAME}"
DB_USER="${DB_USER:?Set DB_USER}"
DB_PASSWORD="${DB_PASSWORD:?Set DB_PASSWORD}"

export PGPASSWORD="$DB_PASSWORD"
PSQL="psql -h $DB_HOST -U $DB_USER -d $DB_NAME -q"

echo "=== Seeding Glyphor company memory ==="

# Insert company profile
$PSQL <<'SQL'
INSERT INTO company_profile (id, name, vision, mission, okrs, founders, culture_values, updated_at)
VALUES (
  'glyphor-main',
  'Glyphor AI',
  'Build autonomous AI-powered development tools that fundamentally change how software is created',
  'Empower developers with AI agents that understand, build, and evolve software systems',
  '{"Q1_2025": [{"objective": "Launch Fuse V7 with autonomous agent capabilities", "key_results": ["Ship Fuse V7 GA", "100 beta users", "95% build success rate"]}, {"objective": "Establish company operating rhythm", "key_results": ["All 7 AI executives operational", "Daily briefings running", "Decision queue < 24h response"]}]}'::jsonb,
  '{"kristina": {"role": "CEO", "focus": ["vision", "product", "market", "partnerships"], "timezone": "America/Chicago"}, "andrew": {"role": "COO", "focus": ["financials", "operations", "risk", "infrastructure"], "timezone": "America/Chicago"}}'::jsonb,
  ARRAY['Ship fast', 'Measure everything', 'AI-first operations', 'Two-person leverage'],
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  vision = EXCLUDED.vision,
  mission = EXCLUDED.mission,
  okrs = EXCLUDED.okrs,
  founders = EXCLUDED.founders,
  culture_values = EXCLUDED.culture_values,
  updated_at = NOW();
SQL

echo "  ✓ Company profile"

# Insert products
$PSQL <<'SQL'
INSERT INTO products (slug, name, status, description, tech_stack, metrics) VALUES
  ('fuse', 'Fuse', 'active', 'AI-powered autonomous coding agent that understands, builds, and evolves software', ARRAY['TypeScript', 'Node.js', 'Gemini API', 'VS Code Extension'], '{"mrr": 0, "active_users": 0, "builds_last_7d": 0}'::jsonb),
  ('pulse', 'Pulse', 'concept', 'Real-time AI code review and quality monitoring platform', ARRAY['TypeScript', 'Node.js'], '{"mrr": 0, "active_users": 0}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  description = EXCLUDED.description,
  tech_stack = EXCLUDED.tech_stack,
  metrics = EXCLUDED.metrics;
SQL

echo "  ✓ Products"

# Insert agent roster
$PSQL <<'SQL'
INSERT INTO company_agents (role, name, status, model, schedule) VALUES
  ('chief-of-staff', 'Sarah Chen', 'active', 'gemini-3-flash-preview', 'morning briefings 7:00/7:30 CT + on-demand'),
  ('cto', 'Marcus Reeves', 'stub', 'gemini-3-flash-preview', 'every 30 min health check + on-demand'),
  ('cfo', 'Nadia Okafor', 'stub', 'gemini-3-flash-preview', 'daily 9:00 CT cost check'),
  ('cpo', 'Elena Vasquez', 'stub', 'gemini-3-flash-preview', 'weekly Monday 10:00 CT usage analysis'),
  ('cmo', 'Maya Brooks', 'stub', 'gemini-3-flash-preview', 'weekly Monday 9:00 CT content planning'),
  ('vp-sales', 'Rachel Kim', 'stub', 'gemini-3-flash-preview', 'Mon/Thu 9:00 CT pipeline review')
ON CONFLICT (role) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  model = EXCLUDED.model,
  schedule = EXCLUDED.schedule;
SQL

echo "  ✓ Agent roster"
echo "=== Seeding complete ==="
