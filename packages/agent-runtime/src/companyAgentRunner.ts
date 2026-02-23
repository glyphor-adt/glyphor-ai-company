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
import { extractReasoning } from './reasoning.js';
import type { GlyphorEventBus } from './glyphorEventBus.js';
import type {
  AgentConfig,
  AgentEvent,
  AgentExecutionResult,
  AgentMemory,
  AgentReflection,
  CompanyAgentRole,
  ConversationTurn,
  IMemoryBus,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROLE_TO_BRIEF: Record<CompanyAgentRole, string> = {
  'chief-of-staff': 'sarah-chen',
  'cto': 'marcus-reeves',
  'cfo': 'nadia-okafor',
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
  'ops': 'atlas-vega',
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
}

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

const CONVERSATION_MODE = `## Conversation Mode Detection

Read the tone and intent of each message before responding.

- **Casual messages** (greetings, small talk, quick check-ins like "hello", "hey", "what's up", "how's it going"): Respond naturally and conversationally. Be yourself — warm, brief, human. Do NOT run the full reasoning protocol, do NOT deliver a briefing, do NOT use tools unless asked.
- **Task messages** (requests for content, reports, analysis, decisions): Follow your full reasoning protocol and methodology.
- **Ambiguous messages**: Default to conversational. Ask what they need rather than assuming they want a full report.

When in doubt, match the energy of the message you received.`;

const REASONING_PROTOCOL = `## How You Think

Follow this protocol for task-oriented requests (not casual conversation):

1. **Orient** — What is the current situation? What data do I have? What's changed since my last run?
2. **Plan** — What are my objectives this run? What tools do I need? What's the priority order?
3. **Execute** — Take action using your tools. Gather data, analyze, produce outputs.
4. **Reflect** — Did I accomplish my objectives? What should I remember for next time?

When you encounter ambiguity, make your best judgment and note the assumption. When you lack data, use the tools available to gather it before speculating. When multiple approaches exist, choose the one most aligned with company goals.`;

function buildPersonalityBlock(profile: AgentProfileData): string {
  const parts: string[] = ['## WHO YOU ARE\n'];

  if (profile.personality_summary) {
    parts.push(profile.personality_summary);
    parts.push('');
  }

  if (profile.backstory) {
    parts.push(`**Backstory:** ${profile.backstory}`);
    parts.push('');
  }

  if (profile.communication_traits?.length) {
    parts.push('**Communication style:**');
    for (const t of profile.communication_traits) parts.push(`- ${t}`);
    parts.push('');
  }

  if (profile.quirks?.length) {
    parts.push('**Quirks (use these — they make you YOU):**');
    for (const q of profile.quirks) parts.push(`- ${q}`);
    parts.push('');
  }

  // Tone guidance
  const formality = profile.tone_formality ?? 0.5;
  const emoji = profile.emoji_usage ?? 0.1;
  const verbosity = profile.verbosity ?? 0.5;
  parts.push('**Voice calibration:**');
  parts.push(`- Formality: ${formality < 0.3 ? 'casual and warm' : formality < 0.7 ? 'professional but approachable' : 'formal and precise'} (${formality})`);
  parts.push(`- Emoji usage: ${emoji < 0.2 ? 'rarely' : emoji < 0.5 ? 'occasionally' : 'frequently'} (${emoji})`);
  parts.push(`- Verbosity: ${verbosity < 0.3 ? 'terse — say it in fewer words' : verbosity < 0.7 ? 'balanced' : 'detailed — explain your reasoning'} (${verbosity})`);
  parts.push('');

  if (profile.signature) {
    parts.push(`**Signature sign-off:** ${profile.signature}`);
    parts.push('');
  }

  if (profile.voice_sample) {
    parts.push('**Voice sample (this is how you sound):**');
    parts.push(`> ${profile.voice_sample}`);
    parts.push('');
  }

  // Voice calibration examples (few-shot)
  if (profile.voice_examples?.length) {
    parts.push('**Voice calibration examples — match this tone:**');
    for (const ex of profile.voice_examples) {
      parts.push(`\nSituation: ${ex.situation}`);
      parts.push(`Response: ${ex.response}`);
    }
    parts.push('');
  }

  // Anti-patterns
  parts.push('**ANTI-PATTERNS — never do these:**');
  for (const ap of ANTI_PATTERNS) parts.push(`- ${ap}`);

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
      for (const f of skill.failure_modes) parts.push(`- ⚠️ ${f}`);
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
): string {
  try {
    const knowledgeDir = join(__dirname, '../../company-knowledge');

    // Load compact core (shared by all agents)
    let knowledgeBase: string;
    try {
      knowledgeBase = readFileSync(join(knowledgeDir, 'CORE.md'), 'utf-8');
    } catch {
      // Fall back to full KB if CORE.md doesn't exist yet
      knowledgeBase = readFileSync(join(knowledgeDir, 'COMPANY_KNOWLEDGE_BASE.md'), 'utf-8');
    }

    // Load department-specific context
    const contextFiles = ROLE_CONTEXT_FILES[role] ?? [];
    for (const file of contextFiles) {
      try {
        const ctx = readFileSync(join(knowledgeDir, 'context', file), 'utf-8');
        knowledgeBase += '\n\n---\n\n' + ctx;
      } catch {
        // Context file missing — not critical
      }
    }

    const briefId = ROLE_TO_BRIEF[role];
    let roleBrief: string;
    if (briefId) {
      roleBrief = readFileSync(
        join(__dirname, `../../company-knowledge/briefs/${briefId}.md`), 'utf-8',
      );
    } else if (dynamicBrief) {
      roleBrief = dynamicBrief;
    } else {
      roleBrief = '';
    }

    // PERSONALITY-FIRST prompt ordering:
    // 1. Who you are (personality, voice, quirks)
    // 2. Reasoning protocol
    // 3. What you do (role brief + agent-specific instructions)
    // 4. Where you work (company knowledge base)
    const parts: string[] = [];

    if (profile) {
      parts.push(buildPersonalityBlock(profile));
    }

    parts.push(CONVERSATION_MODE);
    parts.push(REASONING_PROTOCOL);

    // Inject skill methodology if skills are active for this run
    if (skillContext && skillContext.skills.length > 0) {
      parts.push(buildSkillBlock(skillContext));
    }

    if (roleBrief) parts.push(roleBrief);
    parts.push(existingPrompt);
    parts.push(knowledgeBase);

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
    const history: ConversationTurn[] = [
      { role: 'user', content: initialMessage, timestamp: Date.now() },
    ];
    let lastTextOutput: string | null = null;

    emitEvent({
      type: 'agent_started',
      agentId: config.id,
      role: config.role,
      model: config.model,
    });

    // ─── PARALLEL PRE-RUN DATA LOADING ────────────────────────
    // Load memories, dynamic brief, pending messages, CI context,
    // and agent profile all in parallel to minimize latency.
    let dynamicBrief: string | undefined;
    let agentProfile: AgentProfileData | null = null;
    let skillContext: SkillContext | null = null;

    {
      // Memory retrieval (3 sub-fetches already parallelized internally)
      const memoryPromise = deps?.agentMemoryStore
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

      // Dynamic brief
      const briefPromise = (!ROLE_TO_BRIEF[config.role] && deps?.dynamicBriefLoader)
        ? deps.dynamicBriefLoader(config.id).catch(err => {
            console.warn(`[CompanyAgentRunner] Dynamic brief load failed for ${config.id}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Pending inter-agent messages
      const messagesPromise = deps?.pendingMessageLoader
        ? deps.pendingMessageLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Pending message load failed for ${config.role}:`, (err as Error).message);
            return [] as { id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[];
          })
        : Promise.resolve([] as { id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[]);

      // Collective Intelligence (pulse + org knowledge + inbox)
      const ciPromise = deps?.collectiveIntelligenceLoader
        ? deps.collectiveIntelligenceLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Collective intelligence load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Agent personality profile
      const profilePromise = deps?.agentProfileLoader
        ? deps.agentProfileLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Profile load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Working memory (last-run summary for continuity between runs)
      const workingMemoryPromise = deps?.workingMemoryLoader
        ? deps.workingMemoryLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Working memory load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Skill context (matched skills for this task)
      const skillPromise = deps?.skillContextLoader
        ? deps.skillContextLoader(config.role, initialMessage).catch(err => {
            console.warn(`[CompanyAgentRunner] Skill context load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      const [memoryResult, briefResult, pendingMessages, ciContext, profileResult, workingMemory, skillResult] = await Promise.all([
        memoryPromise,
        briefPromise,
        messagesPromise,
        ciPromise,
        profilePromise,
        workingMemoryPromise,
        skillPromise,
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

      // Inject CI context
      if (ciContext) {
        history.push({
          role: 'user',
          content: ciContext,
          timestamp: Date.now(),
        });
      }

      // Inject working memory (last-run summary)
      if (workingMemory?.summary) {
        const ago = workingMemory.lastRunAt
          ? formatTimeAgo(new Date(workingMemory.lastRunAt))
          : 'unknown time';
        history.push({
          role: 'user',
          content: `## Working Memory\nYour last run was ${ago} ago. Here is what you accomplished:\n\n${workingMemory.summary}\n\nUse this context to build on your previous work and avoid repeating completed tasks.`,
          timestamp: Date.now(),
        });
      }

      // Set profile
      agentProfile = profileResult;

      // Set skill context
      skillContext = skillResult;
    }

    try {
      let turnNumber = 0;

      while (true) {
        turnNumber++;
        emitEvent({ type: 'turn_started', agentId: config.id, turnNumber });

        // 1. SUPERVISOR CHECK
        const check = supervisor.checkBeforeModelCall();
        if (!check.ok) {
          return this.buildResult(
            config, 'aborted', lastTextOutput, history, supervisor, check.reason,
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

          const systemPrompt = buildSystemPrompt(config.role, config.systemPrompt, dynamicBrief, agentProfile, skillContext);

          response = await this.modelClient.generate({
            model: config.model,
            systemInstruction: systemPrompt,
            contents: history,
            tools: toolExecutor.getDeclarations(),
            temperature: config.temperature,
            topP: config.topP,
            topK: config.topK,
            thinkingEnabled: config.thinkingEnabled,
            signal: supervisor.signal,
          });

          emitEvent({
            type: 'model_response',
            agentId: config.id,
            turnNumber,
            hasToolCalls: response.toolCalls.length > 0,
            thinkingText: response.thinkingText,
          });
        } catch (error) {
          if (supervisor.isAborted) {
            return this.buildResult(
              config, 'aborted', lastTextOutput, history, supervisor,
              (error as Error).message,
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
              return this.buildResult(
                config, 'aborted', lastTextOutput, history, supervisor,
                progressCheck.reason,
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
      if (deps?.agentMemoryStore && lastTextOutput) {
        const isOnDemand = config.id.includes('on_demand');
        const reflectFn = async () => {
          try {
            await this.reflectOnRun(config, history, lastTextOutput!, deps.agentMemoryStore!, deps?.knowledgeRouter, deps?.graphWriter, deps?.skillFeedbackWriter, skillContext);
          } catch (err) {
            console.warn(
              `[CompanyAgentRunner] Reflection failed for ${config.id}:`,
              (err as Error).message,
            );
          }
        };
        if (isOnDemand) {
          // Fire-and-forget for chat — don't block the user response
          reflectFn();
        } else {
          await reflectFn();
        }
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

      return this.buildResult(config, 'completed', lastTextOutput, history, supervisor);

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

      return this.buildResult(
        config,
        supervisor.isAborted ? 'aborted' : 'error',
        lastTextOutput,
        history,
        supervisor,
        (error as Error).message,
      );
    }
  }

  private buildResult(
    config: AgentConfig,
    status: AgentExecutionResult['status'],
    output: string | null,
    history: ConversationTurn[],
    supervisor: AgentSupervisor,
    errorMsg?: string,
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
    const systemPrompt = buildSystemPrompt(config.role, config.systemPrompt);

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

    const reflectHistory: ConversationTurn[] = [
      ...history.slice(-4),
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
      for (const mem of memories.slice(0, 5)) {
        await saveFn({
          agentRole: config.role,
          memoryType: mem.type ?? 'observation',
          content: mem.content ?? '',
          importance: Math.max(0, Math.min(1, mem.importance ?? 0.5)),
          sourceRunId: config.id,
        });
      }

      console.log(
        `[CompanyAgentRunner] Reflection saved for ${config.id}: score=${parsed.qualityScore}, memories=${memories.length}`,
      );

      // Process knowledge graph operations
      if (graphWriter && parsed.graph_operations) {
        try {
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
        } catch (graphErr) {
          console.warn(
            `[CompanyAgentRunner] Graph ops failed for ${config.id}:`,
            (graphErr as Error).message,
          );
        }
      }

      // Save working memory (last-run summary for next run's context)
      if (store.saveLastRunSummary && parsed.summary) {
        try {
          await store.saveLastRunSummary(config.role, parsed.summary);
        } catch {
          // Non-critical — skip silently
        }
      }

      // Update growth metrics for dashboard GrowthAreas component
      if (store.updateGrowthMetrics) {
        try {
          await store.updateGrowthMetrics(config.role);
        } catch {
          // Non-critical — skip silently
        }
      }

      // Route new knowledge to relevant agents via the CI system
      if (knowledgeRouter && memories.length > 0) {
        try {
          for (const mem of memories.slice(0, 5)) {
            if (mem.type === 'learning' || mem.type === 'fact') {
              const tags = mem.tags ?? [];
              await knowledgeRouter({
                agent_id: config.role,
                content: mem.content ?? '',
                tags,
                knowledge_type: mem.type,
              });
            }
          }
        } catch (routeErr) {
          console.warn(
            `[CompanyAgentRunner] Knowledge routing failed for ${config.id}:`,
            (routeErr as Error).message,
          );
        }
      }

      // Save peer feedback
      const peerFeedback = parsed.peerFeedback ?? [];
      if (peerFeedback.length > 0 && store.savePeerFeedback) {
        for (const fb of peerFeedback.slice(0, 3)) {
          try {
            await store.savePeerFeedback({
              fromAgent: config.role,
              toAgent: fb.toAgent,
              feedback: fb.feedback,
              context: config.id,
              sentiment: fb.sentiment ?? 'neutral',
            });
          } catch {
            // Non-critical — skip silently
          }
        }
      }

      // Update skill proficiency and learnings from reflection
      const skillFeedbackItems: SkillFeedback[] = parsed.skill_feedback ?? [];
      if (skillFeedbackItems.length > 0 && skillFeedbackWriter) {
        try {
          await skillFeedbackWriter(config.role, skillFeedbackItems.slice(0, 5));
          console.log(
            `[CompanyAgentRunner] Skill feedback saved for ${config.id}: ${skillFeedbackItems.length} skills`,
          );
        } catch (skillErr) {
          console.warn(
            `[CompanyAgentRunner] Skill feedback failed for ${config.id}:`,
            (skillErr as Error).message,
          );
        }
      }
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
    parts.push('### 🔴 URGENT');
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

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
