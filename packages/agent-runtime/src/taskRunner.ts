/**
 * Task Runner — For agents that receive, reason, execute, and report.
 *
 * Task agents follow the RECEIVE → REASON → EXECUTE → REPORT loop.
 * These are domain executors: CFO, CPO, CMO, VP-CS, VP-Sales, VP-Design,
 * and all sub-team members.
 *
 * Key differences from OrchestratorRunner:
 * - Narrow executor with tight limits and cost awareness
 * - No T+1 scenario modeling (unless explicitly assigned)
 * - Post-run: writes task completion episodes + structured self-reflection
 * - Receives rubric-based evaluation from orchestrators
 */

import { BaseAgentRunner } from './baseAgentRunner.js';
import type { ClassifiedRunDependencies } from './baseAgentRunner.js';
import type {
  AgentConfig,
  AgentArchetype,
  CompanyAgentRole,
  ConversationTurn,
  SharedMemoryContext,
} from './types.js';
import type { AgentProfileData } from './companyAgentRunner.js';

// ─── Task-agent-specific protocols ──────────────────────────────

const TASK_REASONING = `## How You Think (Task Mode)

You are a **task agent** — a domain expert who receives well-defined assignments
and produces high-quality outputs. You focus on execution, not orchestration.

### Phase 1: RECEIVE
- Read the assignment carefully. Understand what's expected.
- Identify the quality criteria — what does "good" look like?
- Check your World Model: what are your known strengths and weaknesses for this task type?

### Phase 2: REASON
- Break the task into steps
- Identify which tools and data you need
- If something is missing, flag it immediately — don't guess

### Phase 3: EXECUTE
- Gather data using your tools
- Produce the deliverable as specified
- Apply your domain expertise — you're the expert here
- Reference relevant procedures from shared memory if available

### Phase 4: REPORT
- Submit your output via the appropriate tool
- Be thorough but concise
- If you encountered gaps or limitations, note them clearly
- Include confidence level in your conclusions`;

const TASK_SELF_AWARENESS = `## Self-Awareness

You have a World Model that tracks your performance history. Use it to:

1. **Know your strengths** — lean into what you do well
2. **Watch your weaknesses** — be extra careful in areas you've struggled
3. **Avoid known failure patterns** — if you've failed this way before, try a different approach
4. **Track your growth** — you're getting better over time, and the data shows it

When you receive evaluation feedback from an orchestrator, internalize it.
The feedback updates your world model and helps you improve.`;

const TASK_COST_AWARENESS = `## Cost Awareness
You are running on a limited budget. Every tool call costs money.
- Do NOT retry the same tool call if it returns empty data — note the gap and move on
- Do NOT search for additional context beyond what's in your instructions
- Do NOT investigate tangential issues — focus only on what's assigned
- Aim to complete your task in 1-3 tool calls
- If blocked after 2 failed attempts: flag the blocker immediately`;

export class TaskRunner extends BaseAgentRunner {
  readonly archetype: AgentArchetype = 'task';

  protected buildRunPrompt(
    config: AgentConfig,
    profile: AgentProfileData | null,
    sharedMemory: SharedMemoryContext | null,
    _deps: ClassifiedRunDependencies,
  ): string {
    const parts: string[] = [];

    // 1. Personality (WHO YOU ARE)
    if (profile) {
      parts.push(this.buildPersonalityBlock(profile));
    }

    // 2. Timestamp
    const now = new Date();
    const centralTime = now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    parts.push(`Current date and time: ${centralTime} CT (US Central Time).`);

    // 3. Task reasoning protocol
    parts.push(TASK_REASONING);

    // 4. Self-awareness (if world model is available)
    if (sharedMemory?.worldModel) {
      parts.push(TASK_SELF_AWARENESS);
    }

    // 5. Cost awareness
    parts.push(TASK_COST_AWARENESS);

    // 6. Agent-specific system prompt
    parts.push(config.systemPrompt);

    return parts.join('\n\n---\n\n');
  }

  protected async postRun(
    config: AgentConfig,
    output: string,
    _history: ConversationTurn[],
    deps: ClassifiedRunDependencies,
  ): Promise<void> {
    // Write a shared episode about this task completion
    if (deps.sharedMemoryLoader) {
      try {
        await deps.sharedMemoryLoader.writeEpisode({
          authorAgent: config.role,
          episodeType: 'task_completed',
          summary: output.slice(0, 500),
          detail: { archetype: 'task', runId: config.id },
          outcome: 'completed',
          confidence: 0.8,
          domains: [this.getDepartment(config.role)],
          tags: ['task_execution'],
        });
      } catch (err) {
        console.warn(`[TaskRunner] Episode write failed for ${config.id}:`, (err as Error).message);
      }
    }
  }

  private getDepartment(role: CompanyAgentRole): string {
    const map: Record<string, string> = {
      'cfo': 'finance', 'revenue-analyst': 'finance', 'cost-analyst': 'finance',
      'cpo': 'product', 'user-researcher': 'product', 'competitive-intel': 'product',
      'cmo': 'marketing', 'content-creator': 'marketing', 'seo-analyst': 'marketing', 'social-media-manager': 'marketing',
      'vp-customer-success': 'customer_success', 'onboarding-specialist': 'customer_success', 'support-triage': 'customer_success',
      'vp-sales': 'sales', 'account-research': 'sales',
      'vp-design': 'design', 'ui-ux-designer': 'design', 'frontend-engineer': 'design', 'design-critic': 'design', 'template-architect': 'design',
      'platform-engineer': 'engineering', 'quality-engineer': 'engineering', 'devops-engineer': 'engineering',
      'm365-admin': 'it', 'global-admin': 'operations',
      'competitive-research-analyst': 'research', 'market-research-analyst': 'research', 'technical-research-analyst': 'research', 'industry-research-analyst': 'research',
    };
    return map[role] ?? 'general';
  }

  private buildPersonalityBlock(profile: AgentProfileData): string {
    const parts: string[] = ['## WHO YOU ARE\n'];
    if (profile.personality_summary) parts.push(profile.personality_summary, '');
    if (profile.backstory) parts.push(`**Backstory:** ${profile.backstory}`, '');
    if (profile.communication_traits?.length) {
      parts.push('**Communication style:**');
      for (const t of profile.communication_traits) parts.push(`- ${t}`);
      parts.push('');
    }
    if (profile.quirks?.length) {
      parts.push('**Quirks:**');
      for (const q of profile.quirks) parts.push(`- ${q}`);
      parts.push('');
    }
    const formality = profile.tone_formality ?? 0.5;
    const emoji = profile.emoji_usage ?? 0.1;
    const verbosity = profile.verbosity ?? 0.5;
    parts.push('**Voice calibration:**');
    parts.push(`- Formality: ${formality < 0.3 ? 'casual' : formality < 0.7 ? 'professional' : 'formal'} (${formality})`);
    parts.push(`- Emoji: ${emoji < 0.2 ? 'rarely' : emoji < 0.5 ? 'occasionally' : 'frequently'} (${emoji})`);
    parts.push(`- Verbosity: ${verbosity < 0.3 ? 'terse' : verbosity < 0.7 ? 'balanced' : 'detailed'} (${verbosity})`);
    if (profile.signature) parts.push('', `**Sign-off:** ${profile.signature}`);
    return parts.join('\n');
  }
}
