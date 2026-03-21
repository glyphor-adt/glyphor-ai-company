/**
 * Resolve the Playwright screenshot service endpoint.
 *
 * Canonical env var is PLAYWRIGHT_SERVICE_URL. We keep SCREENSHOT_SERVICE_URL
 * as a backward-compatible fallback during migration.
 */
export function getPlaywrightServiceUrl(): string {
  const url = process.env.PLAYWRIGHT_SERVICE_URL ?? process.env.SCREENSHOT_SERVICE_URL;
  if (!url) {
    throw new Error(
      'PLAYWRIGHT_SERVICE_URL not configured (legacy fallback: SCREENSHOT_SERVICE_URL). Deploy/configure the Playwright screenshot service.',
    );
  }
  return url;
}
