const fs = require('fs');
const path = require('path');

const baseDir = 'C:\\Users\\KristinaDenney\\source\\repos\\glyphor-ai-company';
const smoketestDir = path.join(baseDir, 'packages', 'smoketest');

console.log('Verifying smoketest package structure...\\n');

const expectedFiles = [
  'package.json',
  'tsconfig.json',
  'README.md',
  'src/types.ts',
  'src/utils/http-client.ts',
  'src/utils/sql-client.ts',
  'src/utils/gcp-client.ts'
];

const expectedDirs = [
  'src',
  'src/layers',
  'src/utils'
];

let allGood = true;

// Check directories
console.log('Checking directories:');
for (const dir of expectedDirs) {
  const dirPath = path.join(smoketestDir, dir);
  const exists = fs.existsSync(dirPath);
  console.log(`  ${exists ? '✓' : '✗'} ${dir}`);
  if (!exists) allGood = false;
}

console.log('\\nChecking files:');
for (const file of expectedFiles) {
  const filePath = path.join(smoketestDir, file);
  const exists = fs.existsSync(filePath);
  const size = exists ? fs.statSync(filePath).size : 0;
  console.log(`  ${exists ? '✓' : '✗'} ${file} ${exists ? `(${size} bytes)` : ''}`);
  if (!exists) allGood = false;
}

console.log('\\n' + '='.repeat(50));
if (allGood) {
  console.log('✓ All files and directories verified successfully!');
  console.log('\\nNext steps:');
  console.log('  cd packages\\\\smoketest');
  console.log('  npm install');
  console.log('  npm run build');
} else {
  console.log('✗ Some files or directories are missing.');
  console.log('\\nPlease run: CREATE_SMOKETEST_COMPLETE.bat');
}
console.log('='.repeat(50));
