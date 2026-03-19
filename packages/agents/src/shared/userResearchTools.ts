/**
 * User Research Tools — Shared tools for user research workflows
 *
 * Tools:
 *   create_survey            — Create a user survey definition
 *   get_survey_results       — Read survey responses
 *   analyze_support_tickets  — Query support ticket patterns
 *   get_user_feedback        — Aggregate user feedback
 *   create_user_persona      — Generate a user persona document
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/** Map date_range shorthand to a SQL interval expression. */
function dateRangeToInterval(range: string): string {
  switch (range) {
    case '7d':
      return "NOW() - INTERVAL '7 days'";
    case '30d':
      return "NOW() - INTERVAL '30 days'";
    case '90d':
      return "NOW() - INTERVAL '90 days'";
    default:
      return "NOW() - INTERVAL '30 days'";
  }
}

export function createUserResearchTools(): ToolDefinition[] {
  return [
    // ── create_survey ─────────────────────────────────────────────────
    {
      name: 'create_survey',
      description:
        'Create a user survey definition. Inserts a survey record into the activity log ' +
        'and returns the generated survey ID.',
      parameters: {
        title: {
          type: 'string',
          description: 'Title of the survey',
          required: true,
        },
        questions: {
          type: 'string',
          description: 'JSON array of question objects (e.g. [{"text":"...","type":"multiple_choice","options":["a","b"]}])',
          required: true,
        },
        target_audience: {
          type: 'string',
          description: 'Target audience segment for the survey',
          enum: ['all', 'power_users', 'new_users', 'enterprise', 'churned'],
        },
        delivery_method: {
          type: 'string',
          description: 'How the survey will be delivered to users',
          enum: ['email', 'in_app'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          // Validate questions JSON
          let parsedQuestions: unknown;
          try {
            parsedQuestions = JSON.parse(params.questions as string);
          } catch {
            return { success: false, error: 'Invalid JSON in questions parameter' };
          }

          const details = JSON.stringify({
            title: params.title as string,
            questions: parsedQuestions,
            target_audience: (params.target_audience as string) || 'all',
            delivery_method: (params.delivery_method as string) || 'email',
          });

          const [row] = await systemQuery<{ id: string }>(
            `INSERT INTO activity_log (agent_role, action, summary, details, created_at)
             VALUES ('user-researcher', 'survey_created', $1, $2::jsonb, NOW()) RETURNING id`,
            [`Survey created: ${params.title}`, details],
          );

          return {
            success: true,
            data: {
              survey_id: row.id,
              title: params.title,
              target_audience: (params.target_audience as string) || 'all',
              delivery_method: (params.delivery_method as string) || 'email',
              question_count: Array.isArray(parsedQuestions) ? parsedQuestions.length : 0,
            },
          };
        } catch (err) {
          return { success: false, error: `create_survey failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_survey_results ────────────────────────────────────────────
    {
      name: 'get_survey_results',
      description:
        'Read survey responses for a given survey. Returns response count and per-question summaries.',
      parameters: {
        survey_id: {
          type: 'string',
          description: 'The survey ID to retrieve results for',
        },
        date_range: {
          type: 'string',
          description: 'Time window for responses',
          enum: ['7d', '30d', '90d'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const surveyId = params.survey_id as string;
          const interval = dateRangeToInterval((params.date_range as string) || '30d');

          const rows = await systemQuery<{ id: string; details: Record<string, unknown>; created_at: string }>(
            `SELECT id, details, created_at FROM activity_log
             WHERE type = 'survey_response'
               AND details->>'survey_id' = $1
               AND created_at >= ${interval}
             ORDER BY created_at DESC`,
            [surveyId],
          );

          // Build per-question summaries
          const questionSummaries: Record<string, { responses: number; answers: Record<string, number> }> = {};
          for (const row of rows) {
            const answers = (row.details?.answers ?? {}) as Record<string, string>;
            for (const [questionId, answer] of Object.entries(answers)) {
              if (!questionSummaries[questionId]) {
                questionSummaries[questionId] = { responses: 0, answers: {} };
              }
              questionSummaries[questionId].responses++;
              questionSummaries[questionId].answers[answer] =
                (questionSummaries[questionId].answers[answer] || 0) + 1;
            }
          }

          return {
            success: true,
            data: {
              survey_id: surveyId,
              response_count: rows.length,
              date_range: (params.date_range as string) || '30d',
              question_summaries: questionSummaries,
            },
          };
        } catch (err) {
          return { success: false, error: `get_survey_results failed: ${(err as Error).message}` };
        }
      },
    },

    // ── analyze_support_tickets ───────────────────────────────────────
    {
      name: 'analyze_support_tickets',
      description:
        'Query support ticket patterns. Returns ticket volume by category, common issues, and resolution time.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time window for analysis',
          required: true,
          enum: ['7d', '30d', '90d'],
        },
        category: {
          type: 'string',
          description: 'Filter by ticket category (optional)',
        },
        priority: {
          type: 'string',
          description: 'Filter by ticket priority (optional)',
          enum: ['low', 'medium', 'high', 'critical'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const interval = dateRangeToInterval(params.date_range as string);
          const conditions: string[] = [`created_at >= ${interval}`];
          const values: unknown[] = [];
          let idx = 1;

          if (params.category) {
            conditions.push(`details->>'category' = $${idx++}`);
            values.push(params.category as string);
          }
          if (params.priority) {
            conditions.push(`details->>'priority' = $${idx++}`);
            values.push(params.priority as string);
          }

          const where = conditions.join(' AND ');

          const rows = await systemQuery<{
            id: string;
            details: Record<string, unknown>;
            created_at: string;
          }>(
            `SELECT id, details, created_at FROM activity_log
             WHERE type = 'support_ticket' AND ${where}
             ORDER BY created_at DESC`,
            values,
          );

          // Aggregate by category
          const volumeByCategory: Record<string, number> = {};
          const issues: Record<string, number> = {};
          let totalResolutionMs = 0;
          let resolvedCount = 0;

          for (const row of rows) {
            const cat = (row.details?.category as string) || 'uncategorized';
            volumeByCategory[cat] = (volumeByCategory[cat] || 0) + 1;

            const issue = (row.details?.issue as string) || 'unknown';
            issues[issue] = (issues[issue] || 0) + 1;

            if (row.details?.resolved_at) {
              const created = new Date(row.created_at).getTime();
              const resolved = new Date(row.details.resolved_at as string).getTime();
              totalResolutionMs += resolved - created;
              resolvedCount++;
            }
          }

          // Sort issues by frequency
          const commonIssues = Object.entries(issues)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([issue, count]) => ({ issue, count }));

          return {
            success: true,
            data: {
              date_range: params.date_range,
              total_tickets: rows.length,
              volume_by_category: volumeByCategory,
              common_issues: commonIssues,
              avg_resolution_hours: resolvedCount > 0
                ? Math.round(totalResolutionMs / resolvedCount / 3_600_000 * 10) / 10
                : null,
              resolved_count: resolvedCount,
            },
          };
        } catch (err) {
          return { success: false, error: `analyze_support_tickets failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_user_feedback ─────────────────────────────────────────────
    {
      name: 'get_user_feedback',
      description:
        'Aggregate user feedback from multiple sources. Returns categorized feedback with frequency and sentiment.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time window for feedback',
          required: true,
          enum: ['7d', '30d', '90d'],
        },
        source: {
          type: 'string',
          description: 'Feedback source to query',
          required: true,
          enum: ['support', 'survey', 'social', 'all'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const interval = dateRangeToInterval(params.date_range as string);
          const source = params.source as string;

          // Query activity_log for feedback entries
          const sourceCondition = source === 'all'
            ? "type IN ('feedback_support', 'feedback_survey', 'feedback_social')"
            : `type = 'feedback_${source}'`;

          const activityRows = await systemQuery<{
            id: string;
            type: string;
            details: Record<string, unknown>;
            created_at: string;
          }>(
            `SELECT id, type, details, created_at FROM activity_log
             WHERE ${sourceCondition} AND created_at >= ${interval}
             ORDER BY created_at DESC`,
            [],
          );

          // Query analytics_events for supplementary feedback signals
          const eventRows = await systemQuery<{
            event_type: string;
            properties: Record<string, unknown>;
            created_at: string;
          }>(
            `SELECT event_type, properties, created_at FROM analytics_events
             WHERE event_type LIKE 'feedback_%' AND created_at >= ${interval}
             ORDER BY created_at DESC`,
            [],
          );

          // Categorize feedback
          const categories: Record<string, { count: number; sentiment_sum: number; examples: string[] }> = {};

          for (const row of activityRows) {
            const cat = (row.details?.category as string) || 'general';
            const sentiment = (row.details?.sentiment as number) ?? 0;
            const text = (row.details?.text as string) || '';

            if (!categories[cat]) {
              categories[cat] = { count: 0, sentiment_sum: 0, examples: [] };
            }
            categories[cat].count++;
            categories[cat].sentiment_sum += sentiment;
            if (categories[cat].examples.length < 3 && text) {
              categories[cat].examples.push(text);
            }
          }

          const categorized = Object.entries(categories).map(([category, data]) => ({
            category,
            count: data.count,
            avg_sentiment: data.count > 0 ? Math.round((data.sentiment_sum / data.count) * 100) / 100 : null,
            examples: data.examples,
          }));

          return {
            success: true,
            data: {
              date_range: params.date_range,
              source,
              total_feedback: activityRows.length + eventRows.length,
              activity_log_entries: activityRows.length,
              analytics_events: eventRows.length,
              categories: categorized,
            },
          };
        } catch (err) {
          return { success: false, error: `get_user_feedback failed: ${(err as Error).message}` };
        }
      },
    },

    // ── create_user_persona ───────────────────────────────────────────
    {
      name: 'create_user_persona',
      description:
        'Generate a structured user persona document based on analytics data. ' +
        'Returns demographics, goals, pain points, and usage patterns for the selected persona type.',
      parameters: {
        persona_type: {
          type: 'string',
          description: 'The type of user persona to generate',
          required: true,
          enum: ['power_user', 'new_user', 'churned', 'enterprise'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const personaType = params.persona_type as string;

          // Query analytics_events for behavior data matching this persona type
          const behaviorRows = await systemQuery<{
            event_type: string;
            properties: Record<string, unknown>;
            created_at: string;
          }>(
            `SELECT event_type, properties, created_at FROM analytics_events
             WHERE properties->>'user_segment' = $1
             ORDER BY created_at DESC
             LIMIT 500`,
            [personaType],
          );

          // Aggregate usage patterns
          const eventFrequency: Record<string, number> = {};
          const featureUsage: Record<string, number> = {};
          let totalSessions = 0;

          for (const row of behaviorRows) {
            eventFrequency[row.event_type] = (eventFrequency[row.event_type] || 0) + 1;

            const feature = row.properties?.feature as string | undefined;
            if (feature) {
              featureUsage[feature] = (featureUsage[feature] || 0) + 1;
            }
            if (row.event_type === 'session_start') {
              totalSessions++;
            }
          }

          const topFeatures = Object.entries(featureUsage)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([feature, count]) => ({ feature, count }));

          const topEvents = Object.entries(eventFrequency)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([event, count]) => ({ event, count }));

          return {
            success: true,
            data: {
              persona_type: personaType,
              data_points: behaviorRows.length,
              demographics: {
                segment: personaType,
                note: 'Derived from analytics_events user_segment data',
              },
              goals: deriveGoals(personaType),
              pain_points: derivePainPoints(personaType),
              usage_patterns: {
                total_sessions: totalSessions,
                top_features: topFeatures,
                top_events: topEvents,
              },
            },
          };
        } catch (err) {
          return { success: false, error: `create_user_persona failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}

/** Derive typical goals for each persona type. */
function deriveGoals(personaType: string): string[] {
  switch (personaType) {
    case 'power_user':
      return ['Maximize productivity', 'Leverage advanced features', 'Automate repetitive workflows'];
    case 'new_user':
      return ['Learn the platform quickly', 'Complete first successful project', 'Understand core value'];
    case 'churned':
      return ['Was seeking a specific capability', 'Needed faster time-to-value', 'Evaluated alternatives'];
    case 'enterprise':
      return ['Team-wide adoption', 'Security and compliance', 'Integration with existing tools', 'ROI demonstration'];
    default:
      return ['General platform usage'];
  }
}

/** Derive typical pain points for each persona type. */
function derivePainPoints(personaType: string): string[] {
  switch (personaType) {
    case 'power_user':
      return ['Hitting platform limits', 'Wants deeper customization', 'Needs better API/integrations'];
    case 'new_user':
      return ['Steep learning curve', 'Unclear onboarding path', 'Feature discoverability'];
    case 'churned':
      return ['Did not find expected value', 'Complexity was a barrier', 'Missing critical feature'];
    case 'enterprise':
      return ['SSO/SAML setup friction', 'Audit and compliance gaps', 'Billing complexity for large teams'];
    default:
      return ['General usability concerns'];
  }
}
