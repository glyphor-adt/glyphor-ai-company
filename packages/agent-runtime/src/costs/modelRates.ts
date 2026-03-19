/**
 * Model rate configuration — USD per 1M tokens.
 *
 * Update here only — never hardcode rates elsewhere.
 * For full cost estimation with cached-input discount, use
 * `estimateModelCost` from `@glyphor/shared/models`.
 */

export const MODEL_RATES: Record<string, { input: number; output: number; thinking?: number }> = {
  'claude-opus-4-6':            { input: 15.00,  output: 75.00,  thinking: 75.00 },
  'claude-sonnet-4-6':          { input: 3.00,   output: 15.00 },
  'claude-sonnet-4-20250514':   { input: 3.00,   output: 15.00 },
  'claude-haiku-4-5-20251001':  { input: 0.80,   output: 4.00 },
  'gpt-5.4':                    { input: 10.00,  output: 30.00 },
  'gpt-5':                      { input: 2.50,   output: 10.00 },
  'gpt-5-mini':                 { input: 0.40,   output: 1.60 },
  'gpt-4.1':                    { input: 2.00,   output: 8.00 },
  'gpt-4.1-mini':               { input: 0.40,   output: 1.60 },
  'gpt-4.1-nano':               { input: 0.10,   output: 0.40 },
  'gpt-5-nano':                 { input: 0.10,   output: 0.40 },
  'gemini-3.1-pro':             { input: 1.25,   output: 5.00 },
  'gemini-3.1-flash-lite':      { input: 0.075,  output: 0.30 },
  'gemini-3-flash':             { input: 0.075,  output: 0.30 },
};

export function calculateLlmCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  thinkingTokens = 0,
): number {
  const rates = MODEL_RATES[model];
  if (!rates) return 0;
  return (
    (inputTokens   * rates.input   / 1_000_000) +
    (outputTokens  * rates.output  / 1_000_000) +
    (thinkingTokens * (rates.thinking ?? rates.output) / 1_000_000)
  );
}
