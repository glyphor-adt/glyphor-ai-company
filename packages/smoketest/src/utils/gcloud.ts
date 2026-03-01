/**
 * gcloud CLI wrapper — runs gcloud commands and returns output.
 * Gracefully skips if gcloud is not installed.
 */

import { execSync } from 'node:child_process';

let gcloudAvailable: boolean | null = null;

/**
 * Check if gcloud CLI is available.
 */
export function isGcloudAvailable(): boolean {
  if (gcloudAvailable !== null) return gcloudAvailable;
  try {
    execSync('gcloud --version', { stdio: 'pipe' });
    gcloudAvailable = true;
  } catch {
    gcloudAvailable = false;
  }
  return gcloudAvailable;
}

/**
 * Execute a gcloud command and return stdout.
 * Throws if gcloud is not available or command fails.
 */
export function gcloudExec(args: string, project?: string): string {
  if (!isGcloudAvailable()) {
    throw new Error('gcloud CLI is not installed or not in PATH');
  }
  const projectFlag = project ? ` --project=${project}` : '';
  const cmd = `gcloud ${args}${projectFlag}`;
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
