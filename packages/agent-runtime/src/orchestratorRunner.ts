/**
 * Orchestrator Runner — For agents that decompose, delegate, and evaluate.
 *
 * Orchestrators follow the OBSERVE → PLAN → DELEGATE → MONITOR → EVALUATE loop.
 * Roles: chief-of-staff, vp-research, cto, clo, ops
 *
 * Key differences from TaskRunner:
 * - Full company knowledge base + brief injected
 * - T+1 scenario modeling in reasoning protocol
 * - Post-run: grades delegated agent work and updates world models
 * - Shared episode: writes 'decision_made' and 'collaboration' episodes
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

// ─── Orchestrator-specific protocols ────────────────────────────

const ORCHESTRATOR_REASONING = `## How You Think (Orchestrator Mode)

You are an **orchestrator** — your job is to decompose complex objectives into
atomic tasks, delegate to the right agents, and synthesize their outputs into
something greater than the sum of its parts.

### Phase 1: OBSERVE
- What is the current situation? What data do I have?
- What directives or goals are active?
- What agents are available and what are their capabilities?
- Review your World Model: What are each agent's strengths, weaknesses, and recent performance?

### Phase 2: PLAN
- Decompose the objective into atomic, well-defined sub-tasks
- For each sub-task: which agent is best suited? (Use world model data)
- Identify dependencies — what must complete before what?
- Plan for failure — what's the fallback if an agent underperforms?

### Phase 3: DELEGATE
- Create clear, self-contained assignments for each agent
- Include full context: what they need, what you expect back, and quality criteria
- Tailor context to the agent's capability level (use world model insights)
- Set appropriate priority and deadlines

### Phase 4: MONITOR
- Track assignment progress and status
- Identify blockers early and re-route if needed
- Don't micro-manage — trust agents to execute within their capability

### Phase 5: EVALUATE
- Grade each agent's output against the role rubric
- Be calibrated: use the rubric dimensions, not gut feeling
- Provide specific, actionable feedback
- Update your assessment of each agent's capabilities

### Phase 6: SYNTHESIZE
- Combine outputs into a coherent whole
- Identify cross-functional insights that individual agents missed
- Produce a deliverable that exceeds the sum of its parts

### T+1 Scenario Modeling
For any decision, action, or recommendation:
- **Base Case:** What happens if I take the obvious/default action?
- **Alternative:** What's a meaningfully different approach?
- **Risk Case:** What could go wrong? What's the downside scenario?
Consider: impact on goals, second-order effects, reversibility, resource cost.`;

const ORCHESTRATOR_WORLD_MODEL_INSTRUCTIONS = `## World Model Usage

You have access to a self-model that tracks your strengths, weaknesses, and
per-agent capability assessments. Use this information to:

1. **Route tasks** to agents best suited for the work type
2. **Tailor context** based on agent capability level
3. **Predict quality** and plan contingencies for weak areas
4. **Track improvement** over time — celebrate growth, address stagnation

When evaluating agent outputs, provide structured grades with rubric scores.
Your evaluations feed back into the world model, making future routing better.`;

const COST_AWARENESS = `## Cost Awareness
Every model call and tool call costs money. As an orchestrator, you control
spending for your entire delegation chain.
- Prefer atomic assignments over large open-ended ones
- Don't dispatch work that could be answered from existing context
- When synthesizing, work with what you have — don't request re-runs`;

export class OrchestratorRunner extends BaseAgentRunner {
  readonly archetype: AgentArchetype = 'orchestrator';

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

    // 3. Orchestrator reasoning protocol
    parts.push(ORCHESTRATOR_REASONING);

    // 4. World model instructions
    if (sharedMemory?.worldModel) {
      parts.push(ORCHESTRATOR_WORLD_MODEL_INSTRUCTIONS);
    }

    // 5. Cost awareness
    parts.push(COST_AWARENESS);

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
    // Write a shared episode about this orchestration run
    if (deps.sharedMemoryLoader) {
      try {
        await deps.sharedMemoryLoader.writeEpisode({
          authorAgent: config.role,
          episodeType: 'decision_made',
          summary: output.slice(0, 500),
          detail: { archetype: 'orchestrator', runId: config.id },
          outcome: 'completed',
          confidence: 0.8,
          domains: [this.getDepartment(config.role)],
          tags: ['orchestration'],
        });
      } catch (err) {
        console.warn(`[OrchestratorRunner] Episode write failed for ${config.id}:`, (err as Error).message);
      }

      // Initialize world model if it doesn't exist yet
      try {
        await deps.sharedMemoryLoader.initializeWorldModel?.(config.role);
      } catch (err) {
        console.warn(`[OrchestratorRunner] World model init failed for ${config.role}:`, (err as Error).message);
      }
    }
  }

  private getDepartment(role: CompanyAgentRole): string {
    const map: Record<string, string> = {
      'chief-of-staff': 'operations',
      'vp-research': 'research',
      'cto': 'engineering',
      'clo': 'legal',
      'ops': 'operations',
    };
    return map[role] ?? 'general';
  }

  private buildPersonalityBlock(profile: AgentProfileData): string {
    const parts: string[] = ['## WHO YOU ARE\n'];
    if (profile.personality_summary) parts.push(profile.personality_summary, '');
    if (profile.voice_examples?.length) {
      parts.push('**Voice calibration examples — match this tone:**');
      for (const ex of profile.voice_examples) {
        parts.push(`\nSituation: ${ex.situation}`);
        parts.push(`Response: ${ex.response}`);
      }
      parts.push('');
    }
    if (profile.anti_patterns?.length) {
      parts.push('**THINGS YOU NEVER SAY:**');
      for (const ap of profile.anti_patterns) {
        parts.push(`- Never: "${ap.never}"`);
        parts.push(`  Instead: "${ap.instead}"`);
      }
      parts.push('');
    }
    if (profile.signature) parts.push(`**Sign-off:** ${profile.signature}`);
    return parts.join('\n');
  }
}
