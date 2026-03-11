export const ASSIGNMENT_OUTPUT_SCHEMA = {
  name: 'assignment_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      deliverables: {
        type: 'array',
        items: { type: 'string' },
      },
      blockers: {
        type: 'array',
        items: { type: 'string' },
      },
      confidence: { type: 'number' },
    },
    required: ['title', 'summary', 'deliverables', 'blockers', 'confidence'],
  },
} as const;
