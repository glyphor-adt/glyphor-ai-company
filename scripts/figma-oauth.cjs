/**
 * Figma OAuth Token Exchange Script
 * 
 * 1. Opens browser to Figma authorization page
 * 2. Starts a local server to capture the callback
 * 3. Exchanges the authorization code for access + refresh tokens
 * 4. Prints the FIGMA_REFRESH_TOKEN to add to .env
 * 
 * Usage: node scripts/figma-oauth.cjs
 */

const http = require('http');
const { exec } = require('child_process');
require('dotenv').config();

const CLIENT_ID = process.env.FIGMA_CLIENT_ID;
const CLIENT_SECRET = process.env.FIGMA_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3847/callback';
const PORT = 3847;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    
    if (!code) {
      res.writeHead(400);
      res.end('Missing authorization code');
      return;
    }

    console.log('\n✅ Authorization code received. Exchanging for tokens...');

    try {
      const tokenRes = await fetch('https://api.figma.com/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          code: code,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error(`❌ Token exchange failed (${tokenRes.status}): ${errText}`);
        res.writeHead(500);
        res.end('Token exchange failed: ' + errText);
        server.close();
        process.exit(1);
      }

      const data = await tokenRes.json();
      
      console.log('\n══════════════════════════════════════════');
      console.log('✅ Figma OAuth tokens obtained!');
      console.log('══════════════════════════════════════════');
      console.log(`\nFIGMA_REFRESH_TOKEN=${data.refresh_token}`);
      console.log(`\nAccess token expires in: ${data.expires_in}s`);
      console.log('\nAdd the FIGMA_REFRESH_TOKEN line above to your .env file.');
      console.log('══════════════════════════════════════════\n');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h1>✅ Figma Connected!</h1>
          <p>Refresh token has been printed to the terminal.</p>
          <p>You can close this window.</p>
        </body></html>
      `);

      server.close();
      process.exit(0);
    } catch (err) {
      console.error('❌ Error:', err.message);
      res.writeHead(500);
      res.end('Error: ' + err.message);
      server.close();
      process.exit(1);
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  const scopes = [
    'file_content:read',
    'file_metadata:read',
    'file_comments:read',
    'file_comments:write',
    'file_dev_resources:read',
    'file_dev_resources:write',
    'file_versions:read',
    'library_assets:read',
    'library_content:read',
    'team_library_content:read',
    'projects:read',
    'webhooks:read',
    'webhooks:write',
  ].join(',');

  const authUrl = `https://www.figma.com/oauth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&state=glyphor&response_type=code`;

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     Figma OAuth Authorization Flow           ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║ Opening browser for Figma authorization...   ║');
  console.log('║ If browser doesn\'t open, use the URL below.  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\n' + authUrl + '\n');
  console.log('Waiting for callback on http://localhost:' + PORT + '/callback ...\n');

  // Open browser
  if (process.platform === 'win32') {
    exec(`start "" "${authUrl}"`);
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${cmd} "${authUrl}"`);
  }
});
