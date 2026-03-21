const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.log('GITHUB_TOKEN_PRESENT=false');
  process.exit(0);
}
console.log('GITHUB_TOKEN_PRESENT=true');
console.log('GITHUB_TOKEN_LEN=' + token.length);
fetch('https://api.github.com/search/code?q=repo:glyphor-adt/glyphor-ai-company+path:packages', {
  headers: {
    Authorization: Bearer ,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'glyphor-healthcheck'
  }
}).then(async (r) => {
  const text = await r.text();
  console.log('GITHUB_CODE_SEARCH_STATUS=' + r.status);
  console.log('GITHUB_CODE_SEARCH_OK=' + r.ok);
  if (!r.ok) {
    console.log('GITHUB_CODE_SEARCH_ERR_SNIPPET=' + text.slice(0, 220).replace(/\s+/g, ' '));
  }
}).catch((e) => {
  console.log('GITHUB_CODE_SEARCH_REQUEST_ERROR=' + e.message);
  process.exit(1);
});
