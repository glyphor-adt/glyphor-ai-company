# Autonomous Company Implementation Plan

> Goal: Make the 44-agent system self-directing. Agents read the operating doctrine, derive their own work, coordinate cross-functionally, and produce real deliverables — without founders specifying what to do.

---

## Phase 1: Strategic Planning Loop

**Problem:** Agents only work when founders create directives. No mechanism to read the doctrine and self-generate work.

### 1.1 — New Table: `initiatives`

Location: new migration file

```sql
CREATE TABLE initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  doctrine_alignment TEXT NOT NULL,       -- which doctrine principle this serves
  owner_role TEXT NOT NULL,               -- exec agent responsible (e.g. 'cmo', 'cto')
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | approved | active | completed | rejected
  priority TEXT NOT NULL DEFAULT 'medium', -- critical | high | medium | low
  dependencies UUID[] DEFAULT '{}',       -- other initiative IDs that must complete first
  target_date TIMESTAMPTZ,
  success_criteria TEXT[],                -- measurable outcomes
  created_by TEXT NOT NULL,               -- 'chief-of-staff' or founder name
  approved_by TEXT,                       -- founder who approved
  approved_at TIMESTAMPTZ,
  progress_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  company_id UUID NOT NULL REFERENCES companies(id)
);

CREATE INDEX idx_initiatives_status ON initiatives(company_id, status);
CREATE INDEX idx_initiatives_owner ON initiatives(company_id, owner_role);
```

### 1.2 — Link Directives to Initiatives

```sql
ALTER TABLE founder_directives
  ADD COLUMN initiative_id UUID REFERENCES initiatives(id),
  ADD COLUMN source TEXT DEFAULT 'founder'; -- founder | agent_proposed | initiative_derived
```

### 1.3 — New Table: `deliverables`

Shared artifacts that one team produces and another consumes.

```sql
CREATE TABLE deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID REFERENCES initiatives(id),
  directive_id UUID REFERENCES founder_directives(id),
  assignment_id UUID REFERENCES work_assignments(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL,            -- document | design_asset | code | dataset | strategy | campaign
  content TEXT,                  -- the actual output or a reference/URL
  storage_url TEXT,              -- GCS or SharePoint URL if stored externally
  producing_agent TEXT NOT NULL,
  status TEXT DEFAULT 'draft',   -- draft | published | superseded
  metadata JSONB DEFAULT '{}',  -- flexible: {format, page_count, word_count, etc.}
  consumed_by TEXT[],            -- agent roles that have read this
  created_at TIMESTAMPTZ DEFAULT NOW(),
  company_id UUID NOT NULL REFERENCES companies(id)
);

CREATE INDEX idx_deliverables_initiative ON deliverables(initiative_id);
CREATE INDEX idx_deliverables_type ON deliverables(company_id, type, status);
```

### 1.4 — New Sarah Task: `strategic_planning`

Add to Sarah's cron schedule — runs weekly (Sunday evening) or on-demand.

**New cron entry** in `layer03-executives.ts`:

```typescript
{
  agentRole: 'chief-of-staff',
  task: 'strategic_planning',
  schedule: '0 22 * * 0', // Sunday 10 PM UTC (4 PM CT)
  description: 'Weekly strategic planning cycle'
}
```

**Planning prompt** — add to Sarah's runner or as a new task handler in `chief-of-staff/run.ts`:

```
STRATEGIC PLANNING CYCLE

You are conducting the weekly strategic planning review.

INPUTS:
1. The Strategic Operating Doctrine (from company_knowledge where category='doctrine')
2. Current active initiatives and their status
3. Current active directives and completion rates
4. Company pulse data (revenue, costs, product status)
5. Recent deliverables produced

YOUR TASK:
1. ASSESS: What has the company accomplished this week toward doctrine goals?
2. IDENTIFY GAPS: What does the doctrine require that no initiative currently addresses?
3. PROPOSE INITIATIVES: For each gap, propose an initiative with:
   - Title, description, doctrine alignment
   - Owner (which exec agent)
   - Dependencies on other initiatives
   - Success criteria (measurable)
   - Estimated timeline
   - Initial directive breakdown (2-5 directives per initiative)
4. SEQUENCE: Order initiatives by dependency chain and doctrine priority.
   Revenue-generating work > product infrastructure > internal tooling.
5. SUBMIT: Use propose_initiative for each. Founders will approve/reject/edit.

DOCTRINE PRIORITY ORDER:
- Anything blocking the AI Marketing Department launch
- Anything blocking Slack-native delivery
- Brand/content infrastructure needed for marketing output
- Internal tooling that enables agent productivity

CONSTRAINT: Never propose more than 5 new initiatives per cycle.
Do not propose initiatives that duplicate active ones.
```

### 1.5 — New Tools for Sarah

Add to `packages/agents/src/chief-of-staff/tools.ts` (or extend `coreTools.ts`):

```typescript
// propose_initiative — Sarah proposes, founders approve via Teams
{
  name: 'propose_initiative',
  description: 'Propose a strategic initiative derived from the operating doctrine.',
  parameters: {
    title: { type: 'string' },
    description: { type: 'string' },
    doctrine_alignment: { type: 'string' },
    owner_role: { type: 'string' },
    dependencies: { type: 'array', items: { type: 'string' } }, // initiative IDs
    success_criteria: { type: 'array', items: { type: 'string' } },
    target_date: { type: 'string' }, // ISO date
    initial_directives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          target_agents: { type: 'array', items: { type: 'string' } },
          depends_on_directive: { type: 'number' } // index in this array
        }
      }
    }
  }
}

// activate_initiative — after founder approval, creates the directives
{
  name: 'activate_initiative',
  description: 'Activate an approved initiative, creating its planned directives.',
  parameters: {
    initiative_id: { type: 'string' }
  }
}

// read_initiatives — check current initiative landscape
{
  name: 'read_initiatives',
  description: 'Read all initiatives with status summary.',
  parameters: {
    status_filter: { type: 'string' } // optional: proposed | approved | active | completed
  }
}

// publish_deliverable — agents store shared artifacts
// (add to coreTools so all agents can use it)
{
  name: 'publish_deliverable',
  description: 'Publish a deliverable for cross-team consumption.',
  parameters: {
    title: { type: 'string' },
    type: { type: 'string' }, // document | design_asset | code | campaign | strategy
    content: { type: 'string' },
    storage_url: { type: 'string' }, // optional: SharePoint/GCS URL
    initiative_id: { type: 'string' },
    directive_id: { type: 'string' }
  }
}

// get_deliverables — agents consume artifacts from other teams
// (add to coreTools so all agents can use it)
{
  name: 'get_deliverables',
  description: 'Retrieve deliverables by initiative, type, or producing agent.',
  parameters: {
    initiative_id: { type: 'string' }, // optional
    type: { type: 'string' },          // optional
    producing_agent: { type: 'string' } // optional
  }
}
```

### 1.6 — Founder Approval Flow via Teams

When Sarah calls `propose_initiative`, the handler should:

1. INSERT into `initiatives` with status `proposed`
2. Send an Adaptive Card to the founders' Teams channel with:
   - Initiative title, description, doctrine alignment
   - Proposed directives list
   - Approve / Reject / Edit buttons
3. On button click → POST back to scheduler → update status
4. If approved → Sarah wakes to run `activate_initiative` → creates directives

Pattern already exists in the decision queue (`create_decision` → Teams card → `resolve`). Reuse that flow with `decision_type: 'initiative_approval'`.

### 1.7 — Ingest Operating Doctrine

The doctrine needs to be in a place agents can read it programmatically.

```sql
INSERT INTO company_knowledge (
  category, title, content, priority, source
) VALUES (
  'doctrine',
  'Glyphor Strategic Operating Doctrine',
  '<full text of the DOCX>',
  'critical',
  'founder'
);
```

Or upload to SharePoint and ensure the `sync-sharepoint-knowledge` job ingests it into `company_knowledge`. Either way, Sarah's planning prompt should query: `SELECT content FROM company_knowledge WHERE category = 'doctrine'`.

---

## Phase 2: Production Tool Gaps

**Problem:** Agents can analyze and draft, but can't create real artifacts in real locations (SharePoint pages, published social content, Slack interfaces).

### 2.1 — Wire SharePoint Write Access to Design + Marketing Agents

Currently most agents filter Agent 365 to `['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']`.

**Files to modify** — each agent's runner where `createAgent365McpTools` is called:

```
packages/agents/src/vp-design/run.ts
packages/agents/src/ui-ux-designer/run.ts
packages/agents/src/template-architect/run.ts
packages/agents/src/cmo/run.ts
packages/agents/src/content-creator/run.ts
```

Change the server filter to include SharePoint and Word:

```typescript
const agent365Tools = await createAgent365McpTools([
  'mcp_CalendarTools',
  'mcp_TeamsServer',
  'mcp_M365Copilot',
  'mcp_ODSPRemoteServer',  // ← ADD: SharePoint/OneDrive file access
  'mcp_WordServer'          // ← ADD: Word document creation
]);
```

This gives design and marketing agents the ability to create SharePoint pages, upload brand assets, and generate Word documents directly.

### 2.2 — Extend SharePoint Tools with Page Creation

The existing `sharepointTools.ts` has `list_sharepoint_files` for browsing. Add write operations:

**File:** `packages/agents/src/shared/sharepointTools.ts`

Add tools:

```typescript
// create_sharepoint_page — create a page in a SharePoint site
{
  name: 'create_sharepoint_page',
  description: 'Create a new page in a SharePoint site with rich content.',
  parameters: {
    site_id: { type: 'string' },
    title: { type: 'string' },
    content_html: { type: 'string' }, // page content as HTML
    description: { type: 'string' }
  }
  // Implementation: Graph API POST /sites/{site-id}/pages
}

// upload_to_sharepoint — upload a file to a document library
{
  name: 'upload_to_sharepoint',
  description: 'Upload a file (image, PDF, document) to a SharePoint document library.',
  parameters: {
    site_id: { type: 'string' },
    folder_path: { type: 'string' },
    file_name: { type: 'string' },
    content_base64: { type: 'string' },
    content_type: { type: 'string' }
  }
  // Implementation: Graph API PUT /sites/{site-id}/drive/root:/{path}/{name}:/content
}
```

Note: The `mcp_ODSPRemoteServer` from Agent 365 may already cover this. Check what tools it exposes via `tools/list` first — you may not need custom tools at all. If Agent 365 already handles file creation and page creation, just wiring the server filter (2.1) may be sufficient.

### 2.3 — Connect Social Media Publishing

Check the current state of `socialMediaTools.ts` — the 7 tools include schedule_post and audience analytics. Verify whether these actually hit real platform APIs (LinkedIn, X/Twitter, Instagram) or just write to the database.

If DB-only, you need either:

**Option A:** Build an `mcp-social-server` with OAuth connections to:
- LinkedIn Pages API (publish posts, upload images/video)
- X/Twitter API v2 (create tweets, upload media)
- Instagram Graph API via Facebook Business (publish to feed/stories)
- Buffer or Hootsuite API as a shortcut (one integration, multi-platform publish)

**Option B (faster):** Use Buffer/Hootsuite as the publishing layer. One MCP server, one OAuth connection, covers all platforms. Agents draft → schedule via Buffer → Buffer publishes.

**Recommendation:** Option B first. Get content flowing to real platforms. Migrate to direct APIs later if needed.

### 2.4 — Asset Generation Pipeline

The design team has DALL-E 3 via `assetTools.ts` and can upload to GCS. Add a step to also publish to SharePoint:

```typescript
// In assetTools.ts, extend generate_image or add post-processing:
// After generating image → upload to GCS (existing)
// Also → upload to SharePoint brand assets library (new)
// Also → publish_deliverable with storage_url (new)
```

This closes the loop: design generates an asset → it lands in SharePoint brand library → marketing agents can reference it via `get_deliverables`.

---

## Phase 3: Cross-Functional Coordination

**Problem:** Agents work in silos. Design finishes brand guide, but marketing doesn't automatically get it as input for campaign work.

### 3.1 — Initiative-Aware Orchestration in Sarah

Modify Sarah's orchestration loop to handle initiative-level sequencing.

**File:** `packages/agents/src/chief-of-staff/run.ts` (orchestrate task)

Current flow: read directives → create assignments → dispatch.

New flow:

```
read_initiatives (active) →
  for each initiative:
    read directives (by initiative_id, ordered by dependency) →
    check: are prerequisite directives completed? →
      if yes AND directive has no assignments yet → decompose + dispatch
      if no → skip (waiting on dependencies)
    check: did a directive just complete that has downstream dependents? →
      if yes → create next directive's assignments, embedding
        deliverables from completed directive as context
```

**Key addition to orchestration prompt:**

```
CROSS-FUNCTIONAL HANDOFF PROTOCOL:

When a directive completes and produces deliverables:
1. Query get_deliverables for the completed directive
2. Find the next directive in the initiative sequence
3. Embed the deliverable content/URL in the next directive's
   assignment instructions
4. Reference: "The design team produced [Brand Guide v1] —
   use this as your source of truth for brand voice, colors,
   and logo placement. Deliverable URL: {storage_url}"

This ensures downstream agents receive upstream work product
without you having to copy-paste content between assignments.
```

### 3.2 — New Wake Rule: `initiative.directive_completed`

**File:** `packages/agent-runtime/src/wakeRouter.ts`

```typescript
{
  event: 'initiative.directive_completed',
  agents: ['chief-of-staff'],
  priority: 'immediate',
  cooldown: '2min',
  description: 'A directive within an initiative completed — check for downstream work'
}
```

Emit this event from the post-directive synthesis step (when `update_directive_progress` sets status to `completed` and the directive has an `initiative_id`).

### 3.3 — Deliverable-Aware Assignment Instructions

When Sarah creates assignments for a directive that has upstream dependencies, she should auto-query deliverables and embed them:

```typescript
// In the assignment creation flow:
if (directive.initiative_id) {
  const initiative = await getInitiative(directive.initiative_id);
  const priorDirectives = await getDirectives({
    initiative_id: initiative.id,
    status: 'completed'
  });
  const deliverables = await getDeliverables({
    initiative_id: initiative.id
  });

  // Embed in assignment instructions:
  contextBlock = `
AVAILABLE DELIVERABLES FROM PRIOR WORK:
${deliverables.map(d =>
  `- ${d.title} (${d.type}, by ${d.producing_agent}): ${d.storage_url || d.content?.substring(0, 500)}`
).join('\n')}

Use these deliverables as inputs. Do not recreate work that already exists.
  `;
}
```

---

## Phase 4: Slack Product Infrastructure

**Problem:** The entire customer-facing product (AI Marketing Department in Slack) doesn't exist yet in the architecture.

### 4.1 — New Package: `packages/slack-app/`

This is the customer-facing Slack application. Separate from the internal Teams bot.

```
packages/slack-app/
  src/
    app.ts                    # Bolt.js Slack app
    handlers/
      install.ts              # OAuth installation flow
      message.ts              # Inbound customer message routing
      reaction.ts             # Emoji approval handling
      command.ts              # Slash commands (/marketing status, etc.)
    services/
      tenant.ts               # Multi-tenant customer workspace management
      onboarding.ts           # Conversational onboarding flow
      delivery.ts             # Content delivery to customer channels
      approval.ts             # Approval workflow (emoji reactions, thread replies)
    middleware/
      auth.ts                 # Verify Slack signatures
      tenant-resolve.ts       # Resolve customer tenant from workspace ID
```

### 4.2 — New Tables: Customer Tenant Model

```sql
CREATE TABLE customer_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_team_id TEXT UNIQUE NOT NULL,
  slack_team_name TEXT,
  slack_bot_token TEXT NOT NULL,          -- encrypted
  slack_bot_user_id TEXT,
  installed_by TEXT,                      -- Slack user ID of installer
  status TEXT DEFAULT 'onboarding',      -- onboarding | active | churned | paused
  plan TEXT DEFAULT 'starter',
  onboarding_answers JSONB DEFAULT '{}', -- brand info collected during setup
  brand_knowledge_id UUID,               -- reference to customer knowledge base
  channels JSONB DEFAULT '{}',           -- {marketing: 'C123', approvals: 'C456'}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customer_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES customer_tenants(id),
  category TEXT NOT NULL,     -- brand_voice | style_guide | product_info | persona | campaign_history
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),     -- for semantic retrieval
  source TEXT,                -- uploaded | ingested | learned
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customer_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES customer_tenants(id),
  type TEXT NOT NULL,          -- social_post | blog_draft | email_campaign | video | report
  platform TEXT,               -- linkedin | twitter | instagram | email | blog
  content TEXT NOT NULL,
  media_urls TEXT[],
  status TEXT DEFAULT 'draft', -- draft | pending_approval | approved | published | rejected
  approval_thread_ts TEXT,     -- Slack thread where approval happened
  approved_by TEXT,            -- Slack user ID
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  performance JSONB,           -- engagement metrics post-publish
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.3 — Customer Message → Agent Routing

When a customer sends a message in their marketing channel:

```
Slack Event API → POST /slack/events → message handler
  → Resolve tenant from slack_team_id
  → Load customer knowledge context
  → Route to appropriate internal agent:
      - Content request → content-creator
      - Strategy question → cmo
      - Performance/analytics → relevant analyst
      - Approval response → approval service
  → Agent runs with customer context injected
  → Response posted back to customer's Slack thread
```

### 4.4 — Approval Workflow

```
Agent produces content → posts to customer's channel with:
  "Here's your LinkedIn post for this week:
   [post content]
   React ✅ to approve and schedule, ✏️ to request edits"

Customer reacts ✅ →
  reaction handler → update customer_content status='approved'
  → schedule for publishing via social media tools

Customer reacts ✏️ →
  reaction handler → create thread: "What would you like changed?"
  → customer replies → route back to content-creator with revision context
```

### 4.5 — MCP Server: `mcp-slack-server`

```
packages/mcp-slack-server/
  Tools:
    - send_channel_message(tenant_id, channel, text, blocks)
    - send_thread_reply(tenant_id, channel, thread_ts, text)
    - get_channel_messages(tenant_id, channel, limit)
    - create_channel(tenant_id, name, purpose)
    - upload_file(tenant_id, channel, file_content, filename)
    - add_reaction(tenant_id, channel, timestamp, emoji)
    - get_reactions(tenant_id, channel, timestamp)
    - schedule_message(tenant_id, channel, text, post_at)
    - update_message(tenant_id, channel, timestamp, new_text)
```

All tools resolve the bot token from `customer_tenants` by `tenant_id`. Rate-limited per tenant.

---

## Phase 5: The First Real Test

Once Phases 1-3 are in place, here's how the system should handle what you described without any manual directives:

### Expected autonomous flow:

```
Sunday planning cycle fires →

Sarah reads doctrine:
  "AI Marketing Department is the only product. Slack-first.
   Brand knowledge ingestion is essential. Dashboard later."

Sarah reads current state:
  - No brand system exists in SharePoint
  - No marketing campaigns exist
  - No Slack app exists
  - Social media tools not connected to real platforms

Sarah proposes 3 initiatives:

INITIATIVE 1: "Brand Infrastructure Build-out"
  Owner: vp-design (Mia Tanaka)
  Doctrine alignment: "agents must produce brand-aligned outputs"
  Directives:
    1.1 Define brand voice, tone guidelines, and messaging framework
    1.2 Create logo placement rules and usage guidelines
    1.3 Define color system with accessibility compliance
    1.4 Build brand guide page in SharePoint (depends on 1.1, 1.2, 1.3)
    1.5 Generate template assets — social post templates, email headers (depends on 1.4)

INITIATIVE 2: "Marketing Campaign Pipeline"
  Owner: cmo (Maya Brooks)
  Depends on: Initiative 1
  Doctrine alignment: "produces social content, blog drafts, email campaigns"
  Directives:
    2.1 Develop content calendar framework and posting cadence
    2.2 Create first campaign — 2 weeks of social posts across LinkedIn/X (depends on 1.4)
    2.3 Draft 3 blog posts aligned with brand voice (depends on 1.4)
    2.4 Set up email campaign templates in Mailchimp (depends on 1.4)

INITIATIVE 3: "Slack App MVP"
  Owner: cto (Marcus Reeves)
  Doctrine alignment: "Slack-first, workflow-embedded"
  Directives:
    3.1 Design Slack app architecture — OAuth, multi-tenant, message routing
    3.2 Build installation and onboarding flow
    3.3 Build conversational content request → delivery pipeline
    3.4 Build emoji-based approval workflow
    3.5 Integration testing with test workspace

→ Founders get Teams card: "Sarah proposes 3 initiatives. Review?"
→ Kristina approves all 3
→ Sarah activates Initiative 1, creates assignments for Mia's team
→ Design team executes, publishes brand guide as deliverable
→ Sarah detects Initiative 1 directives completing
→ Sarah auto-activates Initiative 2 directives, embedding brand guide
→ Marketing executes campaigns using brand deliverables as input
→ Initiative 3 runs in parallel (no dependency on 1 or 2)
```

---

## Implementation Sequence

| Order | What | Files to touch | Estimated effort |
|-------|------|---------------|-----------------|
| 1 | Migration: `initiatives`, `deliverables` tables + alter `founder_directives` | New migration file | 10 min |
| 2 | Tools: `propose_initiative`, `activate_initiative`, `read_initiatives`, `publish_deliverable`, `get_deliverables` | `chief-of-staff/tools.ts`, `coreTools.ts` | 20 min |
| 3 | Sarah's `strategic_planning` task handler + cron entry | `chief-of-staff/run.ts`, `layer03-executives.ts` | 15 min |
| 4 | Initiative approval via Teams (reuse decision queue pattern) | `dashboardApi.ts` or decision handler | 15 min |
| 5 | Ingest operating doctrine into `company_knowledge` | One-time SQL insert or SharePoint upload | 5 min |
| 6 | Wire `mcp_ODSPRemoteServer` + `mcp_WordServer` into design/marketing agents | 5 agent runner files (server filter change) | 5 min |
| 7 | Initiative-aware orchestration in Sarah's orchestrate loop | `chief-of-staff/run.ts` | 20 min |
| 8 | Wake rule: `initiative.directive_completed` | `wakeRouter.ts` | 5 min |
| 9 | Deliverable embedding in assignment creation | orchestration flow in Sarah's runner | 15 min |
| 10 | Social media publishing (Buffer integration or direct APIs) | New MCP server or extend `socialMediaTools.ts` | 30 min |
| 11 | Slack app package + customer tenant tables | New package + migration | 45 min |
| 12 | Slack MCP server | New MCP server | 30 min |

Steps 1-9 get you an autonomous, self-directing company. Steps 10-12 get you the customer-facing product.
