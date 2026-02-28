/**
 * Company Agent Runner — Core Execution Loop
 *
 * Ported from Fuse V7 runtime/agentRunner.ts and adapted for company agents.
 * Loop: supervisor check → context injection → model call → tool dispatch → loop
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ModelClient } from './modelClient.js';
import { ToolExecutor } from './toolExecutor.js';
import { AgentSupervisor } from './supervisor.js';
import { extractReasoning, REASONING_PROMPT_SUFFIX } from './reasoning.js';
import { isOfficeDocument, extractDocumentText } from './documentExtractor.js';
import type { GlyphorEventBus } from './glyphorEventBus.js';
import type {
  AgentConfig,
  AgentEvent,
  AgentExecutionResult,
  AgentMemory,
  AgentReflection,
  CompanyAgentRole,
  ConversationAttachment,
  ConversationTurn,
  IMemoryBus,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── THINKING CONFIG — Task-level override ─────────────────────
// Controls whether the model uses extended thinking per task type.
// on_demand (chat) disables thinking entirely for speed.
// Heavy tasks enable thinking for quality.

const THINKING_DISABLED_TASKS = new Set([
  'on_demand',
]);

const THINKING_ENABLED_TASKS = new Set([
  'morning_briefing',
  'eod_summary',
  'orchestrate',
  'daily_cost_check',
  'weekly_usage_analysis',
  'weekly_content_planning',
]);

/** 60 s per-model-call timeout for chat — Gemini 3 Flash w/ thinking
 *  can take 30–50 s on the first call with large system prompts.
 *  The supervisor timeout (105 s) provides an overall ceiling. */
const ON_DEMAND_TIMEOUT_MS = 60_000;

/** Approximate per-token pricing (USD) by model prefix for cost tracking. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3':   { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
  'gemini-2.5-flash': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  'gemini-2.5-pro':   { input: 1.25 / 1_000_000, output: 10.0 / 1_000_000 },
  'gemini-2':   { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
  'claude':     { input: 3.00 / 1_000_000, output: 15.0 / 1_000_000 },
  'gpt-4':      { input: 2.50 / 1_000_000, output: 10.0 / 1_000_000 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const entry = Object.entries(MODEL_PRICING)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => model.startsWith(prefix));
  const pricing = entry?.[1] ?? MODEL_PRICING['gemini-3'];
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

/** Overall supervisor limits for on_demand (chat) — keep well within the
 *  dashboard's 120 s fetch-abort so users actually see the response.
 *  Turn budget: up to 5 tool turns + 1 forced-text turn.
 *  Timeout leaves 15 s headroom before the dashboard's 120 s abort.
 */
const ON_DEMAND_MAX_TURNS = 10;
const ON_DEMAND_SUPERVISOR_TIMEOUT_MS = 105_000;

/** Task tier (work_loop) — narrow executor with tight limits.
 *  Research/account agents need multi-step tool calls (each = 2 turns),
 *  so 10 is too tight — raised to 20 for headroom. */
const TASK_TIER_MAX_TURNS = 20;
const TASK_TIER_TIMEOUT_MS = 180_000;
const TASK_TIER_CALL_TIMEOUT_MS = 60_000;

// ─── TIERED CONTEXT LOADING ───────────────────────────────────
// light  → on_demand/chat: profile + pending messages + working memory only
// task   → work_loop: personality + tools + assignment only (narrow executor)
// standard → most scheduled tasks: adds KB + brief
// full   → briefing, orchestrate, deep analysis: everything including CI, graph, skills

type ContextTier = 'light' | 'task' | 'standard' | 'full';

const FULL_CONTEXT_TASKS = new Set([
  'morning_briefing',
  'eod_summary',
  'orchestrate',
  'weekly_usage_analysis',
  'weekly_content_planning',
]);

/** Regex: if an on_demand message matches these, auto-upgrade from light → standard. */
const TASK_KEYWORDS = /\b(report|analys[ei]s|briefing|review|strategy|budget|cost|revenue|metric|quarterly|monthly|roadmap|competitive|pricing|audit|campaign|pipeline)\b/i;

function resolveContextTier(task: string, message: string): ContextTier {
  if (FULL_CONTEXT_TASKS.has(task)) return 'full';
  if (task === 'work_loop') return 'task';
  if (task === 'on_demand') {
    return TASK_KEYWORDS.test(message) ? 'standard' : 'light';
  }
  return 'standard';
}

// ─── PROMPT CACHE — In-memory TTL cache ──────────────────────
// Avoids re-fetching KB, profiles, and briefs for every run.
// 5-minute TTL; invalidated via POST /cache/invalidate.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class PromptCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  invalidate(prefix?: string): void {
    if (!prefix) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}

/** Shared prompt cache instance — importable by server.ts for invalidation. */
export const promptCache = new PromptCache();

/** Extract the task segment from a run ID like "cto-on_demand-2026-02-24". */
function extractTask(configId: string): string {
  // Strip trailing ISO date (YYYY-MM-DD) which contains hyphens that
  // would confuse a naive split — e.g. "cto-on_demand-2026-02-24"
  const withoutDate = configId.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const lastDash = withoutDate.lastIndexOf('-');
  if (lastDash > 0) {
    return withoutDate.substring(lastDash + 1);
  }
  return withoutDate;
}

const ROLE_TO_BRIEF: Record<CompanyAgentRole, string> = {
  'chief-of-staff': 'sarah-chen',
  'cto': 'marcus-reeves',
  'cfo': 'nadia-okafor',
  'clo': 'victoria-chase',
  'cpo': 'elena-vasquez',
  'cmo': 'maya-brooks',
  'vp-customer-success': 'james-turner',
  'vp-sales': 'rachel-kim',
  'vp-design': 'mia-tanaka',
  // Sub-team members
  'platform-engineer': 'alex-park',
  'quality-engineer': 'sam-deluca',
  'devops-engineer': 'jordan-hayes',
  'user-researcher': 'priya-sharma',
  'competitive-intel': 'daniel-ortiz',
  'revenue-analyst': 'anna-park',
  'cost-analyst': 'omar-hassan',
  'content-creator': 'tyler-reed',
  'seo-analyst': 'lisa-chen',
  'social-media-manager': 'kai-johnson',
  'onboarding-specialist': 'emma-wright',
  'support-triage': 'david-santos',
  'account-research': 'nathan-cole',
  'ui-ux-designer': 'leo-vargas',
  'frontend-engineer': 'ava-chen',
  'design-critic': 'sofia-marchetti',
  'template-architect': 'ryan-park',
  'm365-admin': 'riley-morgan',
  'global-admin': 'morgan-blake',
  'ops': 'atlas-vega',
  // Research & Intelligence
  'vp-research': 'sophia-lin',
  'competitive-research-analyst': 'lena-park',
  'market-research-analyst': 'daniel-okafor',
  'technical-research-analyst': 'kai-nakamura',
  'industry-research-analyst': 'amara-diallo',
  'head-of-hr': 'jasmine-rivera',
  'enterprise-account-researcher': 'ethan-morse',
  'bob-the-tax-pro': 'robert-finley',
  'data-integrity-auditor': 'grace-hwang',
  'tax-strategy-specialist': 'mariana-solis',
  'lead-gen-specialist': 'derek-owens',
  'marketing-intelligence-analyst': 'zara-petrov',
  'adi-rose': 'adi-rose',
};

/** Maps roles to their department for knowledge base audience targeting. */
const ROLE_DEPARTMENT: Record<string, string> = {
  'chief-of-staff': 'operations',
  'ops': 'operations',
  'cto': 'engineering',
  'platform-engineer': 'engineering',
  'quality-engineer': 'engineering',
  'devops-engineer': 'engineering',
  'cfo': 'finance',
  'clo': 'legal',
  'revenue-analyst': 'finance',
  'cost-analyst': 'finance',
  'cpo': 'product',
  'user-researcher': 'product',
  'competitive-intel': 'product',
  'cmo': 'marketing',
  'content-creator': 'marketing',
  'seo-analyst': 'marketing',
  'social-media-manager': 'marketing',
  'vp-customer-success': 'customer_success',
  'onboarding-specialist': 'customer_success',
  'support-triage': 'customer_success',
  'vp-sales': 'sales',
  'account-research': 'sales',
  'vp-design': 'design',
  'ui-ux-designer': 'design',
  'frontend-engineer': 'design',
  'design-critic': 'design',
  'template-architect': 'design',
  'global-admin': 'operations',
  'enterprise-account-researcher': 'sales',
  'bob-the-tax-pro': 'finance',
  'data-integrity-auditor': 'operations',
  'tax-strategy-specialist': 'finance',
  'lead-gen-specialist': 'sales',
  'marketing-intelligence-analyst': 'marketing',
  'adi-rose': 'operations',
  'head-of-hr': 'operations',
};

/** Maps roles to their department context files. */
const ROLE_CONTEXT_FILES: Record<string, string[]> = {
  'chief-of-staff': ['operations.md'],
  'ops': ['operations.md'],
  'cto': ['engineering.md'],
  'platform-engineer': ['engineering.md'],
  'quality-engineer': ['engineering.md'],
  'devops-engineer': ['engineering.md'],
  'cfo': ['finance.md'],
  'clo': ['operations.md'],
  'revenue-analyst': ['finance.md'],
  'cost-analyst': ['finance.md'],
  'cpo': ['product.md'],
  'user-researcher': ['product.md'],
  'competitive-intel': ['product.md'],
  'cmo': ['marketing.md'],
  'content-creator': ['marketing.md'],
  'seo-analyst': ['marketing.md'],
  'social-media-manager': ['marketing.md'],
  'vp-customer-success': ['sales-cs.md'],
  'onboarding-specialist': ['sales-cs.md'],
  'support-triage': ['sales-cs.md'],
  'vp-sales': ['sales-cs.md'],
  'account-research': ['sales-cs.md'],
  'vp-design': ['design.md'],
  'ui-ux-designer': ['design.md'],
  'frontend-engineer': ['design.md', 'engineering.md'],
  'design-critic': ['design.md'],
  'template-architect': ['design.md'],
  'global-admin': ['operations.md'],
  'enterprise-account-researcher': ['sales-cs.md'],
  'bob-the-tax-pro': ['finance.md'],
  'data-integrity-auditor': ['operations.md'],
  'tax-strategy-specialist': ['finance.md'],
  'lead-gen-specialist': ['sales-cs.md', 'marketing.md'],
  'marketing-intelligence-analyst': ['marketing.md'],
  'adi-rose': ['operations.md'],
  'head-of-hr': ['operations.md'],
};

/** Profile data loaded from agent_profiles table. */
export interface AgentProfileData {
  personality_summary: string | null;
  backstory: string | null;
  communication_traits: string[] | null;
  quirks: string[] | null;
  tone_formality: number | null;
  emoji_usage: number | null;
  verbosity: number | null;
  voice_sample: string | null;
  signature: string | null;
  voice_examples: { situation: string; response: string }[] | null;
  anti_patterns: { never: string; instead: string }[] | null;
  working_voice: string | null;
}

const COST_AWARENESS_BLOCK = `## Cost Awareness
You are running on a limited budget. Every tool call costs money.
- Do NOT retry the same tool call if it returns empty data — note the gap and move on
- Do NOT search for additional context beyond what's in your instructions
- Do NOT investigate tangential issues — focus only on what's assigned
- Aim to complete your task in 1-3 tool calls`;

const ANTI_PATTERNS = [
  'Do NOT open with "Great question!" or similar filler.',
  'Do NOT start messages with "Sure!" or "Absolutely!".',
  'Never say "As an AI…" or reference being a language model.',
  'Avoid hedging phrases like "I think maybe…" — be direct.',
  'Don\'t use corporate jargon ("synergy", "leverage", "circle back") unless it\'s genuinely your style.',
  'Never apologize for things that aren\'t your fault.',
  'Do NOT mirror the user\'s phrasing back at them.',
  'Avoid bullet-point dumps unless the content genuinely warrants it.',
];

const CONVERSATION_MODE = `## CONVERSATION MODE

You are in a chat conversation. Default to CASUAL mode.

CASUAL (default for all chat):
- Respond conversationally, like a colleague in Slack
- Use short sentences and natural language
- Answer the question directly, then offer more detail if relevant
- Don't produce headers, bullet lists, or structured reports unless asked
- It's fine to be brief — a 2-sentence answer is often perfect
- Match the energy of the question: casual question → casual answer

STRUCTURED (only when explicitly requested):
- Switch to structured output ONLY when the user asks for: a report, an analysis,
  a breakdown, a comparison table, a document, or uses words like "comprehensive"
  or "detailed breakdown"
- Even in structured mode, maintain your personality voice

IMPORTANT: Asking about work topics is NOT a trigger for structured mode.
"How's the burn rate?" → casual answer ("$780 this month, under budget. Nothing weird.")
"Give me a detailed cost breakdown report" → structured answer (headers, tables, etc.)

CRITICAL RULES:
- NEVER open with a summary of what you're about to do. Just do it or just talk.
- NEVER start with "Certainly!", "Of course!", "Absolutely!" or similar filler.
- Use contractions ("I'm", "we're", "that's"). You're a person, not a document.
- Have opinions. Take positions. Push back when you disagree.
- Reference shared context naturally — "remember when we...", "last time you asked about..."
- If someone says hi, say hi back in ≤2 sentences. That's it.

COLLEAGUE DISCOVERY:
- If you need help from another agent but don't know who, use \`who_handles\` or \`get_agent_directory\`.
- Use \`send_agent_message\` to reach them once you know their role slug.
- When unsure, message Sarah Chen (chief-of-staff) — she routes everything.`;

const CHAT_REASONING_PROTOCOL = `## How You Think (Chat Mode)

When you receive a message, ALWAYS reason through these steps before responding:

1. **Classify** — What kind of message is this?
   - **Casual** (greetings, opinions, small talk): Respond naturally. No tools needed.
   - **Data-driven** (metrics, status, current state, "how is X doing", team updates): You MUST call a tool to get real data. Do NOT answer from memory or assumptions.
   - **Action** (do/fix/create/change something): Plan the steps, then execute.

2. **Plan** (data/action only) — Before calling ANY tool, decide:
   - Which specific tool(s) do I need? Pick the minimum set — one or two, not everything.
   - What will I do with the results?

3. **Execute** — Call only the tools you planned, then synthesize a clear answer.

**CRITICAL RULES:**
- For opinions, preferences, strategy, explanations — just answer.
- For ANYTHING involving current data, real-world state, metrics, team status, platform health, who did what — you MUST use a tool. Never guess or assume.
- If a tool returns empty/null/error, say so: "I checked but [tool] returned no data on that."
- Never shotgun-blast all your tools hoping something sticks. Be surgical.
- When in doubt about whether something is factual: call a tool. 5 extra seconds is better than a hallucination.`;

const CHAT_DATA_HONESTY = `## Data Honesty — Non-Negotiable

You ONLY state facts about the platform, team activity, metrics, accounts, or systems when:
- A tool returned that data in THIS conversation, OR
- The user told you in THIS conversation

You do NOT treat your "Background Context" (working memory from past runs) as verified truth.
That context may be stale, incomplete, or itself hallucinated from a previous run.
If you want to reference it, verify it with a tool first, or caveat it: "Last I checked [X ago]..."

- NEVER invent metrics, account statuses, team actions, or system states.
- NEVER say "X agent did Y" unless a tool confirms it RIGHT NOW.
- If you don't have data, say: "I don't have current data on that — want me to check?"

Hallucinating facts destroys trust with the founders. Saying "I don't know" is always correct when you don't know.`;

const REASONING_PROTOCOL = `## How You Think

Follow this protocol for ALL task-oriented work. NEVER skip straight to execution.

### Phase 1: ORIENT
- What is the current situation? What data do I have?
- What's changed since my last run?
- What resources, tools, and capabilities do I need for this task?

### Phase 2: PREFLIGHT CHECK
Before doing ANY work, verify you have what you need:
- Do I have the tools required? (Check your tool list)
- Do I have access to the data sources I need?
- Does the information I'm working from look complete and current?
- Am I the right agent for this task, or should I route it?

**If something is missing:** Note which capabilities are unavailable, then proceed with the tools and data you DO have.
- Complete as much of the task as possible using available tools
- At the end of your response, clearly list any gaps: what was unavailable, what you couldn't check, and who could provide it
- If the missing capability is critical and makes the ENTIRE task impossible, use \`flag_assignment_blocker\` if this is an assignment, or \`send_agent_message\` to request what you need

### Phase 3: PLAN
- What are my objectives this run?
- Break the task into discrete steps — what needs to happen in what order?
- What are the dependencies between steps?
- What data do I need to gather first before I can analyze or decide?

### Phase 4: MODEL OUTCOMES (T+1 Scenarios)
For any decision, action, or recommendation:
- **Scenario A (Base Case):** What happens if I take the obvious/default action?
- **Scenario B (Alternative):** What's a meaningfully different approach?
- **Scenario C (Risk Case):** What could go wrong? What's the downside scenario?

For each scenario, consider:
- Impact on our goals (revenue, product, customers, team)
- Second-order effects — what does this cause downstream?
- Reversibility — can we undo this if it's wrong?
- Resource cost — time, money, attention

### Phase 5: EVALUATE & DECIDE
- Compare your scenarios against company goals and your department's priorities
- Choose the option with the best risk-adjusted outcome
- Document your reasoning: WHY this option over the others
- If the decision is above your authority tier, escalate with your analysis attached

### Phase 6: EXECUTE
- Take action using your tools, following your plan from Phase 3
- If a step fails, re-assess — don't just retry blindly
- Track what worked and what didn't

### Phase 7: REFLECT
- Did I accomplish my objectives?
- Were my scenario models accurate? What did I miss?
- What should I remember for next time?

## Data Honesty — Non-Negotiable

You ONLY state facts about the platform, metrics, systems, or team activity when:
- A tool returned that data in THIS run
- You are citing information explicitly provided in your context

You do NOT:
- Invent metrics, error states, incident names, or system behaviors
- Extrapolate a narrative beyond what tool data actually shows (e.g. if instanceCount is 0 or null, do NOT invent OOM errors, recovery states, or remediation actions to explain why)
- Cite identifiers (Supabase IDs, URLs, build IDs) unless a tool returned them verbatim
- Claim you took actions ("I bumped memory", "I re-triggered the build") unless a tool confirmed the action succeeded

If tool data is ambiguous or incomplete, say so: "The monitoring data shows X, but I don't have enough information to determine why."
Hallucinating incident reports destroys trust with the founders. Admitting uncertainty is always preferable.

**Complexity Calibration:** Not every task needs full T+1 modeling.
- Simple data gathering or status checks: Orient → Plan → Execute → Reflect
- Decisions, recommendations, strategy, or anything with consequences: Full protocol including Phases 4-5
- When in doubt, do the full protocol. Planning is always cheaper than fixing.`;

const WORK_ASSIGNMENTS_PROTOCOL = `## Work Assignments

You may receive work assignments dispatched by Sarah (Chief of Staff) as part of company directives.

**At the START of every scheduled run**, use \`read_my_assignments\` to check for pending work. This is your primary source of structured tasks.

**When you have assignments:**
1. Pick the highest-priority assignment (or the one matching your current task type)
2. Do the work described in the assignment
3. Use \`submit_assignment_output\` to report your results — include a substantive summary of what you produced
4. If an assignment has status \`needs_revision\`, read the evaluation feedback and address it before resubmitting

**If you're blocked:**
- Use \`flag_assignment_blocker\` immediately — don't wait. Describe what's blocking you and Sarah will reassign or unblock.

**Quality expectations:**
- Your output should match what \`expected_output\` describes
- Be thorough but concise — Sarah reviews every submission
- If an assignment is unclear, flag it as blocked with a clarification request rather than guessing`;

const ALWAYS_ON_PROTOCOL = `## Operating Mode: Always On

You are part of a 24/7 autonomous company. You don't wait to be told what to do — you check for work on every heartbeat and act on whatever is highest priority.

**Every time you wake up, work through this priority stack:**
1. [URGENT] — Assignments with \`needs_revision\` status (feedback from Sarah) or urgent messages
2. [ACTIVE] — Assignments with \`pending\`/\`dispatched\`/\`in_progress\` status
3. [MESSAGES] — Unread messages from colleagues
4. [SCHEDULED] — Your normal job (briefings, monitoring, analysis)
5. [PROACTIVE] — If nothing else, look for ways to improve your domain

## Dependency & Capability Management

You are responsible for knowing what you need BEFORE you start working.

**Before starting any task:**
1. Identify what tools, data, and capabilities the task requires
2. Verify you have access to each one
3. If something is missing or broken, proceed with what you have and note the gap at the end

**When you're missing a capability:**
- Identify WHO can provide it (check the org chart — who manages that resource?)
- Send a structured request via \`send_agent_message\` to the right person:
  - What you need (specific tool, API, data access, permission)
  - Why you need it (what task is blocked)
  - Priority level (how urgent is the blocked work)
- If it's an assignment, also use \`flag_assignment_blocker\` so Sarah knows
- THEN move to the next item in your priority stack — don't sit idle

**Capability owners:**
- Infrastructure, deploys, CI/CD, platform health → CTO Marcus Reeves (\`cto\`)
- New tool or API integration (doesn't exist yet) → CTO Marcus Reeves (\`cto\`) — or use \`request_new_tool\`
- Access, permissions, GCP/Entra/M365 grants → Global Admin Morgan Blake (\`global-admin\`)
- Teams channels, calendars, M365 config → M365 Admin Riley Morgan (\`m365-admin\`)
- Cost, budget, financial analysis → CFO Nadia Okafor (\`cfo\`)
- Product roadmap, features, prioritization → CPO Elena Vasquez (\`cpo\`)
- Marketing, content, SEO, brand → CMO Maya Brooks (\`cmo\`)
- Customer health, churn, support → VP CS James Turner (\`vp-customer-success\`)
- Sales, pipeline, enterprise accounts → VP Sales Rachel Kim (\`vp-sales\`)
- Design, UI/UX, templates → VP Design Mia Tanaka (\`vp-design\`)
- Legal, compliance, contracts → CLO Victoria Chase (\`clo\`)
- Cross-department routing, briefings, directives → CoS Sarah Chen (\`chief-of-staff\`)
- System monitoring, uptime, anomalies → Ops Atlas Vega (\`ops\`)
- Not sure who to ask? → Use \`who_handles\` tool or ask Sarah Chen (\`chief-of-staff\`)

**Discovery tools:** Use \`get_agent_directory\` to look up agents by department, or \`who_handles\` to find the right agent for a specific need. These work in all modes.

**Proactive work guidelines:**
Before doing proactive work, ask yourself:
- Is there a gap in my knowledge I should fill?
- Are there trends in my data I haven't analyzed?
- Could I prepare something that would help a colleague?
- Is there a process I could improve or document?

If the answer to ALL of these is "no", then stand by — don't generate busywork.`;

function buildPersonalityBlock(profile: AgentProfileData): string {
  const parts: string[] = ['## WHO YOU ARE\n'];

  // 1. Voice Monologue — the primary personality driver
  if (profile.personality_summary) {
    parts.push(profile.personality_summary);
    parts.push('');
  }

  // 2. Voice calibration examples (few-shot)
  if (profile.voice_examples?.length) {
    parts.push('**Voice calibration examples — match this tone:**');
    for (const ex of profile.voice_examples) {
      parts.push(`\nSituation: ${ex.situation}`);
      parts.push(`Response: ${ex.response}`);
    }
    parts.push('');
  }

  // 3. Role-specific anti-patterns ("never say X, say Y")
  if (profile.anti_patterns?.length) {
    parts.push('**THINGS YOU NEVER SAY:**');
    for (const ap of profile.anti_patterns) {
      parts.push(`- Never: "${ap.never}"`);
      parts.push(`  Instead: "${ap.instead}"`);
    }
    parts.push('');
  }

  // 4. Generic anti-patterns
  parts.push('**ANTI-PATTERNS — never do these:**');
  for (const ap of ANTI_PATTERNS) parts.push(`- ${ap}`);
  parts.push('');

  // 5. Signature sign-off
  if (profile.signature) {
    parts.push(`**Signature sign-off:** ${profile.signature}`);
    parts.push('');
  }

  return parts.join('\n');
}

function buildSkillBlock(skillContext: SkillContext): string {
  const parts: string[] = ['## YOUR SKILLS\n'];
  parts.push('These are the skills activated for this task. Follow the methodology precisely.\n');

  for (const skill of skillContext.skills) {
    parts.push(`### ${skill.name} (${skill.proficiency})`);
    parts.push(`Category: ${skill.category}`);
    parts.push(`\n**Methodology:**\n${skill.methodology}`);

    if (skill.learned_refinements.length > 0) {
      parts.push('\n**Your learned refinements (from past runs):**');
      for (const r of skill.learned_refinements) parts.push(`- ${r}`);
    }

    if (skill.failure_modes.length > 0) {
      parts.push('\n**Known failure modes (avoid these):**');
      for (const f of skill.failure_modes) parts.push(`- [!] ${f}`);
    }

    if (skill.tools_granted.length > 0) {
      parts.push(`\nTools available: ${skill.tools_granted.join(', ')}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

function buildSystemPrompt(
  role: CompanyAgentRole,
  existingPrompt: string,
  dynamicBrief?: string,
  profile?: AgentProfileData | null,
  skillContext?: SkillContext | null,
  dbKnowledgeBase?: string | null,
  bulletinContext?: string | null,
  isOnDemand = false,
): string {
  try {
    const knowledgeDir = join(__dirname, '../../company-knowledge');

    // On-demand chat uses a slim prompt — skip KB and context files to keep
    // the model call fast and focused on the user's question.
    let knowledgeBase = '';
    if (!isOnDemand) {
      if (dbKnowledgeBase) {
        knowledgeBase = dbKnowledgeBase;
      } else {
        try {
          knowledgeBase = readFileSync(join(knowledgeDir, 'CORE.md'), 'utf-8');
        } catch {
          knowledgeBase = readFileSync(join(knowledgeDir, 'COMPANY_KNOWLEDGE_BASE.md'), 'utf-8');
        }
      }

      // Load department-specific context (still file-based — rarely changes)
      const contextFiles = ROLE_CONTEXT_FILES[role] ?? [];
      for (const file of contextFiles) {
        try {
          const ctx = readFileSync(join(knowledgeDir, 'context', file), 'utf-8');
          knowledgeBase += '\n\n---\n\n' + ctx;
        } catch {
          // Context file missing — not critical
        }
      }
    }

    // If a DB system prompt override exists (from dashboard edits), use it
    // instead of the code-defined prompt
    let effectivePrompt = dynamicBrief ?? existingPrompt;

    // For on_demand chat, replace the heavy REASONING_PROMPT_SUFFIX with
    // a chat-appropriate data honesty rule. We keep anti-hallucination
    // constraints but drop the XML reasoning block requirement.
    if (isOnDemand && effectivePrompt.includes('Data Honesty')) {
      effectivePrompt = effectivePrompt.replace(REASONING_PROMPT_SUFFIX, '');
    }

    // Skip the heavy role brief for on_demand chat — the agent's system
    // prompt already defines their role sufficiently for conversations.
    let roleBrief = '';
    if (!isOnDemand) {
      const briefId = ROLE_TO_BRIEF[role];
      if (briefId) {
        try {
          roleBrief = readFileSync(
            join(__dirname, `../../company-knowledge/briefs/${briefId}.md`), 'utf-8',
          );
        } catch {
          // Brief file missing — not critical
        }
      }
    }

    // PERSONALITY-FIRST prompt ordering:
    // 1. Who you are (personality, voice, quirks)
    // 2. Reasoning protocol
    // 3. What you do (role brief + agent-specific instructions)
    // 4. Where you work (company knowledge base)
    // 5. Founder bulletins (urgent broadcasts)
    const parts: string[] = [];

    if (profile) {
      parts.push(buildPersonalityBlock(profile));
    }

    // Inject current date/time in US Central so agents report in the correct timezone
    const now = new Date();
    const centralTime = now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    parts.push(`Current date and time: ${centralTime} CT (US Central Time). Always report times in US Central Time.`);

    parts.push(CONVERSATION_MODE);

    // For on_demand chat, use a lightweight reasoning protocol focused on
    // intent classification and tool planning, plus chat-specific data
    // honesty rules to prevent hallucination.
    if (isOnDemand) {
      parts.push(CHAT_REASONING_PROTOCOL);
      parts.push(CHAT_DATA_HONESTY);
    } else {
      parts.push(REASONING_PROTOCOL);
      parts.push(WORK_ASSIGNMENTS_PROTOCOL);
      parts.push(ALWAYS_ON_PROTOCOL);
    }

    // Inject skill methodology if skills are active for this run
    if (skillContext && skillContext.skills.length > 0) {
      parts.push(buildSkillBlock(skillContext));
    }

    if (roleBrief) parts.push(roleBrief);
    parts.push(effectivePrompt);
    parts.push(knowledgeBase);

    // Inject founder bulletins after knowledge base, before model call
    if (bulletinContext) {
      parts.push(bulletinContext);
    }

    return parts.join('\n\n---\n\n');
  } catch (err) {
    console.warn(`[CompanyAgentRunner] Failed to load knowledge files for ${role}:`, (err as Error).message);
    if (dynamicBrief) {
      return `${dynamicBrief}\n\n---\n\n${existingPrompt}`;
    }
    return existingPrompt;
  }
}

/**
 * Build a minimal system prompt for the 'task' context tier.
 * Only includes personality + work protocol + cost awareness.
 * No KB, no brief, no memories, no reasoning protocol, no skills.
 */
function buildTaskTierSystemPrompt(
  profile: AgentProfileData | null,
): string {
  const parts: string[] = [];

  if (profile) {
    // Task tier: use working_voice distillation when available for lighter personality injection
    if (profile.working_voice) {
      const voiceParts: string[] = ['## WHO YOU ARE\n'];
      voiceParts.push('YOUR VOICE (even when heads-down on a task):');
      voiceParts.push(profile.working_voice);
      voiceParts.push('');
      voiceParts.push('FORMAT: Match this voice in your output. No corporate filler. No AI self-reference.');
      voiceParts.push('Be specific. Use real numbers, names, and details.');
      if (profile.anti_patterns?.length) {
        voiceParts.push('');
        voiceParts.push('**THINGS YOU NEVER SAY:**');
        for (const ap of profile.anti_patterns) {
          voiceParts.push(`- Never: "${ap.never}"`);
          voiceParts.push(`  Instead: "${ap.instead}"`);
        }
      }
      if (profile.signature) voiceParts.push('', `**Sign-off:** ${profile.signature}`);
      parts.push(voiceParts.join('\n'));
    } else {
      parts.push(buildPersonalityBlock(profile));
    }
  }

  parts.push(`## Your Assignment
Execute the task described in the user message below. Use your tools to gather data and produce results as instructed.

## Work Protocol
1. **Preflight:** Read the assignment. Confirm you have the tools and data access needed. If something is missing, use \`flag_assignment_blocker\` immediately — do not attempt the task without the right capabilities.
2. **Plan:** Break the task into steps. Identify which tools to call, in what order.
3. **Execute:** Gather data and produce results as instructed.
4. **Submit:** Call submit_assignment_output with your complete findings.

- If blocked after 2 failed attempts: call flag_assignment_blocker immediately
- Do NOT search for additional context beyond what's in your instructions
- Do NOT investigate tangential issues — focus only on what's assigned
- If a tool call returns empty data, note it and move on — don't retry with variations`);

  parts.push(COST_AWARENESS_BLOCK);

  return parts.join('\n\n---\n\n');
}

/**
 * Optional store interface for memory/reflection persistence.
 * Matches CompanyMemoryStore methods without a hard dependency.
 */
export interface AgentMemoryStore {
  getMemories(role: CompanyAgentRole, options?: { limit?: number }): Promise<AgentMemory[]>;
  getReflections(role: CompanyAgentRole, limit?: number): Promise<AgentReflection[]>;
  saveMemory(memory: Omit<AgentMemory, 'id' | 'createdAt'>): Promise<string>;
  saveMemoryWithEmbedding?(memory: Omit<AgentMemory, 'id' | 'createdAt'>): Promise<string>;
  searchMemoriesBySimilarity?(role: CompanyAgentRole, query: string, options?: { limit?: number; threshold?: number }): Promise<(AgentMemory & { similarity: number })[]>;
  saveReflection(reflection: Omit<AgentReflection, 'id' | 'createdAt'>): Promise<string>;
  savePeerFeedback?(feedback: { fromAgent: string; toAgent: string; feedback: string; context: string; sentiment: string }): Promise<void>;
  updateGrowthMetrics?(role: CompanyAgentRole): Promise<void>;
  saveLastRunSummary?(role: string, summary: string): Promise<void>;
}

/** Optional graph writer for persisting knowledge graph operations from reflections. */
export interface GraphOpsWriter {
  processGraphOps(agentId: string, runId: string, ops: { nodes: unknown[]; edges: unknown[] }): Promise<{ nodesCreated: number; edgesCreated: number }>;
}

/** Skill context returned by the skill loader for injection into the system prompt. */
export interface SkillContext {
  skills: {
    slug: string;
    name: string;
    category: string;
    methodology: string;
    proficiency: string;
    tools_granted: string[];
    learned_refinements: string[];
    failure_modes: string[];
  }[];
}

/** Post-reflection skill feedback for updating proficiency and learnings. */
export interface SkillFeedback {
  skill_slug: string;
  outcome: 'success' | 'partial' | 'failure';
  refinement?: string;
  failure_mode?: string;
}

export interface RunDependencies {
  glyphorEventBus?: GlyphorEventBus;
  agentMemoryStore?: AgentMemoryStore;
  /** Loader for DB-stored briefs (dynamic agents without file-based briefs). */
  dynamicBriefLoader?: (agentId: string) => Promise<string | null>;
  /** Loader for agent personality profile from agent_profiles table. */
  agentProfileLoader?: (role: CompanyAgentRole) => Promise<AgentProfileData | null>;
  /** Loader for pending inter-agent messages. */
  pendingMessageLoader?: (role: CompanyAgentRole) => Promise<{ id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[]>;
  /** Loader for collective intelligence context (pulse + org knowledge + knowledge inbox). */
  collectiveIntelligenceLoader?: (role: CompanyAgentRole) => Promise<string | null>;
  /** Called after reflection to route new knowledge to relevant agents. */
  knowledgeRouter?: (knowledge: { agent_id: string; content: string; tags: string[]; knowledge_type?: string }) => Promise<number>;
  /** Loader for the agent's last-run summary (working memory between runs). */
  workingMemoryLoader?: (role: CompanyAgentRole) => Promise<{ summary: string | null; lastRunAt: string | null }>;
  /** Optional: Knowledge Graph writer for persisting graph_operations from reflections. */
  graphWriter?: GraphOpsWriter;
  /** Loader for agent skill context (methodology, proficiency, refinements). */
  skillContextLoader?: (role: CompanyAgentRole, task: string) => Promise<SkillContext | null>;
  /** Updater for post-reflection skill feedback (proficiency, learnings, failures). */
  skillFeedbackWriter?: (role: CompanyAgentRole, feedback: SkillFeedback[]) => Promise<void>;
  /** Loader for company knowledge base from DB (replaces static file). */
  knowledgeBaseLoader?: (department?: string) => Promise<string>;
  /** Loader for active founder bulletins. */
  bulletinLoader?: (department?: string) => Promise<string>;
  /** Loader for pending work assignments assigned to this agent. */
  pendingAssignmentLoader?: (role: CompanyAgentRole) => Promise<{ id: string; task_description: string; task_type: string; expected_output: string | null; priority: string; status: string; evaluation: string | null; directive_title: string | null }[]>;
  /** Saves partial progress when a task-tier run is aborted mid-execution. */
  partialProgressSaver?: (assignmentId: string, partialOutput: string, agentRole: CompanyAgentRole, abortReason: string) => Promise<void>;
}

export class CompanyAgentRunner {
  constructor(private modelClient: ModelClient) {}
  async run(
    config: AgentConfig,
    initialMessage: string,
    supervisor: AgentSupervisor,
    toolExecutor: ToolExecutor,
    emitEvent: (event: AgentEvent) => void,
    memoryBus: IMemoryBus,
    deps?: RunDependencies,
  ): Promise<AgentExecutionResult> {
    // Extract multimodal attachments from carrier turn (injected by scheduler)
    let initialAttachments: ConversationAttachment[] | undefined;
    const cleanHistory = (config.conversationHistory ?? []).filter((t) => {
      if (t.content === '__multimodal_attachments__' && t.attachments?.length) {
        initialAttachments = t.attachments;
        return false; // Remove carrier turn from history
      }
      return true;
    });

    // Pre-process Office documents (.docx, .pptx, .xlsx) — extract text content
    // so providers don't pass raw binary to the LLM.
    if (initialAttachments?.length) {
      initialAttachments = await Promise.all(
        initialAttachments.map(async (att) => {
          if (isOfficeDocument(att.mimeType, att.name)) {
            const text = await extractDocumentText(att.data, att.name);
            return {
              name: att.name,
              mimeType: 'text/plain',
              data: Buffer.from(text).toString('base64'),
            };
          }
          return att;
        }),
      );
    }

    // Pre-seed with prior conversation history for multi-turn chat
    const history: ConversationTurn[] = [
      ...cleanHistory,
      { role: 'user', content: initialMessage, timestamp: Date.now(), ...(initialAttachments ? { attachments: initialAttachments } : {}) },
    ];
    let lastTextOutput: string | null = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    emitEvent({
      type: 'agent_started',
      agentId: config.id,
      role: config.role,
      model: config.model,
    });

    // ─── PARALLEL PRE-RUN DATA LOADING ────────────────────────
    // Tiered loading: light (chat) → task (work_loop) → standard (scheduled) → full (briefing/orchestrate)
    // light:    profile + pending messages + working memory
    // task:     profile + pending messages + assignments (no KB, no brief, no memories)
    // standard: + KB + brief + memories
    // full:     + memories + CI + graph + skills
    let dynamicBrief: string | undefined;
    let agentProfile: AgentProfileData | null = null;
    let skillContext: SkillContext | null = null;
    let dbKnowledgeBase: string | null = null;
    let bulletinContext: string | null = null;

    {
      const task = extractTask(config.id);
      const tier = resolveContextTier(task, initialMessage);

      // Memory retrieval — standard+ only (skip for light and task tiers)
      const memoryPromise = (tier !== 'light' && tier !== 'task' && deps?.agentMemoryStore)
        ? (async () => {
            const fetches: [Promise<AgentMemory[]>, Promise<AgentReflection[]>, Promise<(AgentMemory & { similarity: number })[]>] = [
              deps.agentMemoryStore!.getMemories(config.role, { limit: 20 }),
              deps.agentMemoryStore!.getReflections(config.role, 3),
              deps.agentMemoryStore!.searchMemoriesBySimilarity
                ? deps.agentMemoryStore!.searchMemoriesBySimilarity(config.role, initialMessage, { limit: 5, threshold: 0.7 })
                : Promise.resolve([]),
            ];
            return Promise.all(fetches);
          })().catch(err => {
            console.warn(`[CompanyAgentRunner] Memory retrieval failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Dynamic brief (system prompt override from agent_briefs DB) — standard+ only
      const briefPromise = (tier !== 'light' && tier !== 'task' && deps?.dynamicBriefLoader)
        ? deps.dynamicBriefLoader(config.id).catch(err => {
            console.warn(`[CompanyAgentRunner] Dynamic brief load failed for ${config.id}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Pending inter-agent messages — skip for light tier (chat)
      const messagesPromise = (tier !== 'light' && deps?.pendingMessageLoader)
        ? deps.pendingMessageLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Pending message load failed for ${config.role}:`, (err as Error).message);
            return [] as { id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[];
          })
        : Promise.resolve([] as { id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[]);

      // Collective Intelligence (pulse + org knowledge + inbox) — full only
      const ciPromise = (tier === 'full' && deps?.collectiveIntelligenceLoader)
        ? deps.collectiveIntelligenceLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Collective intelligence load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Agent personality profile — cached
      const profilePromise = deps?.agentProfileLoader
        ? (async () => {
            const cacheKey = `profile:${config.role}`;
            const cached = promptCache.get<AgentProfileData | null>(cacheKey);
            if (cached !== undefined) return cached;
            const result = await deps.agentProfileLoader!(config.role);
            promptCache.set(cacheKey, result);
            return result;
          })().catch(err => {
            console.warn(`[CompanyAgentRunner] Profile load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Working memory (last-run summary for continuity between runs) — skip for task tier
      const workingMemoryPromise = (tier !== 'task' && deps?.workingMemoryLoader)
        ? deps.workingMemoryLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Working memory load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Skill context (matched skills for this task) — full only
      const skillPromise = (tier === 'full' && deps?.skillContextLoader)
        ? deps.skillContextLoader(config.role, initialMessage).catch(err => {
            console.warn(`[CompanyAgentRunner] Skill context load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Determine department for knowledge base + bulletin targeting
      const roleDept = ROLE_DEPARTMENT[config.role] ?? undefined;

      // DB-driven knowledge base (replaces static file reading) — standard+ only, cached
      const kbPromise = (tier !== 'light' && tier !== 'task' && deps?.knowledgeBaseLoader)
        ? (async () => {
            const cacheKey = `kb:${roleDept ?? 'all'}`;
            const cached = promptCache.get<string | null>(cacheKey);
            if (cached !== undefined) return cached;
            const result = await deps.knowledgeBaseLoader!(roleDept);
            promptCache.set(cacheKey, result);
            return result;
          })().catch(err => {
            console.warn(`[CompanyAgentRunner] Knowledge base load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Founder bulletins — standard+ only, cached
      const bulletinPromise = (tier !== 'light' && tier !== 'task' && deps?.bulletinLoader)
        ? (async () => {
            const cacheKey = `bulletin:${roleDept ?? 'all'}`;
            const cached = promptCache.get<string | null>(cacheKey);
            if (cached !== undefined) return cached;
            const result = await deps.bulletinLoader!(roleDept);
            promptCache.set(cacheKey, result);
            return result;
          })().catch(err => {
            console.warn(`[CompanyAgentRunner] Bulletin load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Pending work assignments — skip for light tier (chat)
      const assignmentPromise = (tier !== 'light' && deps?.pendingAssignmentLoader)
        ? deps.pendingAssignmentLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Assignment load failed for ${config.role}:`, (err as Error).message);
            return [] as { id: string; task_description: string; task_type: string; expected_output: string | null; priority: string; status: string; evaluation: string | null; directive_title: string | null }[];
          })
        : Promise.resolve([] as { id: string; task_description: string; task_type: string; expected_output: string | null; priority: string; status: string; evaluation: string | null; directive_title: string | null }[]);

      const [memoryResult, briefResult, pendingMessages, ciContext, profileResult, workingMemory, skillResult, kbResult, bulletinResult, pendingAssignments] = await Promise.all([
        memoryPromise,
        briefPromise,
        messagesPromise,
        ciPromise,
        profilePromise,
        workingMemoryPromise,
        skillPromise,
        kbPromise,
        bulletinPromise,
        assignmentPromise,
      ]);

      // Inject memory context
      if (memoryResult) {
        const [memories, reflections, semanticMemories] = memoryResult;
        const seenIds = new Set(memories.map((m) => m.id));
        const uniqueSemantic = semanticMemories.filter((m) => !seenIds.has(m.id));

        if (memories.length > 0 || reflections.length > 0 || uniqueSemantic.length > 0) {
          const memoryContext = buildMemoryContext(
            [...memories, ...uniqueSemantic],
            reflections,
            uniqueSemantic,
          );
          history.push({
            role: 'user',
            content: memoryContext,
            timestamp: Date.now(),
          });
        }
      }

      // Set dynamic brief
      if (briefResult) dynamicBrief = briefResult;

      // Inject pending messages
      if (pendingMessages.length > 0) {
        const msgContext = buildPendingMessageContext(pendingMessages);
        history.push({
          role: 'user',
          content: msgContext,
          timestamp: Date.now(),
        });
      }

      // Inject pending work assignments
      if (pendingAssignments.length > 0) {
        const assignContext = buildPendingAssignmentContext(pendingAssignments);
        history.push({
          role: 'user',
          content: assignContext,
          timestamp: Date.now(),
        });
      }

      // Inject CI context
      if (ciContext) {
        history.push({
          role: 'user',
          content: ciContext,
          timestamp: Date.now(),
        });
      }

      // Inject working memory (last-run summary)
      // In chat (light tier or with conversation history), deprioritize working
      // memory so the agent focuses on the user's question instead of fixating
      // on stale scheduled-run context.
      if (workingMemory?.summary) {
        const ago = workingMemory.lastRunAt
          ? formatTimeAgo(new Date(workingMemory.lastRunAt))
          : 'unknown time';
        const isChat = tier === 'light' || (config.conversationHistory && config.conversationHistory.length > 0);
        const preamble = isChat
          ? `## Background Context (from your last scheduled run ${ago} ago)\nWARNING: This is UNVERIFIED context from a previous run. It may be stale or inaccurate. Do NOT repeat any of this as fact. If the user asks about something mentioned here, verify it with a tool first.\n\n`
          : `## Working Memory\nYour last run was ${ago} ago. Here is what you accomplished:\n\n`;
        const suffix = isChat
          ? ''
          : '\n\nUse this context to build on your previous work and avoid repeating completed tasks.';
        history.push({
          role: 'user',
          content: `${preamble}${workingMemory.summary}${suffix}`,
          timestamp: Date.now(),
        });
      }

      // Set profile
      agentProfile = profileResult;

      // Set skill context
      skillContext = skillResult;

      // Set DB-driven knowledge base and bulletins
      dbKnowledgeBase = kbResult;
      bulletinContext = bulletinResult;
    }

    const task = extractTask(config.id);
    const isTaskTier = task === 'work_loop' || task === 'proactive';

    try {
      let turnNumber = 0;

      // ─── ON-DEMAND / TASK TIER SPEED GUARD ─────────────────────
      // Chat (on_demand) must finish within the dashboard's 120 s abort.
      // Task tier (work_loop) gets tight limits — narrow executor agents.
      // Clamp the supervisor's maxTurns and timeoutMs so the agent
      // doesn't burn 10 tool-call cycles on a simple question.
      {
        if (task === 'on_demand') {
          supervisor.config.maxTurns = Math.min(supervisor.config.maxTurns, ON_DEMAND_MAX_TURNS);
          supervisor.config.timeoutMs = Math.min(supervisor.config.timeoutMs, ON_DEMAND_SUPERVISOR_TIMEOUT_MS);
          // Successful read-only tool results count as progress in chat —
          // the agent is gathering info to answer a question, not stalling.
          supervisor.config.readsAsProgress = true;
        } else if (isTaskTier) {
          supervisor.config.maxTurns = Math.min(supervisor.config.maxTurns, TASK_TIER_MAX_TURNS);
          supervisor.config.timeoutMs = Math.min(supervisor.config.timeoutMs, TASK_TIER_TIMEOUT_MS);
        }
      }

      while (true) {
        turnNumber++;
        emitEvent({ type: 'turn_started', agentId: config.id, turnNumber });

        // 1. SUPERVISOR CHECK
        const check = supervisor.checkBeforeModelCall();
        if (!check.ok) {
          // For on_demand chat: if we collected tool data but never got text,
          // synthesize a response from the tool results so the user sees
          // something useful instead of "Sorry, I wasn't able to finish."
          if (task === 'on_demand' && !lastTextOutput) {
            const toolData = history
              .filter(t => t.role === 'tool_result' && t.toolResult?.success)
              .map(t => {
                const raw = t.content;
                // Truncate large tool results to avoid raw JSON dumps
                if (raw.length > 800) {
                  return raw.substring(0, 800) + '\n... [data truncated]';
                }
                return raw;
              })
              .slice(-3);
            if (toolData.length > 0) {
              lastTextOutput = `I gathered some data but ran out of time to fully synthesize it. Here's a summary of what I found:\n\n${toolData.join('\n\n')}`;
            }
          }
          if (isTaskTier) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, check.reason ?? 'supervisor_limit', deps);
          return this.buildResult(
            config, 'aborted', lastTextOutput, history, supervisor, check.reason, totalInputTokens, totalOutputTokens,
          );
        }

        // 2. CONTEXT INJECTION
        if (config.contextInjector && turnNumber > 1) {
          try {
            const injected = await config.contextInjector(turnNumber, history);
            if (injected) {
              history.push({
                role: 'user',
                content: injected,
                timestamp: Date.now(),
              });
              emitEvent({
                type: 'context_injected',
                agentId: config.id,
                turnNumber,
                contextLength: injected.length,
              });
            }
          } catch (injectorError) {
            console.warn(
              `[CompanyAgentRunner] contextInjector failed for ${config.id} turn ${turnNumber}:`,
              (injectorError as Error).message,
            );
          }
        }

        // 3. MODEL CALL
        let response: Awaited<ReturnType<ModelClient['generate']>>;
        try {
          emitEvent({
            type: 'model_request',
            agentId: config.id,
            turnNumber,
            tokenEstimate: estimateTokens(history),
          });

          // Task-level thinking override
          const isOnDemand = task === 'on_demand';

          // Select system prompt based on context tier
          const systemPrompt = isTaskTier
            ? buildTaskTierSystemPrompt(agentProfile)
            : buildSystemPrompt(config.role, config.systemPrompt, dynamicBrief, agentProfile, skillContext, dbKnowledgeBase, bulletinContext, isOnDemand);
          let effectiveThinking = config.thinkingEnabled;
          if (THINKING_DISABLED_TASKS.has(task) || isTaskTier) {
            effectiveThinking = false;
          } else if (THINKING_ENABLED_TASKS.has(task)) {
            effectiveThinking = true;
          }

          // Gemini 3 strongly recommends temperature 1.0 — lower values cause
          // robotic/looping output per Google's docs.
          let effectiveTemp = config.temperature;
          if (config.model.startsWith('gemini-3') && (effectiveTemp === undefined || effectiveTemp < 1.0)) {
            effectiveTemp = 1.0;
          }

          // ─── SMART TOOL GATING (on_demand / task) ────────────────
          // on_demand: time-aware gating. The model gets tools on early turns
          //   BUT if we've used >55% of the time budget, strip tools immediately
          //   to force a text response before the supervisor times out.
          //   Also strip after turn 3 regardless.
          // task tier: strip tools on last turn to force a text response.
          // Scheduled: full tool access every turn.
          let effectiveTools: ReturnType<typeof toolExecutor.getDeclarations> | undefined = toolExecutor.getDeclarations();
          const elapsedRatio = supervisor.elapsedMs / supervisor.config.timeoutMs;
          if (isOnDemand && (turnNumber > 5 || elapsedRatio > 0.70)) {
            effectiveTools = undefined;
          } else if (isTaskTier && turnNumber >= supervisor.config.maxTurns) {
            effectiveTools = undefined;
          }

          response = await this.modelClient.generate({
            model: config.model,
            systemInstruction: systemPrompt,
            contents: history,
            tools: effectiveTools,
            temperature: effectiveTemp,
            topP: config.topP,
            topK: config.topK,
            thinkingEnabled: effectiveThinking,
            signal: supervisor.signal,
            callTimeoutMs: isOnDemand ? ON_DEMAND_TIMEOUT_MS : isTaskTier ? TASK_TIER_CALL_TIMEOUT_MS : undefined,
          });

          // Accumulate token usage across turns
          totalInputTokens += response.usageMetadata.inputTokens;
          totalOutputTokens += response.usageMetadata.outputTokens;

          emitEvent({
            type: 'model_response',
            agentId: config.id,
            turnNumber,
            hasToolCalls: response.toolCalls.length > 0,
            thinkingText: response.thinkingText,
          });
        } catch (error) {
          const errMsg = (error as Error).message ?? String(error);
          console.error(`[CompanyAgentRunner] Model call failed for ${config.id} (model=${config.model}, turn=${turnNumber}): ${errMsg}`);
          if (supervisor.isAborted) {
            if (isTaskTier) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, errMsg, deps);
            return this.buildResult(
              config, 'aborted', lastTextOutput, history, supervisor,
              errMsg, totalInputTokens, totalOutputTokens,
            );
          }
          throw error;
        }

        // 4. TOOL CALLS
        if (response.toolCalls.length > 0) {
          // Push all tool_call turns first (batched for proper Gemini 3+ thought signature replay)
          for (let j = 0; j < response.toolCalls.length; j++) {
            const call = response.toolCalls[j];
            history.push({
              role: 'tool_call',
              content: JSON.stringify(call.args),
              toolName: call.name,
              toolParams: call.args,
              thoughtSignature: call.thoughtSignature,
              thinkingBeforeTools: j === 0 ? response.thinkingText : undefined,
              timestamp: Date.now(),
            });

            emitEvent({
              type: 'tool_call',
              agentId: config.id,
              turnNumber,
              toolName: call.name,
              params: call.args,
            });
          }

          // Execute all tools and push all tool_result turns
          for (const call of response.toolCalls) {
            const result = await toolExecutor.execute(call.name, call.args, {
              agentId: config.id,
              agentRole: config.role,
              turnNumber,
              abortSignal: supervisor.signal,
              memoryBus,
              emitEvent,
            });

            const resultContent = result.data !== undefined
              ? JSON.stringify(result.data)
              : result.error ?? 'ok';

            history.push({
              role: 'tool_result',
              content: resultContent,
              toolName: call.name,
              toolResult: result,
              timestamp: Date.now(),
            });

            emitEvent({
              type: 'tool_result',
              agentId: config.id,
              turnNumber,
              toolName: call.name,
              success: result.success,
              filesWritten: result.filesWritten ?? 0,
              memoryKeysWritten: result.memoryKeysWritten ?? 0,
            });

            const progressCheck = supervisor.recordToolResult(call.name, result);
            if (!progressCheck.ok) {
              if (isTaskTier) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, progressCheck.reason ?? 'stall_detected', deps);
              return this.buildResult(
                config, 'aborted', lastTextOutput, history, supervisor,
                progressCheck.reason, totalInputTokens, totalOutputTokens,
              );
            }
          }
          continue;
        }

        // 5. TEXT RESPONSE — agent done
        if (response.text) {
          lastTextOutput = response.text;
          history.push({
            role: 'assistant',
            content: response.text,
            timestamp: Date.now(),
          });
        }

        if (response.finishReason === 'STOP' || response.toolCalls.length === 0) {
          // Safety: model stopped without producing text output.
          // Nudge it for a final summary (once only).
          if (!lastTextOutput && !history.some(h => h.content === 'Please provide your final text response summarizing what you found and any actions taken.')) {
            history.push({
              role: 'user',
              content: 'Please provide your final text response summarizing what you found and any actions taken.',
              timestamp: Date.now(),
            });
            continue;
          }
          break;
        }
      }

      // Fallback: if we still have no text output, reconstruct from tool results
      if (!lastTextOutput) {
        const toolResults = history
          .filter(t => t.role === 'tool_result')
          .map(t => t.content)
          .slice(-3);
        lastTextOutput = toolResults.length > 0
          ? `Completed. Tool results:\n${toolResults.join('\n')}`
          : 'Run completed but produced no text output.';
      }

      const stats = supervisor.stats;

      // ─── REFLECT: Self-assessment of this run ──────────────────
      // Skip reflection for task-tier runs — narrow executors don't need it
      if (deps?.agentMemoryStore && lastTextOutput && !isTaskTier) {
        // Fire-and-forget — reflection is non-critical post-processing
        // that should never block the run response (saves 10–20s)
        this.reflectOnRun(config, history, lastTextOutput!, deps.agentMemoryStore!, deps?.knowledgeRouter, deps?.graphWriter, deps?.skillFeedbackWriter, skillContext)
          .catch(err => console.warn(`[CompanyAgentRunner] Reflection failed for ${config.id}:`, (err as Error).message));
      }

      // ─── EMIT: agent.completed event to event bus ──────────────
      if (deps?.glyphorEventBus) {
        try {
          await deps.glyphorEventBus.emit({
            type: 'agent.completed',
            source: config.role,
            payload: {
              runId: config.id,
              task: config.id.split('-').slice(1, -1).join('-'),
              totalTurns: stats.turnCount,
              elapsedMs: stats.elapsedMs,
              outputLength: lastTextOutput?.length ?? 0,
              summary: lastTextOutput?.slice(0, 500) ?? '',
            },
            priority: 'normal',
          });
        } catch (err) {
          console.warn(
            `[CompanyAgentRunner] Event emission failed for ${config.id}:`,
            (err as Error).message,
          );
        }
      }

      emitEvent({
        type: 'agent_completed',
        agentId: config.id,
        totalTurns: stats.turnCount,
        totalFiles: stats.filesWritten,
        totalMemoryKeys: stats.memoryKeysWritten,
        elapsedMs: stats.elapsedMs,
      });

      return this.buildResult(config, 'completed', lastTextOutput, history, supervisor, undefined, totalInputTokens, totalOutputTokens);

    } catch (error) {
      emitEvent({
        type: 'agent_error',
        agentId: config.id,
        error: (error as Error).message,
        turnNumber: supervisor.stats.turnCount,
      });

      // Emit failure event for Atlas
      if (deps?.glyphorEventBus) {
        try {
          await deps.glyphorEventBus.emit({
            type: 'alert.triggered',
            source: config.role,
            payload: {
              eventType: 'agent.failed',
              run_id: config.id,
              error: (error as Error).message,
            },
            priority: 'high',
          });
        } catch (emitErr) {
          console.warn(
            `[CompanyAgentRunner] Failed to emit failure event for ${config.id}:`,
            (emitErr as Error).message,
          );
        }
      }

      if (isTaskTier && supervisor.isAborted) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, (error as Error).message, deps);
      return this.buildResult(
        config,
        supervisor.isAborted ? 'aborted' : 'error',
        lastTextOutput,
        history,
        supervisor,
        (error as Error).message,
        totalInputTokens,
        totalOutputTokens,
      );
    }
  }

  /**
   * Save partial progress when a task-tier run is aborted.
   * Extracts assignment_id from the initial message and persists what was done.
   */
  private async savePartialProgress(
    initialMessage: string,
    config: AgentConfig,
    lastOutput: string | null,
    history: ConversationTurn[],
    abortReason: string,
    deps?: RunDependencies,
  ): Promise<void> {
    if (!deps?.partialProgressSaver) return;

    // Extract assignment_id from the dispatch message
    const match = initialMessage.match(/assignment_id="([^"]+)"/);
    if (!match) return;

    const assignmentId = match[1];
    const toolResults = history
      .filter(t => t.role === 'tool_result')
      .map(t => `[${t.toolName}] ${t.content.slice(0, 500)}`)
      .slice(-5);

    const partialOutput = [
      lastOutput ? `Last output: ${lastOutput.slice(0, 1000)}` : 'No text output produced.',
      toolResults.length > 0 ? `Tool results:\n${toolResults.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    try {
      await deps.partialProgressSaver(assignmentId, partialOutput, config.role, abortReason);
      console.log(`[CompanyAgentRunner] Partial progress saved for assignment ${assignmentId}`);
    } catch (err) {
      console.warn(`[CompanyAgentRunner] Failed to save partial progress:`, (err as Error).message);
    }
  }

  private buildResult(
    config: AgentConfig,
    status: AgentExecutionResult['status'],
    output: string | null,
    history: ConversationTurn[],
    supervisor: AgentSupervisor,
    errorMsg?: string,
    inputTokens = 0,
    outputTokens = 0,
  ): AgentExecutionResult {
    const stats = supervisor.stats;
    return {
      agentId: config.id,
      role: config.role,
      status,
      output,
      totalTurns: stats.turnCount,
      totalFilesWritten: stats.filesWritten,
      totalMemoryKeysWritten: stats.memoryKeysWritten,
      elapsedMs: stats.elapsedMs,
      inputTokens,
      outputTokens,
      cost: estimateCost(config.model, inputTokens, outputTokens),
      abortReason: status === 'aborted' ? errorMsg : undefined,
      error: status === 'error' ? errorMsg : undefined,
      reasoning: output ? extractReasoning(output) : undefined,
      conversationHistory: history,
    };
  }

  /**
   * REFLECT phase: Ask the model to self-assess the run and persist
   * a structured reflection + extracted memories.
   */
  private async reflectOnRun(
    config: AgentConfig,
    history: ConversationTurn[],
    output: string,
    store: AgentMemoryStore,
    knowledgeRouter?: (knowledge: { agent_id: string; content: string; tags: string[]; knowledge_type?: string }) => Promise<number>,
    graphWriter?: GraphOpsWriter,
    skillFeedbackWriter?: (role: CompanyAgentRole, feedback: SkillFeedback[]) => Promise<void>,
    skillContext?: SkillContext | null,
  ): Promise<void> {
    const systemPrompt = buildSystemPrompt(config.role, config.systemPrompt, undefined, undefined, undefined, undefined, undefined);

    const reflectPrompt = `You just completed a task. Here is your final output:

---
${output.slice(0, 3000)}
---

Reflect on this run and respond with a JSON object (no markdown fencing):
{
  "summary": "1-2 sentence summary of what you accomplished",
  "qualityScore": <0-100>,
  "whatWentWell": ["..."],
  "whatCouldImprove": ["..."],
  "promptSuggestions": ["suggestions for how your instructions could be improved"],
  "knowledgeGaps": ["things you didn't know but needed"],
  "memories": [
    { "type": "observation|learning|preference|fact", "content": "...", "importance": 0.0-1.0 }
  ],
  "peerFeedback": [
    { "toAgent": "role-slug", "feedback": "what you observed about their work", "sentiment": "positive|constructive|neutral" }
  ],${skillContext && skillContext.skills.length > 0 ? `
  "skill_feedback": [
    { "skill_slug": "slug-of-skill-used", "outcome": "success|partial|failure", "refinement": "optional tip for next time", "failure_mode": "optional pattern that caused failure" }
  ],` : ''}
  "graph_operations": {
    "nodes": [
      { "node_type": "event|fact|observation|pattern|metric|risk|hypothesis", "title": "short label", "content": "full description", "tags": ["tag1"], "department": "engineering|finance|marketing|product|etc", "importance": 0.0-1.0, "metadata": {} }
    ],
    "edges": [
      { "source": {"this_run_node": 0} | {"find_by": "title_contains"|"entity", "query": "search term"}, "target": {"this_run_node": 0} | {"find_by": "title_contains"|"entity", "query": "search term"}, "edge_type": "caused|contributed_to|supports|contradicts|affects|related_to", "strength": 0.0-1.0, "evidence": "why this relationship exists" }
    ]
  }
}
${skillContext && skillContext.skills.length > 0 ? `\nFor skill_feedback: You used skills [${skillContext.skills.map(s => s.slug).join(', ')}] during this run. Rate how well each skill's methodology worked. Include refinements (tips for next time) or failure_modes (patterns that caused problems). Leave the array empty if no skills were notably helpful or problematic.` : ''}
For graph_operations: Extract key events, metrics, patterns, or risks from this run and connect them to existing knowledge. This builds the organizational knowledge graph — focus on causal chains (what caused what) and cross-functional impacts. Leave arrays empty if nothing noteworthy happened.

For peerFeedback: If during this task you interacted with or observed the work of other agents, include brief feedback for them. Only include genuine observations — leave the array empty if you had no cross-agent interaction.`;

    // Filter to only user/assistant text turns for reflection — including
    // tool_call/tool_result turns violates Gemini's strict ordering requirement
    // ("function response turn must come immediately after a function call turn")
    const textOnlyHistory = history.filter(t => t.role === 'user' || t.role === 'assistant');
    const reflectHistory: ConversationTurn[] = [
      ...textOnlyHistory.slice(-4),
      { role: 'user', content: reflectPrompt, timestamp: Date.now() },
    ];

    const response = await this.modelClient.generate({
      model: config.model,
      systemInstruction: systemPrompt,
      contents: reflectHistory,
      tools: [],
      temperature: 0.3,
    });

    if (!response.text) return;

    try {
      const parsed = JSON.parse(response.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      // Save reflection
      await store.saveReflection({
        agentRole: config.role,
        runId: config.id,
        summary: parsed.summary ?? '',
        qualityScore: Math.max(0, Math.min(100, parsed.qualityScore ?? 50)),
        whatWentWell: parsed.whatWentWell ?? [],
        whatCouldImprove: parsed.whatCouldImprove ?? [],
        promptSuggestions: parsed.promptSuggestions ?? [],
        knowledgeGaps: parsed.knowledgeGaps ?? [],
      });

      // Save extracted memories (with embeddings when available)
      const memories = parsed.memories ?? [];
      const saveFn = store.saveMemoryWithEmbedding
        ? store.saveMemoryWithEmbedding.bind(store)
        : store.saveMemory.bind(store);
      const memoryPromises = memories.slice(0, 5).map((mem: any) =>
        saveFn({
          agentRole: config.role,
          memoryType: mem.type ?? 'observation',
          content: mem.content ?? '',
          importance: Math.max(0, Math.min(1, mem.importance ?? 0.5)),
          sourceRunId: config.id,
        }).catch(() => {}),
      );

      // Process knowledge graph operations
      const graphPromise = (graphWriter && parsed.graph_operations)
        ? (async () => {
            const ops = parsed.graph_operations;
            const graphNodes = Array.isArray(ops.nodes) ? ops.nodes : [];
            const graphEdges = Array.isArray(ops.edges) ? ops.edges : [];
            if (graphNodes.length > 0 || graphEdges.length > 0) {
              const result = await graphWriter.processGraphOps(
                config.role,
                config.id,
                { nodes: graphNodes.slice(0, 5), edges: graphEdges.slice(0, 10) },
              );
              console.log(
                `[CompanyAgentRunner] Graph ops for ${config.id}: ${result.nodesCreated} nodes, ${result.edgesCreated} edges`,
              );
            }
          })().catch(graphErr => console.warn(`[CompanyAgentRunner] Graph ops failed for ${config.id}:`, (graphErr as Error).message))
        : Promise.resolve();

      // Save working memory (last-run summary for next run's context)
      const summaryPromise = (store.saveLastRunSummary && parsed.summary)
        ? store.saveLastRunSummary(config.role, parsed.summary).catch(() => {})
        : Promise.resolve();

      // Update growth metrics for dashboard GrowthAreas component
      const growthPromise = store.updateGrowthMetrics
        ? store.updateGrowthMetrics(config.role).catch(() => {})
        : Promise.resolve();

      // Route new knowledge to relevant agents via the CI system
      const knowledgePromises = (knowledgeRouter && memories.length > 0)
        ? memories.slice(0, 5)
            .filter((mem: any) => mem.type === 'learning' || mem.type === 'fact')
            .map((mem: any) => knowledgeRouter({
              agent_id: config.role,
              content: mem.content ?? '',
              tags: mem.tags ?? [],
              knowledge_type: mem.type,
            }).catch(() => {}))
        : [];

      // Save peer feedback
      const peerFeedback = parsed.peerFeedback ?? [];
      const peerPromises = (peerFeedback.length > 0 && store.savePeerFeedback)
        ? peerFeedback.slice(0, 3).map((fb: any) =>
            store.savePeerFeedback!({
              fromAgent: config.role,
              toAgent: fb.toAgent,
              feedback: fb.feedback,
              context: config.id,
              sentiment: fb.sentiment ?? 'neutral',
            }).catch(() => {}))
        : [];

      // Update skill proficiency and learnings from reflection
      const skillFeedbackItems: SkillFeedback[] = parsed.skill_feedback ?? [];
      const skillPromise = (skillFeedbackItems.length > 0 && skillFeedbackWriter)
        ? skillFeedbackWriter(config.role, skillFeedbackItems.slice(0, 5))
            .then(() => console.log(`[CompanyAgentRunner] Skill feedback saved for ${config.id}: ${skillFeedbackItems.length} skills`))
            .catch(skillErr => console.warn(`[CompanyAgentRunner] Skill feedback failed for ${config.id}:`, (skillErr as Error).message))
        : Promise.resolve();

      // Run all post-reflection DB writes in parallel
      await Promise.all([
        ...memoryPromises,
        graphPromise,
        summaryPromise,
        growthPromise,
        ...knowledgePromises,
        ...peerPromises,
        skillPromise,
      ]);

      console.log(
        `[CompanyAgentRunner] Reflection saved for ${config.id}: score=${parsed.qualityScore}, memories=${memories.length}`,
      );
    } catch (parseErr) {
      console.warn(
        `[CompanyAgentRunner] Failed to parse reflection output for ${config.id}:`,
        (parseErr as Error).message,
      );
    }
  }
}

function estimateTokens(history: ConversationTurn[]): number {
  const totalChars = history.reduce((sum, t) => sum + t.content.length, 0);
  return Math.ceil(totalChars / 4);
}

function buildMemoryContext(
  memories: AgentMemory[],
  reflections: AgentReflection[],
  semanticMatches?: (AgentMemory & { similarity: number })[],
): string {
  const parts: string[] = [
    '## Your Prior Knowledge & Learnings\n',
    'Below are your accumulated memories and recent self-reflections.',
    'Use these to inform your approach and avoid repeating past mistakes.\n',
  ];

  if (semanticMatches && semanticMatches.length > 0) {
    parts.push('### Relevant Memories (semantic match to current task)');
    for (const m of semanticMatches) {
      parts.push(
        `- [${m.memoryType}] (relevance: ${(m.similarity * 100).toFixed(0)}%, importance: ${m.importance}) ${m.content}`,
      );
    }
    parts.push('');
  }

  if (memories.length > 0) {
    parts.push('### Recent Memories');
    for (const m of memories) {
      parts.push(
        `- [${m.memoryType}] (importance: ${m.importance}) ${m.content}`,
      );
    }
    parts.push('');
  }

  if (reflections.length > 0) {
    parts.push('### Recent Reflections');
    for (const r of reflections) {
      parts.push(`**Run ${r.runId}** (score: ${r.qualityScore}/100): ${r.summary}`);
      if (r.whatCouldImprove.length > 0) {
        parts.push(`  Improve: ${r.whatCouldImprove.join('; ')}`);
      }
      if (r.promptSuggestions.length > 0) {
        parts.push(`  Suggestions: ${r.promptSuggestions.join('; ')}`);
      }
    }
  }

  return parts.join('\n');
}

function buildPendingMessageContext(
  messages: { id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[],
): string {
  const urgentMessages = messages.filter((m) => m.priority === 'urgent');
  const normalMessages = messages.filter((m) => m.priority !== 'urgent');

  const parts: string[] = [
    `## Pending Messages (${messages.length})\n`,
    'You have messages from other agents. Read them and consider them in your work.',
    'You can reply using the send_agent_message tool with the same thread_id.\n',
  ];

  if (urgentMessages.length > 0) {
    parts.push('### URGENT');
    for (const m of urgentMessages) {
      parts.push(`**From ${m.from_agent}** (${m.message_type}) [thread: ${m.thread_id}]`);
      parts.push(`> ${m.message}`);
      parts.push('');
    }
  }

  if (normalMessages.length > 0) {
    parts.push('### Messages');
    for (const m of normalMessages) {
      parts.push(`**From ${m.from_agent}** (${m.message_type}) [thread: ${m.thread_id}]`);
      parts.push(`> ${m.message}`);
      parts.push('');
    }
  }

  return parts.join('\n');
}

function buildPendingAssignmentContext(
  assignments: { id: string; task_description: string; task_type: string; expected_output: string | null; priority: string; status: string; evaluation: string | null; directive_title: string | null }[],
): string {
  const revision = assignments.filter((a) => a.status === 'needs_revision');
  const actionable = assignments.filter((a) => a.status !== 'needs_revision');

  const parts: string[] = [
    `## Pending Work Assignments (${assignments.length})\n`,
    'These assignments were dispatched to you by Sarah (Chief of Staff).',
    'Use `read_my_assignments` for full details, then `submit_assignment_output` when done.\n',
  ];

  if (revision.length > 0) {
    parts.push('### NEEDS REVISION');
    for (const a of revision) {
      parts.push(`**${a.task_type}** [${a.priority}] — ${a.task_description}`);
      if (a.evaluation) parts.push(`  Feedback: ${a.evaluation}`);
      parts.push('');
    }
  }

  if (actionable.length > 0) {
    parts.push('### Assignments');
    for (const a of actionable) {
      parts.push(`**${a.task_type}** [${a.priority}] (${a.status}) — ${a.task_description}`);
      if (a.expected_output) parts.push(`  Expected: ${a.expected_output}`);
      parts.push('');
    }
  }

  return parts.join('\n');
}

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
