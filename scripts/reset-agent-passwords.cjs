/**
 * Reset all agent Entra user account passwords and store in GCP Secret Manager.
 *
 * Usage:
 *   az login --tenant 19ab7456-f160-416d-a503-57298ab192a2
 *   node scripts/reset-agent-passwords.cjs
 *
 * This script:
 *   1. Generates a unique 24-char password per agent
 *   2. Resets password via MS Graph API (PATCH /users/{email})
 *   3. Stores the full email→password JSON map as GCP secret "agent-passwords"
 */

const { execSync } = require('child_process');
const crypto = require('crypto');

const AGENT_EMAILS = [
  'sarah@glyphor.ai', 'marcus@glyphor.ai', 'elena@glyphor.ai', 'maya@glyphor.ai',
  'nadia@glyphor.ai', 'victoria@glyphor.ai', 'james@glyphor.ai', 'rachel@glyphor.ai',
  'mia@glyphor.ai', 'alex@glyphor.ai', 'sam@glyphor.ai', 'jordan@glyphor.ai',
  'priya@glyphor.ai', 'daniel@glyphor.ai', 'anna@glyphor.ai', 'omar@glyphor.ai',
  'tyler@glyphor.ai', 'lisa@glyphor.ai', 'kai@glyphor.ai', 'emma@glyphor.ai',
  'david@glyphor.ai', 'nathan@glyphor.ai', 'riley@glyphor.ai', 'leo@glyphor.ai',
  'ava@glyphor.ai', 'sofia@glyphor.ai', 'ryan@glyphor.ai', 'atlas@glyphor.ai',
  'morgan@glyphor.ai', 'jasmine@glyphor.ai', 'sophia@glyphor.ai', 'lena@glyphor.ai',
  'dokafor@glyphor.ai', 'kain@glyphor.ai', 'amara@glyphor.ai', 'ethan@glyphor.ai',
  'bob@glyphor.ai', 'grace@glyphor.ai', 'mariana@glyphor.ai', 'derek@glyphor.ai',
  'zara@glyphor.ai', 'riya@glyphor.ai', 'marcus.c@glyphor.ai', 'adi@glyphor.ai',
];

function generatePassword() {
  // 24-char password: uppercase + lowercase + digits + special
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const bytes = crypto.randomBytes(24);
  let pw = '';
  for (let i = 0; i < 24; i++) {
    pw += chars[bytes[i] % chars.length];
  }
  // Ensure complexity requirements — prepend one of each category if not present
  if (!/[A-Z]/.test(pw)) pw = 'A' + pw.slice(1);
  if (!/[a-z]/.test(pw)) pw = pw[0] + 'z' + pw.slice(2);
  if (!/[0-9]/.test(pw)) pw = pw.slice(0, 2) + '9' + pw.slice(3);
  if (!/[!@#$%^&*]/.test(pw)) pw = pw.slice(0, 3) + '!' + pw.slice(4);
  return pw;
}

async function main() {
  // Get a Graph API token via az cli
  let token;
  try {
    token = execSync(
      'az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv',
      { encoding: 'utf8' }
    ).trim();
  } catch (e) {
    console.error('Failed to get token. Run: az login --tenant 19ab7456-f160-416d-a503-57298ab192a2');
    process.exit(1);
  }

  const passwordMap = {};
  let successCount = 0;
  let failCount = 0;

  for (const email of AGENT_EMAILS) {
    const password = generatePassword();

    try {
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          passwordProfile: {
            password: password,
            forceChangePasswordNextSignIn: false,
            forceChangePasswordNextSignInWithMfa: false,
          },
        }),
      });

      if (res.ok || res.status === 204) {
        passwordMap[email] = password;
        successCount++;
        console.log(`✓ ${email}`);
      } else {
        const text = await res.text();
        console.error(`✗ ${email}: ${res.status} ${text.substring(0, 100)}`);
        failCount++;
      }
    } catch (err) {
      console.error(`✗ ${email}: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\nReset ${successCount}/${AGENT_EMAILS.length} passwords (${failCount} failed)`);

  if (successCount === 0) {
    console.error('No passwords were reset. Aborting.');
    process.exit(1);
  }

  // Store in GCP Secret Manager
  const secretJson = JSON.stringify(passwordMap, null, 2);

  try {
    // Create the secret if it doesn't exist
    try {
      execSync('gcloud secrets create agent-passwords --replication-policy=automatic', {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      console.log('Created GCP secret: agent-passwords');
    } catch {
      // Already exists
    }

    // Add new version
    execSync(
      `echo ${Buffer.from(secretJson).toString('base64')} | ` +
        (process.platform === 'win32'
          ? 'powershell -c "[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String((Get-Content -Raw)))" | '
          : 'base64 -d | ') +
        'gcloud secrets versions add agent-passwords --data-file=-',
      { encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' }
    );
    console.log('Stored passwords in GCP secret: agent-passwords');
  } catch (err) {
    // Fallback: write to temp file, then use it
    const fs = require('fs');
    const tmpFile = require('path').join(require('os').tmpdir(), 'agent-passwords.json');
    fs.writeFileSync(tmpFile, secretJson, 'utf8');

    try {
      execSync(`gcloud secrets create agent-passwords --replication-policy=automatic`, {
        encoding: 'utf8', stdio: 'pipe'
      });
    } catch { /* already exists */ }

    execSync(`gcloud secrets versions add agent-passwords --data-file="${tmpFile}"`, {
      encoding: 'utf8',
    });
    fs.unlinkSync(tmpFile);
    console.log('Stored passwords in GCP secret: agent-passwords');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
