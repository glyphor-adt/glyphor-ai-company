/**
 * Constitutional Pre-Check — Pre-execution gates for high-stakes tool calls.
 *
 * Two-phase check:
 *   Phase 1: Deterministic regex/pattern checks (zero LLM cost)
 *   Phase 2: Principle-based LLM check for external-facing tools only
 *
 * Runs before the tool executor dispatches the call. Any 'block' violation
 * prevents execution; 'warning' violations are logged but allowed through.
 */

import { createHash } from 'node:crypto';
import type { ModelClient } from './modelClient.js';
import type { RedisCache } from './redisCache.js';
import type { Constitution } from './constitutionalGovernor.js';
import { AGENT_EMAIL_MAP, FOUNDER_EMAILS } from './config/agentEmails.js';
import { systemQuery } from '@glyphor/shared/db';

// ─── Constants ──────────────────────────────────────────────────

/** Economy-tier model for LLM-based principle checks. */
const PRE_CHECK_MODEL = 'gemini-2.5-flash-lite';

/** Cache TTL for LLM-based pre-check results (5 minutes). */
const PRE_CHECK_CACHE_TTL = 300;

/** Tools that require pre-execution constitutional screening. */
export const HIGH_STAKES_TOOLS = new Set([
  'send_email',
  'reply_to_email',
  'create_or_update_file',
  'create_branch',
  'register_tool',
  'create_specialist_agent',
  'grant_tool_access',
  'submit_assignment_output',
]);

/** Tools that are externally visible and require LLM principle checks. */
const EXTERNAL_COMMUNICATION_TOOLS = new Set([
  'send_email',
  'reply_to_email',
  'submit_assignment_output',
]);

// ─── Agent name patterns for information leak detection ─────────

const AGENT_DISPLAY_NAMES = Object.values(AGENT_EMAIL_MAP).map(e => e.displayName);
const AGENT_ROLES = Object.keys(AGENT_EMAIL_MAP);
const FOUNDER_NAMES = Object.keys(FOUNDER_EMAILS);

// Build regex to detect agent identity leaks (agent names, role slugs, system references)
const AGENT_NAME_PATTERN = new RegExp(
  AGENT_DISPLAY_NAMES
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
  'i',
);

const SYSTEM_DETAIL_PATTERN = /\b(agent[_-]?runtime|tool[_-]?executor|constitutional[_-]?governor|reasoning[_-]?engine|work[_-]?loop|gemini[_-]?\d|model[_-]?client|redis[_-]?cache|system[_-]?prompt)\b/i;

const UNSUBSTANTIATED_CLAIMS_PATTERN = /\b(guarantee|(?<!no\s)promise|SLA|99\.\d+%|100%\s*(?:uptime|availability|accuracy|success))\b/i;

/** Blocked external recipient patterns. */
const BLOCKED_RECIPIENT_PATTERNS = [
  /.*@competitor\.com$/i,
  /^(spam|abuse|postmaster)@/i,
];

/** Feature branch naming convention for agent file modifications. */
const AGENT_BRANCH_PATTERN = /^feature\/agent-/;

/** Budget-related patterns that agents must not modify. */
const BUDGET_MODIFICATION_PATTERN = /\b(AGENT_BUDGETS|perRunUsd|dailyUsd|monthlyUsd|budget[_-]?cap|spending[_-]?limit)\b/i;

/** Founder names that agents must not impersonate. */
const FOUNDER_NAME_PATTERN = new RegExp(
  FOUNDER_NAMES.map(n => `^${n}$`).join('|'),
  'i',
);

/** Internal/sensitive URL patterns for tool registration. */
const SENSITIVE_URL_PATTERNS = [
  /^https?:\/\/(localhost|127\.0\.0\.\d|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)/i,
  /\.(internal|local|corp|private)\b/i,
  /metadata\.google\.internal/i,
  /169\.254\.169\.254/,
];

// ─── Types ──────────────────────────────────────────────────────

export interface ConstitutionalPreCheckViolation {
  principle_id: string;
  principle_category: string;
  description: string;
  severity: 'warning' | 'block';
}

export interface ConstitutionalPreCheckResult {
  allowed: boolean;
  violations: ConstitutionalPreCheckViolation[];
  check_duration_ms: number;
}

// ─── LLM Prompt ─────────────────────────────────────────────────

const PRE_CHECK_SYSTEM_PROMPT = `You are a constitutional pre-check evaluator. Given an agent's intended tool call and a set of constitutional principles, determine if the action violates any principle.

Focus on:
- Communication appropriateness (tone, claims, information leaks)
- Risk level of the action
- Alignment with the agent's role and principles

Respond ONLY with JSON, no markdown fences:
{
  "violations": [
    {
      "principle_id": "...",
      "principle_category": "...",
      "description": "brief explanation of violation",
      "severity": "warning" | "block"
    }
  ]
}

If no violations, return: { "violations": [] }
Use "block" severity only for clear, serious violations. Use "warning" for borderline concerns.`;

// ─── Phase 1: Deterministic Checks ─────────────────────────────

function checkEmailTool(
  toolName: string,
  params: Record<string, unknown>,
): ConstitutionalPreCheckViolation[] {
  const violations: ConstitutionalPreCheckViolation[] = [];

  const body = String(params.body ?? params.content ?? params.message ?? '');
  const recipient = String(params.to ?? params.recipient ?? '');

  // Check for agent name leaks in email body
  if (AGENT_NAME_PATTERN.test(body)) {
    const match = body.match(AGENT_NAME_PATTERN);
    violations.push({
      principle_id: 'precheck-no-agent-names',
      principle_category: 'communication',
      description: `Email body contains internal agent name "${match?.[0]}". Remove agent identities from external communications.`,
      severity: 'block',
    });
  }

  // Check for system detail leaks
  if (SYSTEM_DETAIL_PATTERN.test(body)) {
    const match = body.match(SYSTEM_DETAIL_PATTERN);
    violations.push({
      principle_id: 'precheck-no-system-details',
      principle_category: 'communication',
      description: `Email body contains system implementation detail "${match?.[0]}". Do not expose internal architecture.`,
      severity: 'block',
    });
  }

  // Check for unsubstantiated claims
  if (UNSUBSTANTIATED_CLAIMS_PATTERN.test(body)) {
    const match = body.match(UNSUBSTANTIATED_CLAIMS_PATTERN);
    violations.push({
      principle_id: 'precheck-no-unsubstantiated-claims',
      principle_category: 'ethical',
      description: `Email body contains potentially unsubstantiated claim "${match?.[0]}". Verify before sending.`,
      severity: 'warning',
    });
  }

  // Check recipient against blocked patterns
  if (recipient) {
    for (const pattern of BLOCKED_RECIPIENT_PATTERNS) {
      if (pattern.test(recipient)) {
        violations.push({
          principle_id: 'precheck-blocked-recipient',
          principle_category: 'risk_management',
          description: `Recipient "${recipient}" matches a blocked pattern. This email cannot be sent.`,
          severity: 'block',
        });
        break;
      }
    }
  }

  return violations;
}

function checkFileCreateTool(
  params: Record<string, unknown>,
): ConstitutionalPreCheckViolation[] {
  const violations: ConstitutionalPreCheckViolation[] = [];

  const branch = String(params.branch ?? '');
  const content = String(params.content ?? params.file_content ?? '');

  // Verify branch follows feature/agent-* pattern (if branch is specified)
  if (branch && !AGENT_BRANCH_PATTERN.test(branch)) {
    violations.push({
      principle_id: 'precheck-branch-naming',
      principle_category: 'technical_accuracy',
      description: `Branch "${branch}" does not follow the required "feature/agent-*" naming pattern.`,
      severity: 'block',
    });
  }

  // Check content doesn't modify budget caps
  if (BUDGET_MODIFICATION_PATTERN.test(content)) {
    violations.push({
      principle_id: 'precheck-no-budget-modification',
      principle_category: 'financial_prudence',
      description: 'File content appears to modify budget caps or spending limits. Budget changes require human approval.',
      severity: 'block',
    });
  }

  return violations;
}

function checkCreateSpecialistAgent(
  params: Record<string, unknown>,
): ConstitutionalPreCheckViolation[] {
  const violations: ConstitutionalPreCheckViolation[] = [];

  const agentName = String(params.name ?? params.agent_name ?? '');

  // Verify agent name doesn't impersonate founders
  if (FOUNDER_NAME_PATTERN.test(agentName.trim())) {
    violations.push({
      principle_id: 'precheck-no-founder-impersonation',
      principle_category: 'ethical',
      description: `Agent name "${agentName}" impersonates a company founder. Choose a different name.`,
      severity: 'block',
    });
  }

  return violations;
}

function checkRegisterTool(
  params: Record<string, unknown>,
): ConstitutionalPreCheckViolation[] {
  const violations: ConstitutionalPreCheckViolation[] = [];

  const url = String(params.url ?? params.endpoint ?? params.api_url ?? '');

  for (const pattern of SENSITIVE_URL_PATTERNS) {
    if (pattern.test(url)) {
      violations.push({
        principle_id: 'precheck-no-internal-endpoints',
        principle_category: 'risk_management',
        description: `Tool URL "${url}" points to an internal or sensitive endpoint. External tools must use public endpoints.`,
        severity: 'block',
      });
      break;
    }
  }

  return violations;
}

/** Phase 1: Run all deterministic checks for a tool call. */
function runDeterministicChecks(
  toolName: string,
  toolParams: Record<string, unknown>,
): ConstitutionalPreCheckViolation[] {
  switch (toolName) {
    case 'send_email':
    case 'reply_to_email':
      return checkEmailTool(toolName, toolParams);

    case 'create_or_update_file':
      return checkFileCreateTool(toolParams);

    case 'create_specialist_agent':
      return checkCreateSpecialistAgent(toolParams);

    case 'register_tool':
      return checkRegisterTool(toolParams);

    default:
      return [];
  }
}

// ─── Phase 2: LLM Principle Check ──────────────────────────────

function buildPreCheckCacheKey(
  agentRole: string,
  toolParams: Record<string, unknown>,
): string {
  const hash = createHash('md5')
    .update(JSON.stringify(toolParams))
    .digest('hex');
  return `constitutionalPreCheck:${agentRole}:${hash}`;
}

async function runLlmPrincipleCheck(
  agentRole: string,
  toolName: string,
  toolParams: Record<string, unknown>,
  constitution: Constitution,
  modelClient: ModelClient,
  cache: RedisCache | null,
): Promise<ConstitutionalPreCheckViolation[]> {
  // Only run LLM checks for externally-visible tools
  if (!EXTERNAL_COMMUNICATION_TOOLS.has(toolName)) return [];

  // Skip if no principles to check against
  if (!constitution.principles || constitution.principles.length === 0) return [];

  // Check cache first
  const cacheKey = buildPreCheckCacheKey(agentRole, toolParams);
  if (cache) {
    const cached = await cache.get<ConstitutionalPreCheckViolation[]>(cacheKey);
    if (cached) return cached;
  }

  const userPrompt = [
    `AGENT ROLE: ${agentRole}`,
    `TOOL: ${toolName}`,
    `PARAMETERS: ${JSON.stringify(toolParams, null, 2)}`,
    '',
    'CONSTITUTIONAL PRINCIPLES:',
    ...constitution.principles.map(
      (p, i) => `${i + 1}. [${p.id}] (category: ${p.category}, weight: ${p.weight}) ${p.text}`,
    ),
  ].join('\n');

  try {
    const response = await modelClient.generate({
      model: PRE_CHECK_MODEL,
      systemInstruction: PRE_CHECK_SYSTEM_PROMPT,
      contents: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
      temperature: 0.1,
      maxTokens: 400,
    });

    let parsed: { violations?: ConstitutionalPreCheckViolation[] };
    try {
      parsed = JSON.parse(response.text ?? '{}');
    } catch {
      parsed = {};
    }

    const violations = (parsed.violations ?? []).filter(
      v => v.principle_id && v.severity && v.description,
    );

    // Cache the result
    if (cache) {
      await cache.set(cacheKey, violations, PRE_CHECK_CACHE_TTL);
    }

    return violations;
  } catch (err) {
    // LLM failure is non-blocking — log and continue without LLM check
    console.warn('[ConstitutionalPreCheck] LLM check failed, proceeding without:', (err as Error).message);
    return [];
  }
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Pre-check a high-stakes tool call against constitutional principles.
 *
 * Phase 1: Deterministic regex/pattern checks (zero LLM cost).
 * Phase 2: LLM principle check for external communication tools.
 *
 * Returns `allowed: false` if any 'block' violation is found.
 */
export async function preCheckTool(
  agentRole: string,
  toolName: string,
  toolParams: Record<string, unknown>,
  constitution: Constitution,
  options?: { redisCache?: RedisCache | null; modelClient?: ModelClient | null; runId?: string },
): Promise<ConstitutionalPreCheckResult> {
  const start = Date.now();

  // Phase 1: Deterministic checks
  const deterministicViolations = runDeterministicChecks(toolName, toolParams);

  // Phase 2: LLM principle check (only for external communication tools)
  let llmViolations: ConstitutionalPreCheckViolation[] = [];
  if (options?.modelClient) {
    llmViolations = await runLlmPrincipleCheck(
      agentRole,
      toolName,
      toolParams,
      constitution,
      options.modelClient,
      options.redisCache ?? null,
    );
  }

  const allViolations = [...deterministicViolations, ...llmViolations];
  const hasBlock = allViolations.some(v => v.severity === 'block');
  const durationMs = Date.now() - start;

  // Log warnings
  const warnings = allViolations.filter(v => v.severity === 'warning');
  if (warnings.length > 0) {
    console.warn(
      `[ConstitutionalPreCheck] ${warnings.length} warning(s) for ${agentRole}/${toolName}:`,
      warnings.map(w => w.description).join('; '),
    );
  }

  // Fire-and-forget: record gate events for audit trail & trust scoring
  const result = hasBlock ? 'blocked' : allViolations.length > 0 ? 'warned' : 'passed';
  try {
    // Record deterministic phase
    systemQuery(
      `INSERT INTO constitutional_gate_events (run_id, agent_role, tool_name, check_phase, result, violations, cost_usd, duration_ms)
       VALUES ($1, $2, $3, 'deterministic', $4, $5, 0, $6)`,
      [
        options?.runId ?? null,
        agentRole,
        toolName,
        deterministicViolations.length > 0 ? (deterministicViolations.some(v => v.severity === 'block') ? 'blocked' : 'warned') : 'passed',
        JSON.stringify(deterministicViolations.length > 0 ? deterministicViolations : null),
        durationMs,
      ],
    ).catch(err => console.warn('[ConstitutionalPreCheck] Failed to log deterministic gate event:', (err as Error).message));

    // Record LLM phase if it ran
    if (llmViolations.length > 0 || (options?.modelClient && EXTERNAL_COMMUNICATION_TOOLS.has(toolName))) {
      systemQuery(
        `INSERT INTO constitutional_gate_events (run_id, agent_role, tool_name, check_phase, result, violations, cost_usd, duration_ms)
         VALUES ($1, $2, $3, 'principle_llm', $4, $5, $6, $7)`,
        [
          options?.runId ?? null,
          agentRole,
          toolName,
          llmViolations.length > 0 ? (llmViolations.some(v => v.severity === 'block') ? 'blocked' : 'warned') : 'passed',
          JSON.stringify(llmViolations.length > 0 ? llmViolations : null),
          0,
          durationMs,
        ],
      ).catch(err => console.warn('[ConstitutionalPreCheck] Failed to log LLM gate event:', (err as Error).message));
    }
  } catch (err) {
    console.warn('[ConstitutionalPreCheck] Failed to log gate events:', (err as Error).message);
  }

  return {
    allowed: !hasBlock,
    violations: allViolations,
    check_duration_ms: durationMs,
  };
}
