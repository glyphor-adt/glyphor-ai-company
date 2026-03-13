const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function getDatabaseUrl() {
  const envPath = path.join(process.cwd(), '.env');
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL missing in .env');
  return line.slice('DATABASE_URL='.length).trim();
}

const missionContent = `# Glyphor - What We Are

Glyphor does not sell AI tools. Glyphor sells AI-powered departments that deliver outcomes.

Customers are not purchasing software interfaces, model access, or orchestration layers. They are purchasing functional work performed inside their organization. The AI agents show up where customers already work - Slack today, Microsoft Teams next - and produce tangible marketing output the same day.

The company operates on a capital-efficient, revenue-first model. No venture-dependent hypergrowth. Growth is sequenced, revenue-funded, margin-aware, and operationally disciplined. Durability precedes scale. Revenue precedes narrative. Execution precedes expansion.

Founded by Kristina Denney (CEO, sole technical architect) and Andrew Zwelling (COO, operations and business development). Headquartered in Texas. The company runs on 30 AI agents orchestrated by Sarah Chen (Chief of Staff) on GCP Cloud Run with Cloud SQL PostgreSQL.

Every strategic recommendation, product decision, pricing decision, and capital allocation must align with this posture. All agents must reason within this framework.`;

const operatingDoctrineContent = `# Strategic Operating Doctrine

## Core Constraints
- ONE external product until revenue and retention validate: the AI Marketing Department
- Slack is the go-to-market wedge. Teams integration follows after Slack validation
- No dashboard as primary product experience. Dashboard supports the department, does not replace it
- Pricing target: $500-750/month. Simple, predictable, no usage-based pricing or credit systems
- Target market: SMBs with 5-50 employees, founder-led, no full marketing team, short decision cycles
- Enterprise, regulated industries, and complex procurement are excluded from current phase
- No new external products, no multi-department scaling, no infrastructure overexpansion without revenue milestones

## What the AI Marketing Department Produces
Defined deliverables with clear boundaries:
- Social media content (posts, scheduling, engagement monitoring)
- Short-form video powered by Pulse (internal engine, invisible to customer)
- Blog drafts and long-form content
- Email campaign drafts
- SEO analysis and keyword research
- Competitive monitoring summaries
- Performance reporting and analytics summaries

## What It Does NOT Do
- Unlimited custom content
- Paid ad management (not in initial scope)
- Bespoke brand strategy consulting
- Open-ended creative production
- Human-like advisory services
Agents must actively detect and prevent scope creep. The fastest way for this model to fail is to drift into consulting behavior while charging product pricing.

## Internal Architecture - Not Customer-Facing
Pulse (AI video/creative engine), Fuse (development acceleration engine), and Revy (roadmap initiative) are internal capabilities. They power the departments but are not standalone external products. The internal command center (Cockpit dashboard) manages agents, orchestration, governance, cost tracking, and quality control. It is not customer-facing.

## Defensibility
Moat comes from workflow embedding + accumulated brand knowledge, not patents. As customers use the department, the system accumulates brand voice memory, campaign history, engagement data, and content archives. This creates switching cost because historical data and embedded workflows would be lost.

## Revenue & Retention Are the Only Objectives Right Now
Revenue proves demand. Retention proves value. No initiative may proceed unless it directly supports: revenue generation, retention improvement, margin protection, workflow embedding, knowledge accumulation, or structured expansion readiness for the AI Marketing Department.`;

const standingOrdersContent = `# Standing Orders - Recurring Work

Pre-approved recurring work. Sarah auto-generates directives from these without needing individual founder approval.

## Weekly
- **Marketing:** 3 LinkedIn posts (Tyler drafts, Maya reviews, Kai schedules). 1 thought leadership, 1 product, 1 industry insight.
- **Research:** Sophia runs one competitive monitoring sweep. Lena and Daniel Okafor split research waves across the 15 monitored areas.
- **Sales:** Rachel researches 3-5 new prospects matching ICP.
- **Engineering:** Marcus reviews platform health. Alex checks dependency updates. Jordan verifies CI/CD integrity.
- **Legal:** Victoria scans regulatory monitoring list.
- **Finance:** Nadia produces weekly cost breakdown by provider and agent role.

## Daily
- **Finance:** Nadia flags any day where compute exceeds $6 or MRR changes.
- **SEO:** Lisa pulls Search Console data, flags keyword drops > 5 positions.
- **Social:** Kai monitors engagement, engages with relevant conversations.
- **Operations:** Atlas runs health checks (10-min cron already active).

## Monthly
- **Finance:** Nadia produces unit economics estimate for AI Marketing Department.
- **Legal:** Victoria and Bob review compliance and tax obligations.
- **Research:** Sophia produces monthly industry trends summary.

Sarah reads these during her orchestration sweeps and creates directives + assignments to execute them.`;

(async () => {
  const pool = new Pool({ connectionString: getDatabaseUrl(), connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    console.log('=== PRECHECK: mission rows before ===');
    const before = await client.query(`SELECT id, section, LEFT(content, 200) AS snippet, updated_at FROM company_knowledge_base WHERE section='mission' ORDER BY updated_at NULLS LAST, id`);
    console.table(before.rows);

    await client.query('BEGIN');
    await client.query(`DELETE FROM company_knowledge_base WHERE section IN ('operating_doctrine', 'standing_orders', 'mission')`);

    await client.query(`INSERT INTO company_knowledge_base (section, title, audience, content) VALUES ($1, $2, $3, $4)`, ['mission', 'Mission', 'all', missionContent]);
    await client.query(`INSERT INTO company_knowledge_base (section, title, audience, content) VALUES ($1, $2, $3, $4)`, ['operating_doctrine', 'Operating Doctrine', 'all', operatingDoctrineContent]);
    await client.query(`INSERT INTO company_knowledge_base (section, title, audience, content) VALUES ($1, $2, $3, $4)`, ['standing_orders', 'Standing Orders', 'all', standingOrdersContent]);

    await client.query('COMMIT');

    console.log('=== POSTCHECK: sections ===');
    const sections = await client.query(`SELECT section, title, audience, LENGTH(content) AS chars FROM company_knowledge_base WHERE section IN ('mission','operating_doctrine','current_priorities','products','founders','team_structure','authority_model','metrics','infrastructure','pricing','competitive_landscape','culture','standing_orders') ORDER BY section`);
    console.log('SECTION_ROWS=' + sections.rows.length);
    console.table(sections.rows);

    const mission = await client.query(`SELECT id, section, LEFT(content, 220) AS snippet, updated_at FROM company_knowledge_base WHERE section='mission' ORDER BY updated_at NULLS LAST, id`);
    console.log('MISSION_ROWS=' + mission.rows.length);
    console.table(mission.rows);

    const markers = await client.query(`SELECT section, LEFT(content, 220) AS snippet FROM company_knowledge_base WHERE section IN ('mission','metrics') ORDER BY section`);
    console.table(markers.rows);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error('TRIAGE_FIX_FAILED:', e.message);
  process.exit(1);
});
