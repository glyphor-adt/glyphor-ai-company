import { readFileSync } from 'node:fs';

type PlanningMode = 'off' | 'auto' | 'required';

interface PlanningPolicyOverrides {
  planningMode?: PlanningMode;
  completionGateEnabled?: boolean;
  planningMaxAttempts?: number;
  completionGateMaxRetries?: number;
  completionGateAutoRepairEnabled?: boolean;
}

interface PlanningPolicyConfig {
  default?: PlanningPolicyOverrides;
  roles?: Record<string, PlanningPolicyOverrides>;
  tasks?: Record<string, PlanningPolicyOverrides>;
}

function usage(exitCode = 1): never {
  console.error(
    'Usage: tsx scripts/planning-policy-validate.ts [--json <json>] [--file <path>] [--env-var <name>]',
  );
  console.error(
    'Examples:\n' +
    '  tsx scripts/planning-policy-validate.ts --json \'{"default":{"planningMode":"auto"}}\'\n' +
    '  tsx scripts/planning-policy-validate.ts --file ./policy.json\n' +
    '  tsx scripts/planning-policy-validate.ts --env-var AGENT_PLANNING_POLICY_JSON',
  );
  process.exit(exitCode);
}

function getArg(argv: string[], flag: string): string | undefined {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseInput(argv: string[]): { source: string; raw: string } {
  if (argv.includes('--help') || argv.includes('-h')) usage(0);

  const json = getArg(argv, '--json');
  const file = getArg(argv, '--file');
  const envVar = getArg(argv, '--env-var');

  const sources = [json ? 'json' : null, file ? 'file' : null, envVar ? 'env' : null].filter(Boolean);
  if (sources.length > 1) {
    throw new Error('Provide only one source: --json OR --file OR --env-var.');
  }

  if (json) return { source: '--json', raw: json };
  if (file) return { source: `--file ${file}`, raw: readFileSync(file, 'utf8') };
  if (envVar) {
    const value = process.env[envVar];
    if (!value || !value.trim()) {
      throw new Error(`Environment variable ${envVar} is empty or unset.`);
    }
    return { source: `env:${envVar}`, raw: value };
  }

  const fallbackVar = 'AGENT_PLANNING_POLICY_JSON';
  const fallbackValue = process.env[fallbackVar];
  if (!fallbackValue || !fallbackValue.trim()) {
    throw new Error(
      `No input provided. Use --json, --file, or --env-var. Fallback env ${fallbackVar} is also unset.`,
    );
  }
  return { source: `env:${fallbackVar}`, raw: fallbackValue };
}

function validateIntRange(
  value: unknown,
  fieldPath: string,
  min: number,
  max: number,
  errors: string[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.floor(value) !== value) {
    errors.push(`${fieldPath} must be an integer.`);
    return;
  }
  if (value < min || value > max) {
    errors.push(`${fieldPath} must be between ${min} and ${max}.`);
  }
}

function validateOverrides(value: unknown, path: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  const allowedKeys = new Set([
    'planningMode',
    'completionGateEnabled',
    'planningMaxAttempts',
    'completionGateMaxRetries',
    'completionGateAutoRepairEnabled',
    'planningModelTier',
    'completionGateVerifyModelTier',
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path}.${key} is not allowed.`);
    }
  }

  if ('planningMode' in value) {
    const mode = value.planningMode;
    if (mode !== 'off' && mode !== 'auto' && mode !== 'required') {
      errors.push(`${path}.planningMode must be one of: off, auto, required.`);
    }
  }
  if ('completionGateEnabled' in value && typeof value.completionGateEnabled !== 'boolean') {
    errors.push(`${path}.completionGateEnabled must be boolean.`);
  }
  if ('planningMaxAttempts' in value) {
    validateIntRange(value.planningMaxAttempts, `${path}.planningMaxAttempts`, 1, 8, errors);
  }
  if ('completionGateMaxRetries' in value) {
    validateIntRange(value.completionGateMaxRetries, `${path}.completionGateMaxRetries`, 0, 8, errors);
  }
  if ('completionGateAutoRepairEnabled' in value && typeof value.completionGateAutoRepairEnabled !== 'boolean') {
    errors.push(`${path}.completionGateAutoRepairEnabled must be boolean.`);
  }
  const modelTiers = new Set(['fast', 'default', 'high']);
  if ('planningModelTier' in value) {
    const t = value.planningModelTier;
    if (typeof t !== 'string' || !modelTiers.has(t)) {
      errors.push(`${path}.planningModelTier must be one of: fast, default, high.`);
    }
  }
  if ('completionGateVerifyModelTier' in value) {
    const t = value.completionGateVerifyModelTier;
    if (typeof t !== 'string' || !modelTiers.has(t)) {
      errors.push(`${path}.completionGateVerifyModelTier must be one of: fast, default, high.`);
    }
  }
}

function validatePolicyConfig(raw: unknown): { ok: true; config: PlanningPolicyConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, errors: ['Root must be a JSON object.'] };
  }

  const allowedRoot = new Set(['default', 'roles', 'tasks']);
  for (const key of Object.keys(raw)) {
    if (!allowedRoot.has(key)) {
      errors.push(`Root key "${key}" is not allowed.`);
    }
  }

  if ('default' in raw && raw.default !== undefined) {
    validateOverrides(raw.default, 'default', errors);
  }

  if ('roles' in raw && raw.roles !== undefined) {
    if (!isObject(raw.roles)) {
      errors.push('roles must be an object.');
    } else {
      for (const [role, overrides] of Object.entries(raw.roles)) {
        validateOverrides(overrides, `roles.${role}`, errors);
      }
    }
  }

  if ('tasks' in raw && raw.tasks !== undefined) {
    if (!isObject(raw.tasks)) {
      errors.push('tasks must be an object.');
    } else {
      for (const [task, overrides] of Object.entries(raw.tasks)) {
        validateOverrides(overrides, `tasks.${task}`, errors);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: raw as PlanningPolicyConfig };
}

function main(): void {
  const { source, raw } = parseInput(process.argv.slice(2));
  const parsed = JSON.parse(raw) as unknown;
  const result = validatePolicyConfig(parsed);
  if (!result.ok) {
    console.error('[planning-policy-validate] Validation failed:');
    for (const err of result.errors) console.error(`- ${err}`);
    process.exitCode = 1;
    return;
  }

  const roleCount = result.config.roles ? Object.keys(result.config.roles).length : 0;
  const taskCount = result.config.tasks ? Object.keys(result.config.tasks).length : 0;
  console.log(`[planning-policy-validate] OK (${source})`);
  console.log(`[planning-policy-validate] sections: default=${result.config.default ? 'yes' : 'no'}, roles=${roleCount}, tasks=${taskCount}`);
}

try {
  main();
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[planning-policy-validate] ${msg}`);
  process.exitCode = 1;
}
