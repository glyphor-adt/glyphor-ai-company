/**
 * Google AI (Gemini / Imagen / Deep Research) credentials.
 *
 * Production: store the API key in **GCP Secret Manager** as secret id
 * `google-ai-api-key`, and mount it on Cloud Run as environment variable
 * `GOOGLE_AI_API_KEY` (`gcloud run deploy --set-secrets=GOOGLE_AI_API_KEY=google-ai-api-key:latest`).
 *
 * Do **not** commit secrets in `.env` or other tracked files — local dev may inject
 * the same env var from your shell or a gitignored file, but the source of truth
 * for deployed services is Secret Manager.
 */

/** GCP Secret Manager secret id (matches `.github/workflows/deploy.yml` and Cloud Run). */
export const GCP_SECRET_NAME_GOOGLE_AI_API_KEY = 'google-ai-api-key';

/**
 * Returns the Google AI API key from the runtime environment (injected from Secret Manager in prod).
 * `GEMINI_API_KEY` is supported only as a legacy alias.
 */
export function getGoogleAiApiKey(): string | undefined {
  const v = process.env.GOOGLE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  return v || undefined;
}

/** User-facing hint when Gemini/Imagen is not configured. */
export function googleAiMissingKeyMessage(context: string): string {
  return (
    `${context}: set GCP Secret Manager secret "${GCP_SECRET_NAME_GOOGLE_AI_API_KEY}" and mount as env GOOGLE_AI_API_KEY on the service (Cloud Run --set-secrets). Do not store API keys in committed .env files.`
  );
}
