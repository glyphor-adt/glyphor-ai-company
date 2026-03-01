const fs = require('fs');
const path = require('path');

const basePath = 'C:\\Users\\KristinaDenney\\source\\repos\\glyphor-ai-company';

// Create directories
const dirs = [
  'packages\\smoketest',
  'packages\\smoketest\\src',
  'packages\\smoketest\\src\\layers',
  'packages\\smoketest\\src\\utils'
];

console.log('Creating directories...');
dirs.forEach(dir => {
  const fullPath = path.join(basePath, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`✓ Created: ${dir}`);
  } else {
    console.log(`✓ Already exists: ${dir}`);
  }
});

console.log('\nDirectory structure created successfully!');
