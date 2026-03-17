-- Fix stale/hallucinated data in company_knowledge_base
-- The mission section was missing company IDs and the metrics section had fake data

-- Update mission section with company identity details
UPDATE company_knowledge_base
SET content = E'**Glyphor** is an AI platform company. We build autonomous software that replaces entire development and creative teams. We are not a dev tool, not a copilot, not an assistant — we are the team itself.\n\n**Legal Name:** Glyphor, Inc.\n**Entity Type:** Delaware C-Corp (60/40 equity — Kristina/Andrew)\n**Founded:** 2025\n**Headquarters:** Dallas, TX\n**Website/Domain:** glyphor.ai\n**GCP Project:** ai-glyphor-company\n**GCP Billing Account:** 012B03-F562EC-184CD8\n**SharePoint:** glyphorai.sharepoint.com/sites/glyphor-knowledge\n**GitHub Org:** glyphor-adt\n**Employees:** 0 W-2. 28 AI agents + 2 human founders.',
    updated_at = NOW()
WHERE section = 'mission';

-- Fix the metrics section — replace fake data with correct pre-launch values
UPDATE company_knowledge_base
SET content = E'MRR: $0 (pre-revenue, pre-launch)\nPaying users: 0 (products have not launched)\nActive agents: 28\nMonthly compute budget target: $150\nInfrastructure: GCP Cloud Run, Cloud SQL PostgreSQL, Cloud Scheduler\n\nGlyphor is pre-revenue and pre-launch. There are zero customers, zero users, and $0 MRR. This is expected — Pulse and Fuse are still in development. Do NOT report any other MRR or user count.',
    updated_at = NOW()
WHERE section = 'metrics';

-- Update current priorities to match CORE.md
UPDATE company_knowledge_base
SET content = E'1. Platform health stabilization\n2. Brand voice and identity system\n3. Competitive landscape research\n4. Slack AI Marketing Department landing page\n5. Still You campaign launch',
    updated_at = NOW()
WHERE section = 'current_priorities';
