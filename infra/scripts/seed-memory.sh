#!/usr/bin/env bash
# seed-memory.sh — Initialize Supabase with company baseline data
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?Set SUPABASE_URL}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:?Set SUPABASE_SERVICE_KEY}"

echo "=== Seeding Glyphor company memory ==="

# Insert company profile
curl -s -X POST "${SUPABASE_URL}/rest/v1/company_profile" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d '{
    "id": "glyphor-main",
    "name": "Glyphor AI",
    "vision": "Build autonomous AI-powered development tools that fundamentally change how software is created",
    "mission": "Empower developers with AI agents that understand, build, and evolve software systems",
    "okrs": {
      "Q1_2025": [
        {"objective": "Launch Fuse V7 with autonomous agent capabilities", "key_results": ["Ship Fuse V7 GA", "100 beta users", "95% build success rate"]},
        {"objective": "Establish company operating rhythm", "key_results": ["All 7 AI executives operational", "Daily briefings running", "Decision queue < 24h response"]}
      ]
    },
    "founders": {
      "kristina": {"role": "CEO", "focus": ["vision", "product", "market", "partnerships"], "timezone": "America/Chicago"},
      "andrew": {"role": "COO", "focus": ["financials", "operations", "risk", "infrastructure"], "timezone": "America/Chicago"}
    },
    "culture_values": ["Ship fast", "Measure everything", "AI-first operations", "Two-person leverage"],
    "updated_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
  }'

echo "  ✓ Company profile"

# Insert products
curl -s -X POST "${SUPABASE_URL}/rest/v1/products" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d '[
    {
      "slug": "fuse",
      "name": "Fuse",
      "status": "active",
      "description": "AI-powered autonomous coding agent that understands, builds, and evolves software",
      "tech_stack": ["TypeScript", "Node.js", "Gemini API", "VS Code Extension"],
      "metrics": {"mrr": 0, "active_users": 0, "builds_last_7d": 0}
    },
    {
      "slug": "pulse",
      "name": "Pulse",
      "status": "concept",
      "description": "Real-time AI code review and quality monitoring platform",
      "tech_stack": ["TypeScript", "Node.js"],
      "metrics": {"mrr": 0, "active_users": 0}
    }
  ]'

echo "  ✓ Products"

# Insert agent roster
curl -s -X POST "${SUPABASE_URL}/rest/v1/company_agents" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d '[
    {"role": "chief-of-staff", "name": "Sarah Chen", "status": "active", "model": "gemini-3-flash-preview", "schedule": "morning briefings 7:00/7:30 CT + on-demand"},
    {"role": "cto", "name": "Marcus Reeves", "status": "stub", "model": "gemini-3-flash-preview", "schedule": "every 30 min health check + on-demand"},
    {"role": "cfo", "name": "Nadia Okafor", "status": "stub", "model": "gemini-3-flash-preview", "schedule": "daily 9:00 CT cost check"},
    {"role": "cpo", "name": "Elena Vasquez", "status": "stub", "model": "gemini-3-flash-preview", "schedule": "weekly Monday 10:00 CT usage analysis"},
    {"role": "cmo", "name": "Maya Brooks", "status": "stub", "model": "gemini-3-flash-preview", "schedule": "weekly Monday 9:00 CT content planning"},
    {"role": "vp-customer-success", "name": "James Turner", "status": "stub", "model": "gemini-3-flash-preview", "schedule": "daily 8:00 CT health scoring"},
    {"role": "vp-sales", "name": "Rachel Kim", "status": "stub", "model": "gemini-3-flash-preview", "schedule": "Mon/Thu 9:00 CT pipeline review"}
  ]'

echo "  ✓ Agent roster"
echo "=== Seeding complete ==="
