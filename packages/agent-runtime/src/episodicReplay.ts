/**
 * Episodic Replay — Scheduled process that revisits shared episodes
 * to extract patterns, propose constitutional amendments, update
 * the company pulse, and prevent knowledge decay.
 *
 * Runs every 2 hours via the scheduler. Operates as a batch process,
 * not a per-request middleware.
 *
 * Cycle:
 *  1. Fetch recent episodes (last 2h window + significant older ones)
 *  2. Cluster by domain / agent / outcome pairing
 *  3. Identify recurring patterns via LLM analysis
 *  4. Score significance → update significance_score on episodes
 *  5. Propose constitutional amendments if patterns warrant
 *  6. Update company pulse highlights with any notable findings
 */

import { systemQuery } from '@glyphor/shared/db';
import type { ModelClient } from './modelClient.js';

/** Minimal embedding client interface for episodic replay. */
export interface ReplayEmbeddingClient {
  embed(text: string): Promise<number[]>;
}

// ─── Types ──────────────────────────────────────────────────────

interface EpisodeRow {
  id: string;
  created_at: string;
  author_agent: string;
  episode_type: string;
  summary: string;
  detail: Record<string, unknown> | null;
  outcome: string | null;
  confidence: number;
  domains: string[];
  tags: string[];
  times_accessed: number;
  significance_score: number | null;
}

interface ExtractedPattern {
  description: string;
  frequency: number;
  agents: string[];
  domains: string[];
  sentiment: 'positive' | 'negative' | 'neutral';
  suggestsAmendment: boolean;
  amendmentRationale?: string;
}

export interface ReplayResult {
  episodesProcessed: number;
  patternsFound: number;
  amendmentsProposed: number;
  significanceUpdates: number;
  errors: string[];
}

// ─── Configuration ──────────────────────────────────────────────

const REPLAY_WINDOW_HOURS = 2;
const SIGNIFICANT_LOOKBACK_DAYS = 7;
const SIGNIFICANCE_THRESHOLD = 0.7;
const MIN_EPISODES_FOR_ANALYSIS = 3;
const ANALYSIS_MODEL = 'gemini-2.5-flash';

// ─── Class ──────────────────────────────────────────────────────

export class EpisodicReplay {
  constructor(
    private modelClient: ModelClient,
    private embeddingClient: ReplayEmbeddingClient,
  ) {}

  /**
   * Run one replay cycle. Intended to be called by the scheduler every 2h.
   */
  async runCycle(): Promise<ReplayResult> {
    const result: ReplayResult = {
      episodesProcessed: 0,
      patternsFound: 0,
      amendmentsProposed: 0,
      significanceUpdates: 0,
      errors: [],
    };

    try {
      // 1. Fetch episodes
      const episodes = await this.fetchEpisodes();
      result.episodesProcessed = episodes.length;

      if (episodes.length < MIN_EPISODES_FOR_ANALYSIS) {
        return result;
      }

      // 2. Analyze patterns via LLM
      const patterns = await this.analyzePatterns(episodes);
      result.patternsFound = patterns.length;

      // 3. Score significance for episodes
      const sigUpdates = await this.updateSignificance(episodes, patterns);
      result.significanceUpdates = sigUpdates;

      // 4. Propose amendments for qualifying patterns
      for (const pattern of patterns) {
        if (pattern.suggestsAmendment) {
          try {
            await this.proposeAmendment(pattern);
            result.amendmentsProposed++;
          } catch (err) {
            result.errors.push(`Amendment proposal failed: ${(err as Error).message}`);
          }
        }
      }

      // 5. Update pulse highlights
      await this.updatePulseHighlights(patterns);

    } catch (err) {
      result.errors.push(`Replay cycle failed: ${(err as Error).message}`);
    }

    return result;
  }

  // ─── Internal Methods ───────────────────────────────────────

  private async fetchEpisodes(): Promise<EpisodeRow[]> {
    const windowStart = new Date(
      Date.now() - REPLAY_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const significantCutoff = new Date(
      Date.now() - SIGNIFICANT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Recent episodes from the time window
    const recent = await systemQuery<EpisodeRow>(
      'SELECT id, created_at, author_agent, episode_type, summary, detail, outcome, confidence, domains, tags, times_accessed, significance_score FROM shared_episodes WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 100',
      [windowStart],
    );

    // High-significance older episodes for pattern matching
    const significant = await systemQuery<EpisodeRow>(
      'SELECT id, created_at, author_agent, episode_type, summary, detail, outcome, confidence, domains, tags, times_accessed, significance_score FROM shared_episodes WHERE created_at < $1 AND created_at >= $2 AND significance_score >= $3 ORDER BY significance_score DESC LIMIT 50',
      [windowStart, significantCutoff, SIGNIFICANCE_THRESHOLD],
    );

    const all = [...recent, ...significant];

    // Deduplicate by ID
    const seen = new Set<string>();
    return all.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    }) as EpisodeRow[];
  }

  private async analyzePatterns(episodes: EpisodeRow[]): Promise<ExtractedPattern[]> {
    const summaryBlock = episodes
      .map((e, i) => `[${i + 1}] (${e.author_agent}, ${e.episode_type}) ${e.summary}${e.outcome ? ` → ${e.outcome}` : ''}`)
      .join('\n');

    const response = await this.modelClient.generate({
      model: ANALYSIS_MODEL,
      systemInstruction: `You analyze organizational episodes to find patterns. Return a JSON array of patterns (no markdown fences):
[{
  "description": "<pattern description>",
  "frequency": <how many episodes match>,
  "agents": ["<agent roles involved>"],
  "domains": ["<domains>"],
  "sentiment": "positive" | "negative" | "neutral",
  "suggestsAmendment": <true if this pattern warrants a policy change>,
  "amendmentRationale": "<why, if suggestsAmendment is true>"
}]
If no clear patterns, return [].`,
      contents: [{
        role: 'user',
        content: `Analyze these ${episodes.length} recent episodes for recurring patterns:\n\n${summaryBlock}`,
        timestamp: Date.now(),
      }],
      temperature: 0.2,
      maxTokens: 2048,
    });

    try {
      const cleaned = (response.text ?? '')
        .replace(/```json?\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];
      return parsed as ExtractedPattern[];
    } catch {
      return [];
    }
  }

  private async updateSignificance(
    episodes: EpisodeRow[],
    patterns: ExtractedPattern[],
  ): Promise<number> {
    let updated = 0;

    for (const episode of episodes) {
      // Skip if already scored above threshold
      if (episode.significance_score != null && episode.significance_score >= SIGNIFICANCE_THRESHOLD) {
        continue;
      }

      // Compute significance based on multiple signals
      let score = 0;

      // Access frequency signal
      score += Math.min(episode.times_accessed * 0.1, 0.3);

      // Confidence signal
      score += episode.confidence * 0.2;

      // Pattern relevance signal
      const matchingPatterns = patterns.filter(p =>
        p.agents.some(a => a === episode.author_agent) ||
        p.domains.some(d => episode.domains.includes(d)),
      );
      score += Math.min(matchingPatterns.length * 0.15, 0.3);

      // Outcome signal
      if (episode.outcome && episode.outcome !== 'unknown') {
        score += 0.1;
      }

      // Clamp to [0, 1]
      score = Math.max(0, Math.min(1, score));

      if (score !== episode.significance_score) {
        await systemQuery(
          'UPDATE shared_episodes SET significance_score = $1 WHERE id = $2',
          [score, episode.id],
        );
        updated++;
      }
    }

    return updated;
  }

  private async proposeAmendment(pattern: ExtractedPattern): Promise<void> {
    // Generate a proposed principle from the pattern
    const response = await this.modelClient.generate({
      model: ANALYSIS_MODEL,
      systemInstruction: `You draft constitutional principles for an AI company. Given a pattern observed in agent behavior, propose a concise principle (1-2 sentences) that would improve outcomes. Return JSON (no fences):
{"principle": "<the principle>", "rationale": "<brief justification>"}`,
      contents: [{
        role: 'user',
        content: `Pattern: ${pattern.description}\nSentiment: ${pattern.sentiment}\nFrequency: ${pattern.frequency} occurrences\nAgents involved: ${pattern.agents.join(', ')}\nRationale for amendment: ${pattern.amendmentRationale ?? 'General improvement'}`,
        timestamp: Date.now(),
      }],
      temperature: 0.3,
      maxTokens: 512,
    });

    let principle = 'Principle could not be generated';
    let rationale = pattern.amendmentRationale ?? '';

    try {
      const cleaned = (response.text ?? '')
        .replace(/```json?\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      principle = String(parsed.principle ?? principle);
      rationale = String(parsed.rationale ?? rationale);
    } catch {
      // Use defaults
    }

    await systemQuery(
      `INSERT INTO proposed_constitutional_amendments (agent_role, action, principle_text, rationale, source)
       VALUES ($1, $2, $3, $4, $5)`,
      ['episodic-replay', 'add', principle, rationale, 'episodic_replay'],
    );
  }

  private async updatePulseHighlights(patterns: ExtractedPattern[]): Promise<void> {
    const highlights = patterns
      .filter(p => p.sentiment !== 'neutral')
      .slice(0, 3)
      .map(p => ({
        agent: p.agents[0] ?? 'system',
        type: p.sentiment === 'positive' ? 'positive' : 'alert',
        text: p.description,
      }));

    if (highlights.length === 0) return;

    // Merge with existing pulse highlights (keep last 10)
    const [pulse] = await systemQuery<{ highlights: unknown }>(
      'SELECT highlights FROM company_pulse LIMIT 1',
      [],
    );

    const existing = Array.isArray(pulse?.highlights) ? pulse.highlights : [];
    const merged = [...highlights, ...existing].slice(0, 10);

    await systemQuery(
      'UPDATE company_pulse SET highlights = $1, updated_at = $2 WHERE id IS NOT NULL',
      [JSON.stringify(merged), new Date().toISOString()],
    );
  }
}
