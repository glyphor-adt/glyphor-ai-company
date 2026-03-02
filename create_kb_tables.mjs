import pg from 'pg';

const c = new pg.Client({
  host: '136.111.200.6',
  database: 'glyphor',
  user: 'glyphor_app',
  password: 'lGHMxoC8zpmngKUaYv9cOTwJ',
  ssl: { rejectUnauthorized: false }
});
await c.connect();

// 1. Create company_knowledge_base table
await c.query(`
  CREATE TABLE IF NOT EXISTS company_knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all',
    last_edited_by TEXT DEFAULT 'system',
    version INT DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('Created company_knowledge_base');

await c.query('CREATE INDEX IF NOT EXISTS idx_ckb_audience ON company_knowledge_base (audience) WHERE is_active = true');
await c.query('CREATE INDEX IF NOT EXISTS idx_ckb_section ON company_knowledge_base (section)');

// 2. Create founder_bulletins table
await c.query(`
  CREATE TABLE IF NOT EXISTS founder_bulletins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by TEXT NOT NULL,
    content TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all',
    priority TEXT DEFAULT 'normal',
    active_from TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('Created founder_bulletins');

await c.query('CREATE INDEX IF NOT EXISTS idx_bulletins_active ON founder_bulletins (is_active, audience) WHERE is_active = true');
await c.query('CREATE INDEX IF NOT EXISTS idx_bulletins_expires ON founder_bulletins (expires_at) WHERE is_active = true');

// 3. Seed knowledge base with full content from migration
const sections = [
  ['mission', 'Company Mission & Identity',
   'Glyphor is an AI platform company. We build autonomous software that replaces entire development and creative teams. We are not a dev tool, not a copilot, not an assistant — we are the team itself.\n\nFounded: 2025\nHeadquarters: Dallas, TX\nLegal entity: Glyphor Inc. (Delaware)',
   'all'],
  ['founders', 'Founders',
   'Kristina Denney — CEO\n- Microsoft Director, Cloud & AI Platform Specialist\n- 25+ years in tech\n- Available 5-10h/week for Glyphor\n\nAndrew Zwelling — COO\n- Microsoft Sr. Cloud & AI Platform Specialist\n- MBA from Duke University\n- Available 5-10h/week for Glyphor',
   'all'],
  ['products', 'Products',
   'Fuse — Autonomous Development Platform\nUsers describe what they want to build. AI agents design, code, and deploy complete web applications autonomously.\nPricing: Free tier (3 builds/mo) → Pro $29/mo → Enterprise custom\n\nPulse — Autonomous Creative Platform\nAI agents create brand identities, marketing assets, social content, and design systems.\nStatus: Beta',
   'all'],
  ['current_priorities', 'Current Priorities',
   '1. Activate the AI agent workforce — all agents running autonomously\n2. Fix telemetry blackout (P0)\n3. Launch Fuse content marketing\n4. Enterprise prospect research\n5. Establish data pipelines',
   'all'],
  ['metrics', 'Current Metrics',
   'MRR: $3,247 (+12% MoM)\nPaying users: 47 (Fuse: 39, Pulse: 8)\nBuild success rate: Fuse 91%, Pulse 89%\nInfrastructure cost MTD: $847\nGross margin: 62.3%\nActive agents: 27',
   'all'],
  ['team_structure', 'Team Structure',
   'CEO: Kristina Denney — strategy, sales, external\nCOO: Andrew Zwelling — operations, finance, infrastructure\nExecutive Team: Sarah (CoS), Marcus (CTO), Nadia (CFO), Elena (CPO), Maya (CMO), James (VP CS), Rachel (VP Sales), Mia (VP Design)\nEach executive manages 2-3 sub-team specialists. Atlas handles operations.',
   'all'],
  ['culture', 'Culture & Communication',
   'Tone: Direct. No filler. Data-first. Recommendation-included. Concise.\nExternal content: Bold, technical but accessible, authentic builder energy.',
   'all'],
  ['authority_model', 'Authority Model',
   'GREEN — Act Autonomously: No approval needed.\nYELLOW — One Founder Approval: Post to #decisions.\nRED — Both Founders Required: Discussed at weekly sync.\nSub-team members: GREEN only. Executives: GREEN + YELLOW/RED.',
   'all'],
  ['competitive_landscape', 'Competitive Landscape',
   'Our position: We are NOT a copilot or code assistant. We are autonomous — the AI IS the team.\nCompetitors: Lovable, Bolt.new, Cursor, Devin (Cognition), GitHub Copilot, Canva AI / Runway',
   'all'],
  ['infrastructure', 'Infrastructure',
   'GCP Cloud Run: Agent execution (~$187/mo)\nGemini API: AI inference (~$412/mo)\nCloud SQL: Database\nVercel: Frontend hosting (~$67/mo)\nGCS: Document storage (~$5/mo)\nTotal: ~$850/mo',
   'all'],
  ['pricing', 'Pricing Strategy',
   'Fuse: Free tier (3 builds/mo) → Pro $29/mo → Enterprise custom ($25K-50K/mo)\nEnterprise segments: Starter ($10K), Growth ($25K), Enterprise ($50K-75K)',
   'all'],
];

for (const [section, title, content, audience] of sections) {
  await c.query(
    'INSERT INTO company_knowledge_base (section, title, content, audience) VALUES ($1, $2, $3, $4) ON CONFLICT (section) DO NOTHING',
    [section, title, content, audience]
  );
}

const r1 = await c.query('SELECT count(*) as n FROM company_knowledge_base');
console.log('company_knowledge_base rows:', r1.rows[0].n);

const r2 = await c.query('SELECT count(*) as n FROM founder_bulletins');
console.log('founder_bulletins rows:', r2.rows[0].n);

// Check existing tables to verify
const tables = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('company_knowledge_base', 'founder_bulletins')`);
console.log('Tables verified:', tables.rows.map(r => r.tablename));

await c.end();
