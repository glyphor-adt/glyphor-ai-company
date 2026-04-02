export interface ExecutionPlan {
  objective?: string;
  acceptanceCriteria: string[];
  executionSteps: string[];
  verificationSteps: string[];
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueNonEmpty(
    value.map((entry) => (typeof entry === 'string' ? entry : '')).filter(Boolean),
  );
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const directCandidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
  ];
  for (const candidate of directCandidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // best-effort fallback below
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!objectMatch) return null;
  try {
    const parsed = JSON.parse(objectMatch[0]) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseExecutionPlan(text: string): ExecutionPlan | null {
  const parsed = tryParseJsonObject(text);
  if (!parsed) return null;

  const acceptanceCriteria = parseStringArray(
    parsed.acceptance_criteria ?? parsed.acceptanceCriteria ?? parsed.criteria,
  );
  const executionSteps = parseStringArray(
    parsed.execution_steps ?? parsed.executionSteps ?? parsed.steps,
  );
  const verificationSteps = parseStringArray(
    parsed.verification_steps ?? parsed.verificationSteps ?? parsed.validation_steps,
  );
  const objective = typeof parsed.objective === 'string' ? parsed.objective.trim() : undefined;

  if (acceptanceCriteria.length === 0) return null;

  return {
    objective: objective && objective.length > 0 ? objective : undefined,
    acceptanceCriteria,
    executionSteps,
    verificationSteps,
  };
}

export function extractAcceptanceCriteriaFromMessage(message: string): string[] {
  const lines = message.split(/\r?\n/);
  const collected: string[] = [];
  let inCriteriaSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inCriteriaSection && collected.length > 0) break;
      continue;
    }
    if (/^acceptance criteria[:\s]*$/i.test(line) || /^done criteria[:\s]*$/i.test(line)) {
      inCriteriaSection = true;
      continue;
    }
    if (!inCriteriaSection) continue;
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (bulletMatch?.[1]) {
      collected.push(bulletMatch[1]);
      continue;
    }
    if (numberedMatch?.[1]) {
      collected.push(numberedMatch[1]);
      continue;
    }
    if (collected.length > 0) break;
  }

  return uniqueNonEmpty(collected);
}
