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
    deps: ClassifiedRunDependencies,
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

    // 6. Constitutional principles (if governor available)
    if (deps.constitutionalGovernor) {
      const constitution = deps.constitutionalGovernor.getConstitutionSync(config.role);
      if (constitution && constitution.principles.length > 0) {
        const principleLines = constitution.principles
          .map((p, i) => `${i + 1}. **${p.id}** (${p.category}): ${p.text}`)
          .join('\n');
        parts.push(`## Constitutional Principles\n\nYour outputs will be evaluated against these principles. Adhere to them:\n\n${principleLines}`);
      }
    }

    // 7. Agent-specific system prompt
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

      // Initialize world model if it doesn't exist yet
      try {
        await deps.sharedMemoryLoader.initializeWorldModel?.(config.role);
      } catch (err) {
        console.warn(`[TaskRunner] World model init failed for ${config.role}:`, (err as Error).message);
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

    // Task tier: use working_voice distillation if available, otherwise fall back to full monologue
    if (profile.working_voice) {
      parts.push('YOUR VOICE (even when heads-down on a task):');
      parts.push(profile.working_voice);
      parts.push('');
      parts.push('FORMAT: Match this voice in your output. No corporate filler. No AI self-reference.');
      parts.push('Be specific. Use real numbers, names, and details.');
    } else if (profile.personality_summary) {
      parts.push(profile.personality_summary, '');
    }

    if (profile.anti_patterns?.length) {
      parts.push('');
      parts.push('**THINGS YOU NEVER SAY:**');
      for (const ap of profile.anti_patterns) {
        parts.push(`- Never: "${ap.never}"`);
        parts.push(`  Instead: "${ap.instead}"`);
      }
    }

    if (profile.signature) parts.push('', `**Sign-off:** ${profile.signature}`);
    return parts.join('\n');
  }
}
