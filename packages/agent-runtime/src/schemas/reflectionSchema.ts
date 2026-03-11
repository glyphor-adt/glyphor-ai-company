export const REFLECTION_SCHEMA = {
  name: 'reflection_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      learnings: {
        type: 'array',
        items: { type: 'string' },
      },
      risks: {
        type: 'array',
        items: { type: 'string' },
      },
      confidence: { type: 'number' },
    },
    required: ['summary', 'learnings', 'risks', 'confidence'],
  },
} as const;
