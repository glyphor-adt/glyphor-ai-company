/**
 * Platform Intelligence Agent — Static Configuration
 *
 * Nexus watches the full 36-agent fleet, diagnoses issues, acts autonomously
 * within defined bounds, and routes everything else to founders via Teams
 * Adaptive Cards with approve/reject.
 */
export const PLATFORM_INTEL_CONFIG = {
  id: 'platform-intel',
  name: 'Nexus',
  title: 'Platform Intelligence',
  department: 'Operations',
  model: 'claude-opus-4-6',
  maxTurns: 40,
  autonomyTier: 'supervised',
} as const;
