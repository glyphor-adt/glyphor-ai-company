/**
 * Onboarding handler — runs a 5-question DM questionnaire after OAuth install.
 *
 * Flow:
 *   1. OAuth completes → startOnboarding() sends first question via DM
 *   2. User replies → handleOnboardingReply() stores answer, sends next question
 *   3. After all 5 questions → finalizeOnboarding() stores channel config + sends welcome
 *
 * State is tracked in customer_tenants.settings:
 *   { "onboarding_step": 0..4, "onboarding_dm": "D...", "onboarding_answers": {...} }
 */
import { systemQuery } from '@glyphor/shared/db';
import { postMessage, openDM, getCustomerTenantByTeamId } from './slackClient.js';
import type { DbCustomerTenant } from './types.js';

// ─── Questions ───────────────────────────────────────────────────────────────

interface OnboardingQuestion {
  key: string;
  question: string;
}

const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  { key: 'product',              question: "What's your product or service? Give me 2-3 sentences." },
  { key: 'audience',             question: "Who's your target audience?" },
  { key: 'brand_voice',          question: "How would you describe your brand voice? (e.g. confident, playful, technical)" },
  { key: 'deliverables_channel', question: "Which Slack channel should I post completed work to? (e.g. #marketing)" },
  { key: 'reports_channel',      question: "Which Slack channel should I post weekly reports to?" },
];

// ─── Start onboarding ────────────────────────────────────────────────────────

export async function startOnboarding(
  customerTenantId: string,
  botToken: string,
  installerUserId: string,
): Promise<void> {
  // Open a DM with the installer
  const dmResult = await openDM(botToken, installerUserId);
  if (!dmResult.ok || !dmResult.channelId) {
    console.error(`[Onboarding] Failed to open DM with ${installerUserId}`);
    return;
  }

  const dmChannelId = dmResult.channelId;

  // Send the welcome + first question
  const firstQ = ONBOARDING_QUESTIONS[0];
  await postMessage(botToken, {
    channel: dmChannelId,
    text: `Hi — I'm Maya, your CMO. Before I get started, I have a few quick questions so I can tailor everything to your business.\n\n${firstQ.question}`,
  });

  // Store onboarding state
  await systemQuery(
    `UPDATE customer_tenants
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      customerTenantId,
      JSON.stringify({
        onboarding_step: 0,
        onboarding_dm: dmChannelId,
        onboarding_answers: {},
      }),
    ],
  );

  console.log(`[Onboarding] Started for tenant=${customerTenantId} dm=${dmChannelId}`);
}

// ─── Handle reply during onboarding ──────────────────────────────────────────

/**
 * Returns true if this message was consumed by the onboarding flow,
 * false if it should be processed normally.
 */
export async function handleOnboardingReply(
  customerTenant: DbCustomerTenant,
  channel: string,
  text: string,
): Promise<boolean> {
  const settings = customerTenant.settings ?? {};
  const step = settings['onboarding_step'] as number | undefined;
  const onboardingDm = settings['onboarding_dm'] as string | undefined;

  // Not in onboarding, or message isn't in the onboarding DM
  if (step === undefined || step === null || !onboardingDm || channel !== onboardingDm) {
    return false;
  }

  if (step < 0 || step >= ONBOARDING_QUESTIONS.length) {
    return false;
  }

  const currentQuestion = ONBOARDING_QUESTIONS[step];
  const answers = (settings['onboarding_answers'] as Record<string, string>) ?? {};
  answers[currentQuestion.key] = text;

  const nextStep = step + 1;

  if (nextStep < ONBOARDING_QUESTIONS.length) {
    // More questions — store answer and ask next
    const nextQuestion = ONBOARDING_QUESTIONS[nextStep];

    await systemQuery(
      `UPDATE customer_tenants
       SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        customerTenant.id,
        JSON.stringify({
          onboarding_step: nextStep,
          onboarding_answers: answers,
        }),
      ],
    );

    await postMessage(customerTenant.bot_token, {
      channel: onboardingDm,
      text: nextQuestion.question,
    });

    console.log(`[Onboarding] tenant=${customerTenant.id} step=${nextStep}/${ONBOARDING_QUESTIONS.length}`);
  } else {
    // All questions answered — finalize
    await finalizeOnboarding(customerTenant, answers, onboardingDm);
  }

  return true;
}

// ─── Finalize ────────────────────────────────────────────────────────────────

async function finalizeOnboarding(
  customerTenant: DbCustomerTenant,
  answers: Record<string, string>,
  onboardingDm: string,
): Promise<void> {
  // Store answers as knowledge and build channel config
  // Channel answers might be "#marketing" or "marketing" — we'll store the raw text
  // and resolve to channel IDs later when the bot joins those channels.
  const channelConfig = {
    deliverables: answers['deliverables_channel'] ?? null,
    reports: answers['reports_channel'] ?? null,
    dm_owner: onboardingDm,
    general: customerTenant.default_channel ?? null,
  };

  // Update settings: clear onboarding state, store channels + brand info
  await systemQuery(
    `UPDATE customer_tenants
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      customerTenant.id,
      JSON.stringify({
        onboarding_step: null,
        onboarding_dm: null,
        onboarding_answers: null,
        onboarding_complete: true,
        channels: channelConfig,
        brand: {
          product: answers['product'] ?? null,
          audience: answers['audience'] ?? null,
          voice: answers['brand_voice'] ?? null,
        },
      }),
    ],
  );

  // Store brand knowledge in customer_knowledge for agent RAG
  const knowledgeEntries = [
    { section: 'brand', title: 'Product Description', content: answers['product'] ?? '' },
    { section: 'brand', title: 'Target Audience', content: answers['audience'] ?? '' },
    { section: 'brand', title: 'Brand Voice', content: answers['brand_voice'] ?? '' },
  ];

  for (const entry of knowledgeEntries) {
    if (!entry.content) continue;
    await systemQuery(
      `INSERT INTO customer_knowledge
         (tenant_id, section, title, content, content_type, audience, tags, is_active, version, last_edited_by)
       VALUES ($1, $2, $3, $4, 'text', 'all', ARRAY['onboarding'], true, 1, 'onboarding')
       ON CONFLICT DO NOTHING`,
      [customerTenant.tenant_id, entry.section, entry.title, entry.content],
    );
  }

  // Send the "I'm ready" message
  await postMessage(customerTenant.bot_token, {
    channel: onboardingDm,
    text: `Thanks — that's everything I need.\n\nI'm Maya, your CMO. I've read your brief and I'm ready to start. I'll post deliverables to ${answers['deliverables_channel'] ?? 'your workspace'} and weekly reports to ${answers['reports_channel'] ?? 'your workspace'}.\n\nYou can give me instructions anytime with \`/glyphor\` — for example:\n\`/glyphor brief the team on a new product launch campaign\`\n\nLet's build something great. 🚀`,
  });

  console.log(`[Onboarding] Complete for tenant=${customerTenant.id}`);
}
