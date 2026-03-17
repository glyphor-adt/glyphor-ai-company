const { execSync } = require('child_process');
const fs = require('fs');
try {
  const output = execSync(
    'gcloud builds list --project=ai-glyphor-company --limit=3 --format="csv(id,status,createTime,duration)"',
    { encoding: 'utf8', timeout: 30000 }
  );
  fs.writeFileSync('artifacts/tmp/_builds_result.txt', output);
  console.log('BUILDS:', output);
} catch (e) {
  fs.writeFileSync('artifacts/tmp/_builds_result.txt', 'ERROR: ' + e.message + '\n' + (e.stderr || ''));
  console.error('ERROR:', e.message);
}
