import type { ClassifiedRunDependencies, CompanyAgentRole, GlyphorEventBus } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import { createRunDeps } from './createRunDeps.js';

/**
 * Sandboxed dependency set for offline evals.
 *
 * Keeps the same read-only knowledge/context loading path as production runs,
 * while stripping mutable side effects like reflection persistence, working
 * memory carryover, pending work pickup, and world-model updates.
 */
export function createEvalRunDeps(
  glyphorEventBus: GlyphorEventBus,
  memory: CompanyMemoryStore,
): ClassifiedRunDependencies {
  const base = createRunDeps(glyphorEventBus, memory);

  return {
    glyphorEventBus: base.glyphorEventBus,
    cache: base.cache,
    jitContextRetriever: base.jitContextRetriever,
    contextDistiller: base.contextDistiller,
    runtimeToolFactory: base.runtimeToolFactory,
    reasoningEngineFactory: base.reasoningEngineFactory,
    constitutionalGovernor: base.constitutionalGovernor,
    agentProfileLoader: base.agentProfileLoader,
    dynamicBriefLoader: base.dynamicBriefLoader,
    collectiveIntelligenceLoader: base.collectiveIntelligenceLoader,
    skillContextLoader: base.skillContextLoader,
    knowledgeBaseLoader: base.knowledgeBaseLoader,
    bulletinLoader: base.bulletinLoader,
    orchestrationConfigLoader: base.orchestrationConfigLoader,
    pendingMessageLoader: async () => [],
    workingMemoryLoader: async () => ({ summary: null, lastRunAt: null }),
    pendingAssignmentLoader: async () => [],
    initializeWorldModel: async (_role: CompanyAgentRole) => {},
  };
}
