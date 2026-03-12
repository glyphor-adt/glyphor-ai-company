import { cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
cpSync(resolve(root, 'src/config'), resolve(root, 'dist/config'), { recursive: true });
