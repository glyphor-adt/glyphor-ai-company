/**
 * Memory Namespaces — Key organization for company memory
 *
 * All agents use these namespaces when reading/writing shared memory.
 * Prevents key collisions and provides a browsable hierarchy.
 */

export const NAMESPACES = {
  // Company-level context
  company: {
    vision: 'company.vision',
    mission: 'company.mission',
    values: 'company.values',
    okrs: (quarter: string) => `company.okrs.${quarter}` as const,
    founders: 'company.founders',
  },

  // Product-level context
  product: {
    profile: (slug: string) => `product.${slug}.profile` as const,
    roadmap: (slug: string) => `product.${slug}.roadmap` as const,
    metrics: (slug: string) => `product.${slug}.metrics` as const,
    techStack: (slug: string) => `product.${slug}.tech_stack` as const,
  },

  // Agent-level context
  agent: {
    config: (role: string) => `agent.${role}.config` as const,
    lastOutput: (role: string) => `agent.${role}.last_output` as const,
    strategy: (role: string) => `agent.${role}.strategy` as const,
  },

  // Financial context
  financial: {
    current: 'financial.current',
    budget: 'financial.budget',
    targets: 'financial.targets',
  },

  // Competitive intel
  competitive: {
    landscape: 'competitive.landscape',
    competitors: (name: string) => `competitive.${name}` as const,
  },

  // Marketing
  marketing: {
    strategy: 'marketing.strategy',
    contentCalendar: 'marketing.content_calendar',
    brandGuidelines: 'marketing.brand_guidelines',
  },
} as const;

/**
 * GCS path builders for large documents/reports
 */
export const GCS_PATHS = {
  briefing: (recipient: string, date: string) =>
    `briefings/${recipient}/${date}.md`,
  monthlyReport: (date: string) =>
    `reports/monthly/${date}-financial.md`,
  competitiveReport: (week: string) =>
    `reports/competitive/${week}-competitive.md`,
  productReport: (product: string, week: string) =>
    `reports/product/${product}-usage-${week}.md`,
  blogDraft: (slug: string) =>
    `content/blog/drafts/${slug}.md`,
  socialQueue: (date: string) =>
    `content/social/queue/${date}.json`,
  technicalSpec: (name: string) =>
    `specs/technical/${name}.md`,
  productSpec: (name: string) =>
    `specs/product/${name}.md`,
  decisionArchive: (id: string) =>
    `decisions/archives/${id}.md`,
} as const;
