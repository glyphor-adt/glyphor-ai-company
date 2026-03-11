export const EVALUATION_SCHEMA = {
  name: 'evaluation_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      verdict: {
        type: 'string',
        enum: ['accept', 'revise', 'reject'],
      },
      qualityScore: { type: 'number' },
      feedback: { type: 'string' },
      evidence: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['verdict', 'qualityScore', 'feedback', 'evidence'],
  },
} as const;
