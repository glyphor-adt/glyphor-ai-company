/**
 * Formal Verifier — Deterministic verification gates for critical operations.
 *
 * Pure arithmetic / logic checks that run BEFORE executing tool actions.
 * No AI calls, no DB dependency — deterministic and fast.
 *
 * Checks:
 *  - Arithmetic correctness (safe expression evaluation)
 *  - Dependency-graph acyclicity (DFS)
 *  - Budget constraints
 *  - Schedule overlap / resource conflicts
 *  - Generic invariant assertions
 */

// ─── Types ──────────────────────────────────────────────────────

export interface VerificationResult {
  passed: boolean;
  check: string;
  detail?: string;
}

interface ScheduleItem {
  id: string;
  start: Date | string;
  end: Date | string;
  resource?: string;
}

interface DependencyNode {
  id: string;
  dependsOn: string[];
}

// ─── Safe Arithmetic Parser ─────────────────────────────────────

/**
 * Recursive descent parser for safe arithmetic evaluation.
 * Supports: +, -, *, /, %, (, ), and numeric literals (including decimals and negatives).
 * Does NOT use eval().
 */
function safeEvaluate(expression: string): number {
  const tokens = tokenize(expression);
  let pos = 0;

  function peek(): string | undefined { return tokens[pos]; }
  function consume(): string { return tokens[pos++]; }

  function parseExpression(): number {
    let result = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      result = op === '+' ? result + right : result - right;
    }
    return result;
  }

  function parseTerm(): number {
    let result = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parseFactor();
      if (op === '*') result *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        result /= right;
      } else {
        if (right === 0) throw new Error('Modulo by zero');
        result %= right;
      }
    }
    return result;
  }

  function parseFactor(): number {
    if (peek() === '(') {
      consume(); // '('
      const result = parseExpression();
      if (peek() !== ')') throw new Error('Mismatched parentheses');
      consume(); // ')'
      return result;
    }
    if (peek() === '-') {
      consume();
      return -parseFactor();
    }
    const token = consume();
    const num = Number(token);
    if (isNaN(num)) throw new Error(`Invalid token: ${token}`);
    return num;
  }

  const result = parseExpression();
  if (pos < tokens.length) throw new Error(`Unexpected token: ${tokens[pos]}`);
  return result;
}

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  const re = /(\d+\.?\d*|[+\-*/%()])/g;
  let match;
  while ((match = re.exec(expression)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

// ─── Verifier Class ─────────────────────────────────────────────

export class FormalVerifier {
  /**
   * Verify an arithmetic expression equals the expected result.
   * Uses a safe recursive-descent parser (no eval).
   */
  verifyArithmetic(expression: string, expected: number, tolerance = 0.001): VerificationResult {
    try {
      const actual = safeEvaluate(expression);
      const passed = Math.abs(actual - expected) <= tolerance;
      return {
        passed,
        check: 'arithmetic',
        detail: passed
          ? `${expression} = ${actual} (matches expected ${expected})`
          : `${expression} = ${actual} (expected ${expected}, diff ${Math.abs(actual - expected)})`,
      };
    } catch (err) {
      return {
        passed: false,
        check: 'arithmetic',
        detail: `Failed to evaluate: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Verify a dependency graph has no cycles (DFS-based).
   */
  verifyDependencyGraph(nodes: DependencyNode[]): VerificationResult {
    const graph = new Map<string, string[]>();
    for (const node of nodes) {
      graph.set(node.id, node.dependsOn);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    let cyclePath: string[] | null = null;

    function dfs(id: string, path: string[]): boolean {
      if (inStack.has(id)) {
        cyclePath = [...path, id];
        return true; // cycle found
      }
      if (visited.has(id)) return false;

      visited.add(id);
      inStack.add(id);

      for (const dep of graph.get(id) ?? []) {
        if (dfs(dep, [...path, id])) return true;
      }

      inStack.delete(id);
      return false;
    }

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        if (dfs(node.id, [])) break;
      }
    }

    return {
      passed: cyclePath === null,
      check: 'dependency_graph',
      detail: cyclePath
        ? `Cycle detected: ${cyclePath.join(' → ')}`
        : `No cycles in ${nodes.length} nodes`,
    };
  }

  /**
   * Verify a proposed spend doesn't exceed budget.
   */
  verifyBudgetConstraint(params: {
    proposedSpend: number;
    currentSpend: number;
    budgetLimit: number;
  }): VerificationResult {
    const totalAfter = params.currentSpend + params.proposedSpend;
    const passed = totalAfter <= params.budgetLimit;
    const remaining = params.budgetLimit - params.currentSpend;

    return {
      passed,
      check: 'budget_constraint',
      detail: passed
        ? `$${params.proposedSpend.toFixed(2)} within budget (${remaining.toFixed(2)} remaining)`
        : `$${params.proposedSpend.toFixed(2)} exceeds budget by $${(totalAfter - params.budgetLimit).toFixed(2)}`,
    };
  }

  /**
   * Verify no schedule overlaps (optionally per-resource).
   */
  verifySchedule(items: ScheduleItem[]): VerificationResult {
    const parsed = items.map(item => ({
      ...item,
      start: new Date(item.start).getTime(),
      end: new Date(item.end).getTime(),
    }));

    // Sort by start time
    parsed.sort((a, b) => a.start - b.start);

    const conflicts: string[] = [];

    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i];
        const b = parsed[j];

        // Only check conflicts for same resource (if specified)
        if (a.resource && b.resource && a.resource !== b.resource) continue;

        // Check overlap
        if (a.start < b.end && b.start < a.end) {
          conflicts.push(`${a.id} overlaps with ${b.id}`);
        }
      }
    }

    return {
      passed: conflicts.length === 0,
      check: 'schedule',
      detail: conflicts.length === 0
        ? `No conflicts in ${items.length} items`
        : `${conflicts.length} conflict(s): ${conflicts.slice(0, 3).join('; ')}${conflicts.length > 3 ? '...' : ''}`,
    };
  }

  /**
   * Verify a generic boolean invariant.
   */
  verifyInvariant(description: string, condition: boolean): VerificationResult {
    return {
      passed: condition,
      check: 'invariant',
      detail: `${description}: ${condition ? 'HOLDS' : 'VIOLATED'}`,
    };
  }
}
