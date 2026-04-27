// Executive agents
export { runChiefOfStaff, type CoSRunParams } from './chief-of-staff/run.js';
export { runCTO, type CTORunParams } from './cto/run.js';
export { runCFO, type CFORunParams } from './cfo/run.js';
export { runCPO, type CPORunParams } from './cpo/run.js';
export { runCMO, type CMORunParams } from './cmo/run.js';
export { runVPDesign, type VPDesignRunParams } from './vp-design/run.js';
export {
  resolveVpDesignWorkerMessage,
  type ResolveVpDesignWorkerMessageInput,
} from './shared/resolveVpDesignWorkerMessage.js';

// Operations
export { runOps, type OpsRunParams } from './ops/run.js';

// Strategy Lab v2 — Research & Intelligence
export { runVPResearch, type VPResearchRunParams } from './vp-research/run.js';

// Additional roles used by certification tests
export { runCLO, type CLORunParams } from './clo/run.js';

// Dynamic agents (DB-defined, no file-based runner)
export { runDynamicAgent, type DynamicAgentRunParams } from './shared/runDynamicAgent.js';

// CZ automation — orchestrator loop (driven by Cloud Scheduler)
export { runCzProtocolLoop } from './chief-of-staff/workflows/czProtocolLoop.js';

// ── System prompt map (keyed by agent role slug) ──
import { CHIEF_OF_STAFF_SYSTEM_PROMPT } from './chief-of-staff/systemPrompt.js';
import { CTO_SYSTEM_PROMPT } from './cto/systemPrompt.js';
import { CFO_SYSTEM_PROMPT } from './cfo/systemPrompt.js';
import { CPO_SYSTEM_PROMPT } from './cpo/systemPrompt.js';
import { CMO_SYSTEM_PROMPT } from './cmo/systemPrompt.js';
import { VP_DESIGN_SYSTEM_PROMPT } from './vp-design/systemPrompt.js';
import { OPS_SYSTEM_PROMPT } from './ops/systemPrompt.js';
import { VP_RESEARCH_SYSTEM_PROMPT } from './vp-research/systemPrompt.js';

export const SYSTEM_PROMPTS: Record<string, string> = {
  'chief-of-staff': CHIEF_OF_STAFF_SYSTEM_PROMPT,
  'cto': CTO_SYSTEM_PROMPT,
  'cfo': CFO_SYSTEM_PROMPT,
  'cpo': CPO_SYSTEM_PROMPT,
  'cmo': CMO_SYSTEM_PROMPT,
  'vp-design': VP_DESIGN_SYSTEM_PROMPT,
  'ops': OPS_SYSTEM_PROMPT,
  'vp-research': VP_RESEARCH_SYSTEM_PROMPT,
};
