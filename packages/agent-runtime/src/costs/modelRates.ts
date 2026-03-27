/**
 * Legacy rate table — kept in sync with SUPPORTED_MODELS in @glyphor/shared/models.
 * Prefer `estimateModelCost` from shared for new code.
 */
export const MODEL_RATES: Record<string, { input: number; output: number; thinking?: number }> = {
  // Anthropic
  'claude-opus-4-6':            { input: 5.00,   output: 25.00 },
  'claude-sonnet-4-6':          { input: 3.00,   output: 15.00 },
  'claude-sonnet-4-5':          { input: 3.00,   output: 15.00 },
  'claude-sonnet-4-20250514':   { input: 3.00,   output: 15.00 },
  'claude-haiku-4-5':           { input: 1.00,   output: 5.00 },
  'claude-haiku-4-5-20251001':  { input: 1.00,   output: 5.00 },
  // OpenAI
  'gpt-5.4':                    { input: 2.50,   output: 15.00 },
  'gpt-5.4-mini':               { input: 0.75,   output: 4.50 },
  'gpt-5.4-nano':               { input: 0.20,   output: 1.25 },
  'gpt-5.2':                    { input: 1.75,   output: 14.00 },
  'gpt-5.1':                    { input: 1.25,   output: 10.00 },
  'gpt-5':                      { input: 1.25,   output: 10.00 },
  'gpt-5-mini':                 { input: 0.25,   output: 2.00 },
  'gpt-5-mini-2025-08-07':      { input: 0.25,   output: 2.00 },
  'gpt-5-nano':                 { input: 0.05,   output: 0.40 },
  'gpt-4.1':                    { input: 2.00,   output: 8.00 },
  'gpt-4.1-mini':               { input: 0.40,   output: 1.60 },
  'gpt-4.1-nano':               { input: 0.10,   output: 0.40 },
  'model-router':               { input: 0.75,   output: 4.50 },
  'o3':                         { input: 2.00,   output: 8.00,   thinking: 8.00 },
  'o4-mini':                    { input: 1.10,   output: 4.40,   thinking: 4.40 },
  // Gemini
  'gemini-3.1-pro-preview':     { input: 2.00,   output: 12.00,  thinking: 12.00 },
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50,  thinking: 1.50 },
  'gemini-3-flash-preview':     { input: 0.50,   output: 3.00,   thinking: 3.00 },
  'gemini-3.1-pro':             { input: 2.00,   output: 12.00,  thinking: 12.00 },
  'gemini-3.1-flash-lite':      { input: 0.25,   output: 1.50 },
  'gemini-3-flash':             { input: 0.50,   output: 3.00 },
  'gemini-2.5-pro':             { input: 1.25,   output: 10.00,  thinking: 10.00 },
  'gemini-2.5-flash':           { input: 0.30,   output: 2.50,   thinking: 2.50 },
  'gemini-2.5-flash-lite':      { input: 0.10,   output: 0.40 },
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
