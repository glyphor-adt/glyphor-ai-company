/**
 * run-seed.mjs — Execute seed-knowledge.sql via Supabase REST API
 * Usage: node scripts/run-seed.mjs
 *
 * Reads .env for SUPABASE_URL and SUPABASE_SERVICE_KEY,
 * then populates all agent knowledge tables.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ───────────────────────────────────────────────
const envPath = resolve(__dirname, '..', '.env');
const envText = readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envText.split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

async function rest(method, table, opts = {}) {
  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  const h = { ...headers };
  if (opts.prefer) h.Prefer = opts.prefer;
  const res = await fetch(url.toString(), { method, headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${table}: ${res.status} — ${text}`);
  }
  if (opts.returning) return res.json();
  return null;
}

// ── Helper: delete all rows from a table ────────────────────
async function deleteAll(table) {
  await rest('DELETE', table, { query: { id: 'not.is.null' } });
}

// ── Timestamps ──────────────────────────────────────────────
const now = new Date().toISOString();
const plus5d  = new Date(Date.now() + 5  * 86400000).toISOString();
const plus7d  = new Date(Date.now() + 7  * 86400000).toISOString();
const plus10d = new Date(Date.now() + 10 * 86400000).toISOString();
const plus14d = new Date(Date.now() + 14 * 86400000).toISOString();
const plus30d = new Date(Date.now() + 30 * 86400000).toISOString();
const plus60d = new Date(Date.now() + 60 * 86400000).toISOString();
const plus90d = new Date(Date.now() + 90 * 86400000).toISOString();

// ════════════════════════════════════════════════════════════
// 1. COMPANY KNOWLEDGE BASE
// ════════════════════════════════════════════════════════════
const knowledgeRows = [
  { section: 'mission', title: 'Company Mission & Identity', audience: 'all', content: `Glyphor, Inc. is an AI-native product company building production-grade creative and development tools. Delaware C Corporation, incorporated July 21, 2025. Founded by Kristina Denney (CEO) and Andrew Zwelling (Co-founder).

Main domain: glyphor.ai
Products: pulse.glyphor.ai (PRIORITY ONE), fuse.glyphor.ai (PRIORITY TWO), Rêve (FUTURE — not built)
Social: @glyphor.ai on Facebook, LinkedIn, Instagram, TikTok

We build tools that operationalize AI into reliable workflows producing premium results. We are a PRODUCT company shipping consumer and prosumer SaaS. Not a services company, not an agency, not building internal tools for other enterprises.

Non-negotiable standards:
- Production over prototype: outputs must be shippable, not just plausible
- Clarity over cleverness: prefer simple, direct solutions users understand
- Design quality is a requirement: visual polish and UX coherence are not optional
- Guardrails are product features: preventing failure modes is part of the job
- Do not invent facts: if information is unknown, label it unknown` },

  { section: 'current_priorities', title: 'Current Strategic Priorities', audience: 'all', content: `READ THIS FIRST ON EVERY RUN.

PRIORITY ORDER (non-negotiable):
1. PULSE — Launch-ready ASAP. This is the lead product. All marketing, content, pricing, and launch planning centers on Pulse first.
2. FUSE — Secondary. Continue monitoring infrastructure, but do not divert resources from Pulse launch.
3. RÊVE — Future. Domain only. No development, no marketing, no resource allocation.

IMMEDIATE OBJECTIVES (next 30 days):
1. Pulse product audit — Elena, Marcus, and Mia must assess what is working, what needs updating, and what UI needs polish. Deliver recommendations to Kristina.
2. Establish Pulse pricing model — Nadia to model scenarios (this is an OPEN question, not decided)
3. Prepare Product Hunt launch — Maya to build all launch assets
4. Pull real AI model costs via API — Nadia/Omar need actual per-call costs from Google Cloud, Kling, OpenAI, ElevenLabs, Runway dashboards
5. Activate the AI agent workforce — all 27 agents running autonomously

90-DAY OBJECTIVES:
1. Launch Pulse publicly via Product Hunt
2. Acquire first paying customers (content creators and influencers)
3. Reach initial MRR milestone (target TBD based on pricing model)
4. Begin Fuse launch preparation once Pulse is live
5. Establish content marketing cadence for organic growth

WHAT AGENTS SHOULD NOT SPEND TIME ON:
- Enterprise sales outreach (we are B2C/prosumer first with Pulse)
- Fuse marketing or content (until Pulse is launched)
- Rêve anything
- Complex financial modeling beyond Pulse pricing analysis
- Hiring plans or organizational scaling` },

  { section: 'financials', title: 'Financial Reality', audience: 'all', content: `Current state: PRE-REVENUE. $0 MRR. No paying customers.

Monthly burn rate: ~$800/month (infrastructure only)
- GCP (Cloud Run, Pub/Sub, Storage, Billing): ~$187
- Gemini API: ~$412
- Supabase Pro: ~$125
- Vercel Pro: ~$67
- Other (domains, minor tools): ~$10

Funding: Bootstrapped. Both founders contribute $1,000/month each = $2,000/month inflow.
Net position: +$1,200/month surplus after infrastructure costs.
Runway: Effectively indefinite at current burn. No external investors. No debt.

Revenue target: $1,000,000 in the first 12 months after launching the first product (Pulse).

Agent implications:
- Every dollar of infrastructure spend must justify itself
- Revenue modeling should focus on Pulse pricing × volume scenarios
- The $1M target at consumer price points ($15-50/month) means significant user volume needed
- Growth efficiency matters more than speed — no paid acquisition budget initially
- Track costs across THREE separate infrastructure stacks (Pulse, Fuse, Agent Platform)

Financial decisions route to: Both founders (Kristina and Andrew jointly)` },

  { section: 'products_pulse', title: 'Pulse — Full Product Knowledge (PRIORITY ONE)', audience: 'all', content: `WHAT PULSE IS: An AI-powered creative production studio for generating, editing, and launching video and image content. Four-stage workflow: Discover → Create → Refine → Manage.

URL: pulse.glyphor.ai (landing page live)
Status: Production beta. ~80-90% complete. Stripe payments already wired. Mobile support configured (Capacitor iOS/Android). Weeks from launch.

WHAT PULSE CAN DO TODAY:
- Video Generation: Text-to-video and image-to-video via Kling, Sora, Veo, Runway
- Image Generation: AI images via Gemini/Imagen 4
- Storyboarding: Multi-scene planning with AI narrative agents, batch generation, per-scene video
- Video Editing: Multi-track timeline editor (Canva-inspired) with overlays, text, effects, transitions
- Audio Suite: AI sound effects, music generation, TTS, lip-sync (ElevenLabs + Kling)
- Brand Analysis: URL/logo → complete brand kit extraction
- Launch Campaigns: Guided campaign creation from brand assets
- Avatar System: AI avatar video with identity preservation
- Sharing: Public share links with short codes

TECH STACK:
- Frontend: React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui + Framer Motion → Vercel
- Backend: Supabase PostgreSQL + 100+ Edge Functions (Deno/TS) + Auth + Storage
- Supabase Project ID: iyabxcmsncmbtbbdngid
- Storage: 6 Supabase buckets + Cloudflare R2
- Payments: Stripe (checkout, subscriptions, credits, customer portal) — BUILT
- AI: Gemini 3 Pro + Imagen 4, Kling v2.6, Veo 3.1, GPT-5, Sora, ElevenLabs, Runway Gen-3
- Mobile: Capacitor (iOS + Android)

DESIGN SYSTEM — "Precision Dark":
Monochrome blue-cyan on deep black. Cyan (#00E0FF) for borders/text/glows only — NEVER as fills. Azure (#0097FF) secondary, purple (#623CEA) tertiary. IBM Plex Sans body, Orbitron headings. Glassmorphic cards with backdrop blur. Film grain overlay.

SCALE: 100+ edge functions, 80+ hooks, 48 storyboard components, 40 studio components, 30+ pages.

TARGET CUSTOMER: Individual content creators and influencers. B2C/prosumer. NOT enterprise (yet).

PRICING: NOT DECIDED. Nadia must model scenarios. Stripe infrastructure is ready — pricing decisions become live immediately.

LAUNCH: Product Hunt. Maya preparing all assets.

WHAT NEEDS TO HAPPEN BEFORE LAUNCH: Elena, Marcus, and Mia need to audit current state — what works, what needs updating, what UI needs polish. Their recommendations determine launch timeline.` },

  { section: 'products_fuse', title: 'Fuse — Full Product Knowledge (PRIORITY TWO)', audience: 'all', content: `WHAT FUSE IS: An AI development platform that transforms natural language prompts into fully built, deployed React SPAs and Next.js apps. Uses a squad of specialized build agents (NOT the 27 company agents — these are product agents).

URL: fuse.glyphor.ai (landing page live)
Status: Production beta (V8.1). Core pipeline functional. SECONDARY PRIORITY — Pulse launches first.

THREE EXECUTION TIERS:
1. Prototype (Tier 1): Single Gemini Flash agent → preview in <60 seconds. Fast validation.
2. Full Build (Tier 2): Squad pipeline: UX Engineer → Build Verifier → Developer (repair) → Publisher → Deployment Sentinel. 2-5 minutes. Deployed to live URL.
3. Iterate (Tier 3): Targeted changes via GitHub MCP → verify → deploy. 30-90 seconds.

FUSE BUILD AGENTS (product agents, NOT company agents):
- UX Engineer (Gemini 3 Pro): Single-pass full site builder
- Build Verifier: npm build hard gate — nothing ships without passing
- Developer Agent: LLM-based error repair
- Publisher: GitHub commit with integrity checks
- Deployment Sentinel: Vercel deployment + URL extraction
- Iteration Agent: Targeted changes via GitHub MCP

INTELLIGENCE SYSTEMS (already built):
- Persistent Onboarding: Account-level brand profiles improve over builds
- Semantic Plan Cache: 92%+ similar prompts reuse cached successful plans
- Graph Memory: Causal decision chains for planning context
- Critique-Revise: Diagnoses which agent caused errors, routes fixes to responsible agent
- T+1 Evaluation: 48-hour deferred analysis for pattern learning

TECH STACK:
- Frontend: React 18 + Vite + Tailwind + shadcn/ui → Vercel
- Agent Orchestration: GCP Cloud Run
- Metadata + Auth: Supabase (Project ID: mkuswtoicpnhkcwkpjaa)
- Real-time: Firebase Firestore
- Artifacts: GCS bucket
- Edge: Cloudflare Workers (OAuth, preview proxy, SSE gateway)
- Sandbox: Node.js runner (Vite dev server)
- AI: Gemini 3 Pro, Gemini 3 Flash, Gemini 3.1 Pro preview

TERMINOLOGY: NEVER call Fuse "vibe coding" — not internally, not externally. Fuse is a "structured, observable AI development platform" or "autonomous development platform."

CURRENT AGENT ACTIONS: Marcus monitors Fuse infrastructure. Daniel tracks competitors. All others focus on Pulse.` },

  { section: 'products_reve', title: 'Rêve — Future Product (NOT ACTIVE)', audience: 'all', content: `AI-powered virtual try-on fashion app. Target: women 18-50, creators, influencers.
Status: Domain only. No development. FUTURE product.
Agent directive: Do not plan for, market, research, or reference Rêve externally. Zero resource allocation.` },

  { section: 'infrastructure_map', title: 'Infrastructure Map — Three Separate Systems', audience: 'all', content: `Glyphor operates THREE distinct infrastructure stacks. Know which is which.

1. PULSE (pulse.glyphor.ai) — PRIORITY ONE
   Frontend: Vercel
   Backend: Supabase Edge Functions + PostgreSQL (Project: iyabxcmsncmbtbbdngid)
   Storage: Supabase Storage (6 buckets) + Cloudflare R2
   Payments: Stripe
   AI APIs: Google (Gemini/Imagen), Kling, Veo, Sora, OpenAI, ElevenLabs, Runway
   Secrets: 34 configured in Supabase Dashboard

2. FUSE (fuse.glyphor.ai) — PRIORITY TWO
   Frontend: Vercel
   Agent Orchestration: GCP Cloud Run
   Metadata + Auth: Supabase (Project: mkuswtoicpnhkcwkpjaa)
   Real-time: Firebase Firestore
   Artifacts: GCS bucket
   Edge: Cloudflare Workers
   Sandbox: Node.js runner
   AI APIs: Gemini 3 Pro, Gemini Flash, Gemini 3.1 Pro

3. AGENT COMPANY PLATFORM — INTERNAL
   Execution: GCP Cloud Run (glyphor-scheduler)
   Dashboard: GCP Cloud Run (glyphor-dashboard)
   Scheduler: Cloud Scheduler → Pub/Sub → Cloud Run
   Database: Supabase (separate project)
   AI: Gemini API
   Messaging: Microsoft Teams (Graph API + Bot Framework)
   Region: us-central1

CRITICAL: These are separate systems. A Pulse outage ≠ a Fuse outage ≠ an agent platform outage. Monitor, cost-track, and incident-manage each independently.` },

  { section: 'ai_models', title: 'AI Model Portfolio', audience: 'all', content: `Multi-provider AI strategy across products. NOT locked to one vendor.

PULSE MODELS:
- Gemini 3 Pro (Google): Scene planning, narrative, scripts, analysis
- Imagen 4 (Google): Image generation
- Kling v2.6: Video generation, lip-sync, motion, avatars
- Veo 3.1 (Google): Storyboard video rendering
- GPT-5 (OpenAI): Brand analysis, prototype planning
- Sora (OpenAI): Video generation
- ElevenLabs: Sound effects, music, TTS
- Runway Gen-3: Video generation

FUSE MODELS:
- Gemini 3 Pro: UX Engineer (full site builds)
- Gemini 3 Flash: Prototyping, iteration
- Gemini 3.1 Pro preview: Latest model

AGENT PLATFORM:
- Gemini (various): All 27 company agents

COST NOTE: Exact per-call costs need to be pulled from provider APIs/dashboards. Video generation ($0.10-0.50/call) is 10-50x more expensive than text ($0.01). Pricing models MUST account for model mix. Nadia/Omar: pull actual costs as a first task.` },

  { section: 'team_structure', title: 'Company Structure', audience: 'all', content: `Two human founders + 27 AI agents. No human employees, contractors, or advisors.

Kristina Denney (CEO): Product vision, platform architecture, engineering execution, quality standards, ALL technical and product decisions. Built the entire technology platform end-to-end. Source of truth for product/tech.
Andrew Zwelling (Co-founder): GTM execution, partnerships, operations, business readiness. Focus on scaling with discipline.

AI Agent Team: 8 executives + 18 specialists + 1 ops agent (Atlas) = 27 total. This IS the workforce.

Decision routing:
- Product, engineering, architecture, quality → Kristina
- GTM, partnerships, operations → Andrew
- Financial decisions → Both founders jointly
- Strategic direction → Both founders jointly

Founder availability: Both work full-time jobs in addition to Glyphor. Kristina is at Microsoft. Agents should be maximally autonomous within their authority. Do not request founder input for clear Green-tier decisions.` },

  { section: 'go_to_market', title: 'Go-to-Market Strategy', audience: 'all', content: `Phase 1 (NOW → Pulse Launch):
- Complete Pulse product audit (Elena, Marcus, Mia)
- Model pricing (Nadia)
- Prepare Product Hunt launch assets (Maya team)
- Build pre-launch content for social (@glyphor.ai on FB, LinkedIn, Instagram, TikTok)
- Organic growth only — zero paid acquisition budget

Phase 2 (Post-Pulse Launch → 3 months):
- Product Hunt launch execution
- Drive signups and conversions from PH traffic
- Content marketing engine (SEO, social, community)
- User feedback collection and iteration
- Begin Fuse launch prep

Phase 3 (Months 3-6):
- Launch Fuse
- Expand Pulse customer base
- Evaluate enterprise/agency segments

Target customer (Pulse): Individual content creators and influencers
Launch channel: Product Hunt
Growth model: Organic (content, social, SEO, community, creator partnerships)

Social presence: @glyphor.ai on Facebook, LinkedIn, Instagram, TikTok. Maya has access to Meta Business Platform.` },

  { section: 'culture', title: 'Culture, Communication & Brand Voice', audience: 'all', content: `HOW WE WORK:
- Direct communication. No corporate jargon.
- Metrics-backed arguments. Show data, not opinions.
- Speed over perfection. Ship, learn, iterate.
- Production quality is the floor. "Good enough" is not good enough.
- Challenge ideas constructively.

BRAND VOICE (all external content):
- Confident but not arrogant
- Technical but accessible — a smart friend, not a textbook
- Premium without pretension
- Direct. No filler.

ALWAYS AVOID: "revolutionize," "disrupt," "game-changing," "vibe coding," "just a wrapper," "leverage," "synergize"
NEVER: Invent facts, claim unbuilt capabilities, attribute decisions to anyone other than Kristina without verification

GOOD: "Pulse takes you from idea to share-ready video in under a minute."
BAD: "Pulse is a revolutionary AI platform disrupting the creative industry."
GOOD: "Fuse replaces your development process — strategy, design, build, verify, deploy."
BAD: "Fuse leverages cutting-edge AI to optimize development workflows."` },

  { section: 'competitive_landscape', title: 'Competitive Landscape', audience: 'all', content: `PULSE COMPETITORS (know these cold):

Midjourney ($10-30/mo): Best image generation. Discord-only (high friction). No editing, video, audio, storyboards, brand tools, or campaigns. OUR EDGE: Full production studio vs single-feature generator.

Canva ($13/mo Pro): Excellent templates and workflows. AI generation is secondary add-on. OUR EDGE: AI-native. Generation + editing + production unified. More powerful models.

Runway ($12-76/mo): Leading video generation. Video-only. OUR EDGE: Video + image + audio + editing + storyboards + brand tools. Complete studio vs video generator.

Adobe Firefly ($10-55/mo): Enterprise, trusted. Complex, slow, expensive. OUR EDGE: Faster, simpler, built for individual creators. No learning curve.

Leonardo AI ($12-48/mo): Good generation, model variety. Weak workflows. OUR EDGE: Full pipeline, not just generation.

FUSE COMPETITORS (secondary):

Devin (~$500/mo): Single agent, black box. OUR EDGE: Transparent squad pipeline. See every decision, every file, every build result. Three tiers (60s prototype → 5min build → 90s iterate).

Cursor (~$20/mo): Developer copilot, not replacement. Different category. OUR EDGE: No coding knowledge required.

Bolt / Lovable: Quick builders, prototype quality. OUR EDGE: Production quality + learning system + persistent intelligence.

RULES: Lead with what we do, not what competitors lack. Be factual. Respect competitors publicly. Microsoft-sensitive: Kristina works at Microsoft. Never disparage Microsoft products. Neutral references only.` },

  { section: 'founder_background', title: 'Founder Background (for content and credibility)', audience: 'all', content: `KRISTINA DENNEY:
- Senior Cloud & AI Platform Specialist at Microsoft (current)
- 20+ years enterprise technology experience
- Platinum Club — top 1% of 70,000+ sellers at Microsoft
- Influenced over $157M in technology investments
- Built Glyphor entire technology platform end-to-end (Pulse, Fuse, agent platform)
- AI transformation specialist across Fortune 500 (HP, Textron Aviation, NI/Emerson, Eaton)
- Based in Dallas, TX

USE HER BACKGROUND FOR: Enterprise credibility, thought leadership, personal brand content
DO NOT: Reference specific Microsoft deals/internal data. Do not imply Microsoft endorsement of Glyphor.

ANDREW ZWELLING:
- Co-founder, GTM + partnerships + operations
- Microsoft experience + broad cloud ecosystem exposure (AWS, GCP)
DO NOT: Attribute technical/architectural decisions to Andrew unless instructed.` },

  { section: 'pricing_analysis_brief', title: 'Pricing Analysis Brief (for Nadia)', audience: 'finance', content: `THIS IS AN OPEN QUESTION. Model scenarios, do not assume a price.

Context:
- Target: $1M revenue in 12 months post-launch
- Product: Pulse (creative production studio)
- Customer: Individual content creators and influencers
- Launch: Product Hunt
- Growth: Organic only — no paid acquisition
- Competitors: $7/mo (Ideogram basic) to $76/mo (Runway unlimited)
- Payment infrastructure: Stripe already built (checkout, subscriptions, credits, portal)

FIRST TASK: Pull actual AI model costs via provider APIs. Video generation (Kling, Veo, Sora, Runway) is the most expensive. Unit economics depend on model mix per workflow.

Scenarios to model:
1. Freemium: Free (limited gen) + Pro $19/mo + Studio $39/mo
2. Paid-only: 7-day trial → $29/mo flat with generous caps
3. Tiered: Creator $15/mo (100 gen) → Pro $35/mo (500 gen) → Studio $69/mo (unlimited)

For each: required user count for $1M, conversion rates (2-5% free→paid typical), churn (5-10% monthly for creator tools), break-even, infra cost per user.

Deliver: One-page pricing recommendation with 3 scenarios, recommended option, rationale.` },

  { section: 'product_hunt_brief', title: 'Product Hunt Launch Brief (for Maya)', audience: 'marketing', content: `Primary go-to-market event for Pulse. Must be excellent.

PREPARE:
1. Product Hunt page: tagline (≤60 chars), description, 5-6 screenshots/GIFs, maker story
2. Launch day social: Twitter/X, LinkedIn, Instagram, TikTok (all @glyphor.ai). Posts from Glyphor + Kristina personal
3. Demo video: 60-90 second workflow walkthrough
4. Blog post: "Introducing Pulse" — published launch day on glyphor.ai
5. Community engagement plan: relevant subreddits, Discord servers, creator communities

SOCIAL ACCESS: Maya has Meta Business Platform access. Accounts: @glyphor.ai on Facebook, LinkedIn, Instagram, TikTok.

BEST PRACTICES:
- Launch Tuesday-Thursday for best visibility
- First hour matters most — rally early supporters
- Respond to every comment (Kristina and Andrew personally)
- Have a "first 100 users" incentive ready

TAGLINE SHOULD CONVEY: AI-powered full creative studio. Idea to share-ready content. For creators, not engineers. Premium quality.

DELIVERABLES FROM MAYA: 5 tagline options, content calendar for launch week, community plan. Tyler drafts blog post. Lisa identifies SEO keywords. Kai prepares social posts across all 4 platforms.` },
];

// ════════════════════════════════════════════════════════════
// 2. FOUNDER BULLETINS
// ════════════════════════════════════════════════════════════
const bulletinRows = [
  { created_by: 'kristina', priority: 'urgent', audience: 'all', expires_at: null,
    content: 'COMPANY PRIORITY: Pulse launches first. ALL marketing, content, pricing, and launch planning centers on Pulse. Fuse is secondary. Rêve does not exist yet. If your current task does not serve the Pulse launch, re-evaluate whether it should wait.' },
  { created_by: 'kristina', priority: 'important', audience: 'sales', expires_at: plus90d,
    content: 'GO-TO-MARKET SHIFT: We are B2C/prosumer, not enterprise. Pulse targets individual content creators and influencers via Product Hunt launch. Do NOT pursue enterprise outreach. Focus on creator communities, Product Hunt strategy, social content (@glyphor.ai on FB, LinkedIn, Instagram, TikTok), and organic growth.' },
  { created_by: 'kristina', priority: 'important', audience: 'finance', expires_at: plus60d,
    content: 'PRICING IS OPEN: We have NOT decided Pulse pricing. Do not assume any price point. First task: pull actual AI model costs from provider APIs (Google Cloud Billing API, Kling dashboard, OpenAI usage API, ElevenLabs, Runway). Then model 3 pricing scenarios. See the Pricing Analysis Brief in the knowledge base.' },
  { created_by: 'kristina', priority: 'important', audience: 'all', expires_at: plus30d,
    content: 'PULSE AUDIT NEEDED: Pulse is ~80-90% built but needs a thorough audit before we commit to a launch date. Elena (product), Marcus (engineering), and Mia (design) must assess: what is working, what needs updating, what UI needs polish. Deliver your recommendations to me. This determines our launch timeline.' },
  { created_by: 'kristina', priority: 'important', audience: 'engineering', expires_at: plus30d,
    content: 'INFRASTRUCTURE NOTE: We run THREE separate systems — Pulse (Supabase + Vercel), Fuse (GCP Cloud Run + Supabase + Firebase), and the Agent Platform (GCP Cloud Run + Supabase + Pub/Sub). These are different databases, different hosting, different AI providers. Monitor and cost-track each independently. Supabase project IDs — Pulse: iyabxcmsncmbtbbdngid, Fuse: mkuswtoicpnhkcwkpjaa.' },
  { created_by: 'kristina', priority: 'normal', audience: 'marketing', expires_at: plus60d,
    content: 'SOCIAL MEDIA: All accounts are @glyphor.ai on Facebook, LinkedIn, Instagram, and TikTok. Maya has Meta Business Platform access. All pre-launch content should build toward the Product Hunt launch. Start building audience NOW.' },
];

// ════════════════════════════════════════════════════════════
// 3. COMPANY PULSE
// ════════════════════════════════════════════════════════════
const companyPulseRow = {
  id: 'current',
  mrr: 0,
  active_users: 2,
  platform_status: 'degraded',
  company_mood: 'building',
  highlights: [
    'Pulse ~80-90% built, targeting Product Hunt launch (PRIORITY ONE)',
    'Fuse ~80% built (PRIORITY TWO, launches after Pulse)',
    'Pulse audit needed — Elena, Marcus, Mia to assess launch readiness',
    'Pricing not decided — Nadia modeling scenarios',
    'Agent platform deployed on GCP, activation in progress',
    '27 AI agents configured, first runs imminent',
    'Bootstrapped: $2K/mo in, $800/mo burn, net +$1,200/mo',
    'Social accounts live: @glyphor.ai on FB, LinkedIn, Instagram, TikTok',
    'Revenue target: $1M first year post-launch',
  ],
  updated_at: now,
};

// ════════════════════════════════════════════════════════════
// 4. KNOWLEDGE GRAPH NODES
// ════════════════════════════════════════════════════════════
const kgNodes = [
  { node_type:'product', title:'Pulse', department:'product', importance:1.0, tags:['pulse','product','priority-one','creative','launch','B2C'], created_by:'system', status:'active',
    content:'Glyphor creative production studio. PRIORITY ONE. AI-powered image generation (Imagen 4), video generation (Kling, Veo, Sora, Runway), multi-track video editing, storyboarding with AI narrative agents, audio suite (ElevenLabs), brand analysis, campaign launcher, avatar system. 100+ edge functions, 80+ hooks. Deployed at pulse.glyphor.ai on Supabase + Vercel. Stripe payments built. ~80-90% complete, needs audit before Product Hunt launch.' },
  { node_type:'product', title:'Fuse', department:'product', importance:0.8, tags:['fuse','product','priority-two','development','agents'], created_by:'system', status:'active',
    content:'Glyphor AI development platform. PRIORITY TWO. Transforms prompts into deployed React/Next.js apps via squad of build agents (UX Engineer, Build Verifier, Developer, Publisher, Deployment Sentinel). Three tiers: Prototype (<60s), Full Build (2-5min), Iterate (30-90s). Persistent intelligence with plan caching, graph memory, critique-revise loops. Deployed at fuse.glyphor.ai on GCP Cloud Run + Supabase + Firebase. NEVER call it "vibe coding."' },
  { node_type:'product', title:'Reve', department:'product', importance:0.2, tags:['reve','future','inactive'], created_by:'system', status:'active',
    content:'AI-powered virtual try-on fashion app. FUTURE — domain only, no development. Zero resource allocation.' },
  { node_type:'concept', title:'Target Customer - Pulse', department:'marketing', importance:0.9, tags:['market','pulse','creators','B2C','ICP'], created_by:'system', status:'active',
    content:'Individual content creators and influencers who need consistent, professional visual and video content. B2C/prosumer model. Currently use Midjourney ($10-30/mo), Canva ($13/mo), Runway ($12-76/mo), or combinations. Pain: too many tools, inconsistent results, no end-to-end workflow. Pulse is the single-platform solution.' },
  { node_type:'concept', title:'Product Hunt Launch', department:'marketing', importance:1.0, tags:['launch','product-hunt','GTM','pulse'], created_by:'system', status:'active',
    content:'Primary GTM event for Pulse. Requirements: polished product, PH page (tagline ≤60 chars, screenshots, demo video, maker story), launch day social across @glyphor.ai (FB, LinkedIn, Instagram, TikTok), community engagement, first-100-users incentive. Best on Tuesday-Thursday. First hour critical for ranking.' },
  { node_type:'metric', title:'Revenue Target', department:'finance', importance:0.9, tags:['revenue','target','pricing'], created_by:'system', status:'active',
    content:'$1M revenue in first 12 months post-launch. At $15-50/month consumer pricing, requires 1,700-5,500+ paying users. Bootstrapped organic growth only — no paid acquisition.' },
  { node_type:'metric', title:'Monthly Burn', department:'finance', importance:0.8, tags:['burn','cost','budget'], created_by:'system', status:'active',
    content:'~$800/mo infrastructure. GCP $187, Gemini API $412, Supabase $125, Vercel $67. Offset by $2K/mo founder contributions. Net +$1,200/mo surplus.' },
  { node_type:'concept', title:'Three Infrastructure Stacks', department:'engineering', importance:0.9, tags:['infrastructure','architecture','monitoring'], created_by:'system', status:'active',
    content:'Glyphor runs three separate systems: (1) Pulse on Supabase + Vercel + R2, (2) Fuse on GCP Cloud Run + Supabase + Firebase + GCS + Cloudflare Workers, (3) Agent Platform on GCP Cloud Run + Supabase + Pub/Sub. Different databases, hosting, AI providers. Must monitor, cost-track, incident-manage independently.' },
  { node_type:'concept', title:'Midjourney', department:'marketing', importance:0.7, tags:['competitor','midjourney','pulse'], created_by:'system', status:'active',
    content:'Primary Pulse competitor. Best image generation quality. Discord-only (friction). No editing/video/audio/storyboards/campaigns. $10-30/mo. Our edge: full production studio vs single generator.' },
  { node_type:'concept', title:'Canva', department:'marketing', importance:0.7, tags:['competitor','canva','pulse'], created_by:'system', status:'active',
    content:'Indirect Pulse competitor. Excellent templates. AI is secondary add-on. $13/mo. Our edge: AI-native, generation is core, more powerful models, unified workflow.' },
  { node_type:'concept', title:'Runway', department:'marketing', importance:0.7, tags:['competitor','runway','pulse'], created_by:'system', status:'active',
    content:'Video-focused Pulse competitor. Gen-3 model. $12-76/mo. Our edge: video + image + audio + editing + storyboards + brand tools. Complete vs video-only.' },
  { node_type:'concept', title:'Devin', department:'product', importance:0.6, tags:['competitor','devin','fuse'], created_by:'system', status:'active',
    content:'Primary Fuse competitor. Single AI agent, black box, ~$500/mo. Our edge: transparent squad pipeline, three execution tiers, persistent learning, observable.' },
  { node_type:'concept', title:'Social Media Presence', department:'marketing', importance:0.8, tags:['social','marketing','channels'], created_by:'system', status:'active',
    content:'All accounts: @glyphor.ai on Facebook, LinkedIn, Instagram, TikTok. Maya has Meta Business Platform access. Pre-launch content should build audience toward Product Hunt launch.' },
  { node_type:'risk', title:'Telemetry Blackout', department:'engineering', importance:0.9, tags:['incident','telemetry','p0'], created_by:'system', status:'active',
    content:'Agent platform reporting $0 costs, 0% build success, Teams HTTP 400. Likely Pub/Sub OIDC token issue (fix identified). P0 for Marcus on agent platform.' },
  { node_type:'risk', title:'Crowded Market Launch', department:'operations', importance:0.8, tags:['risk','launch','competition'], created_by:'system', status:'active',
    content:'Pulse launching into competitive creative AI space. Differentiation is workflow + full production pipeline, not raw generation quality. Product Hunt is one-shot — must be polished. No paid acquisition fallback.' },
  { node_type:'opportunity', title:'Creator Economy Distribution', department:'marketing', importance:0.8, tags:['growth','creators','viral','distribution'], created_by:'system', status:'active',
    content:'Creators share tools with audiences. One influential creator using Pulse visibly could drive thousands of signups. Maya: identify creator partnerships. Kai: social content showing Pulse outputs.' },
  { node_type:'opportunity', title:'Eaton Corporation (Context)', department:'sales', importance:0.3, tags:['eaton','context','future','microsoft'], created_by:'system', status:'active',
    content:'Fortune 500 manufacturer. Active AI transformation. Met Feb 20, 2026. CONTEXT ONLY — Microsoft customer engagement, not a Glyphor prospect currently. May become relevant for Fuse enterprise positioning in future.' },
];

// ════════════════════════════════════════════════════════════
// 5. KNOWLEDGE GRAPH EDGES (inserted after nodes)
// ════════════════════════════════════════════════════════════
const edgeDefs = [
  { sourceTitle: 'Pulse', targetTitle: 'Revenue Target', edge_type: 'enables', strength: 1.0, confidence: 1.0, evidence: 'Pulse is the lead product driving first revenue' },
  { sourceTitle: 'Product Hunt Launch', targetTitle: 'Pulse', edge_type: 'depends_on', strength: 1.0, confidence: 1.0, evidence: 'Product Hunt is the launch channel for Pulse' },
  { sourceTitle: 'Crowded Market Launch', targetTitle: 'Revenue Target', edge_type: 'blocks', strength: 0.8, confidence: 0.9, evidence: 'Crowded market increases need for differentiated positioning' },
];

// ════════════════════════════════════════════════════════════
// 6. FOUNDER DIRECTIVES
// ════════════════════════════════════════════════════════════
const directiveRows = [
  { title: 'Pulse Launch Readiness Audit', priority: 'critical', category: 'product', target_agents: ['cpo','cto','vp-design'], status: 'active', due_date: plus7d,
    description: 'Elena, Marcus, and Mia must assess Pulse (pulse.glyphor.ai) current state. Connect to Supabase project iyabxcmsncmbtbbdngid. For each feature/workflow: (1) Does it work correctly? (2) Does it need updating? (3) Does the UI need polish? Deliver a prioritized recommendation: what must be fixed before launch, what can ship as-is, what can wait for v2. This determines our launch timeline.' },
  { title: 'Pulse Pricing Model', priority: 'high', category: 'revenue', target_agents: ['cfo'], status: 'active', due_date: plus10d,
    description: 'Nadia: Model 3 pricing scenarios for Pulse. FIRST pull actual AI model costs from provider APIs (Google Cloud Billing API, Kling billing, OpenAI usage API, ElevenLabs, Runway). Then model: (1) Freemium with Pro $19/mo + Studio $39/mo, (2) Paid-only $29/mo with trial, (3) Tiered $15/$35/$69. For each: required users for $1M/year, conversion rates, churn, break-even, cost per user. Deliver one-page recommendation.' },
  { title: 'Product Hunt Launch Preparation', priority: 'high', category: 'marketing', target_agents: ['cmo'], status: 'active', due_date: plus14d,
    description: 'Maya: Prepare complete Product Hunt launch package for Pulse. Deliverables: (1) 5 tagline options, (2) PH page description, (3) 5-6 screenshots/GIFs, (4) maker story draft, (5) launch day social posts for @glyphor.ai on FB/LinkedIn/Instagram/TikTok, (6) community engagement plan, (7) content calendar for launch week. Tyler drafts "Introducing Pulse" blog post. Lisa researches SEO keywords. Kai prepares social content.' },
  { title: 'AI Model Cost Analysis', priority: 'high', category: 'operations', target_agents: ['cfo','cost-analyst'], status: 'active', due_date: plus5d,
    description: 'Omar and Nadia: Pull actual per-call costs from ALL AI provider APIs across all three infrastructure stacks. Google Cloud Billing API (Gemini, Imagen, Veo — for both Pulse and Fuse), Kling dashboard/API, OpenAI usage API (GPT-5, Sora), ElevenLabs usage, Runway usage. Categorize by: product (Pulse/Fuse/Agent Platform), model, cost per call, monthly total. This feeds directly into pricing analysis.' },
  { title: 'Competitive Pricing Intelligence', priority: 'high', category: 'product', target_agents: ['competitive-intel'], status: 'active', due_date: plus7d,
    description: 'Daniel: Research current pricing for all Pulse competitors. Midjourney, Canva, Runway, Adobe Firefly, Leonardo, Ideogram, DALL-E/ChatGPT Plus. For each: tier names, prices, what is included (generation limits, features, storage), free tier details. Compile into comparison matrix. This feeds Maya content and Nadia pricing model.' },
];

// ════════════════════════════════════════════════════════════
// EXECUTE
// ════════════════════════════════════════════════════════════
async function run() {
  console.log('🔌 Connecting to Supabase…');

  // 1. Knowledge base
  console.log('  ✂  Clearing company_knowledge_base…');
  await rest('DELETE', 'company_knowledge_base', { query: { section: 'not.is.null' } });
  console.log('  📥 Inserting 14 knowledge sections…');
  await rest('POST', 'company_knowledge_base', { body: knowledgeRows });
  console.log('  ✅ company_knowledge_base done');

  // 2. Founder bulletins
  console.log('  ✂  Clearing founder_bulletins…');
  await rest('DELETE', 'founder_bulletins', { query: { id: 'not.is.null' } });
  console.log('  📥 Inserting 6 bulletins…');
  await rest('POST', 'founder_bulletins', { body: bulletinRows });
  console.log('  ✅ founder_bulletins done');

  // 3. Company pulse (upsert)
  console.log('  📥 Upserting company_pulse…');
  await rest('POST', 'company_pulse', { body: companyPulseRow, prefer: 'resolution=merge-duplicates,return=minimal' });
  console.log('  ✅ company_pulse done');

  // 4. Knowledge graph nodes
  console.log('  ✂  Clearing kg_nodes (system-created)…');
  await rest('DELETE', 'kg_nodes', { query: { created_by: 'eq.system' } });
  console.log('  📥 Inserting 17 kg_nodes…');
  await rest('POST', 'kg_nodes', { body: kgNodes, prefer: 'return=representation', returning: true })
    .then(nodes => {
      // Build title→id map for edges
      const nodeMap = {};
      for (const n of nodes) nodeMap[n.title] = n.id;

      // 5. Knowledge graph edges
      console.log('  ✂  Clearing kg_edges (system-created)…');
      return rest('DELETE', 'kg_edges', { query: { created_by: 'eq.system' } }).then(() => {
        const edges = edgeDefs
          .filter(e => nodeMap[e.sourceTitle] && nodeMap[e.targetTitle])
          .map(e => ({
            source_id: nodeMap[e.sourceTitle],
            target_id: nodeMap[e.targetTitle],
            edge_type: e.edge_type,
            strength: e.strength,
            confidence: e.confidence,
            evidence: e.evidence,
            created_by: 'system',
          }));
        console.log(`  📥 Inserting ${edges.length} kg_edges…`);
        return rest('POST', 'kg_edges', { body: edges });
      });
    });
  console.log('  ✅ kg_nodes + kg_edges done');

  // 6. Founder directives
  console.log('  ✂  Clearing founder_directives…');
  await rest('DELETE', 'founder_directives', { query: { id: 'not.is.null' } });
  console.log('  📥 Inserting 5 directives…');
  await rest('POST', 'founder_directives', { body: directiveRows });
  console.log('  ✅ founder_directives done');

  console.log('\n🎉 All knowledge seeded successfully!');
}

run().catch(err => { console.error('❌ Seed failed:', err.message); process.exit(1); });
