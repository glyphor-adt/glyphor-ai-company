import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

interface CliArgs {
  outDir: string;
  initGit: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const outArgIndex = argv.indexOf('--out');
  const outDir = outArgIndex >= 0 ? (argv[outArgIndex + 1] ?? 'artifacts/web-template-react') : 'artifacts/web-template-react';

  return {
    outDir,
    initGit: argv.includes('--init-git'),
  };
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, 'utf8');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = path.resolve(process.cwd(), args.outDir);

  ensureDir(outRoot);

  const files: Record<string, string> = {
    'package.json': JSON.stringify(
      {
        name: 'web-template-react',
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc --noEmit && vite build',
          lint: 'eslint .',
          typecheck: 'tsc --noEmit',
          preview: 'vite preview',
        },
        dependencies: {
          '@radix-ui/react-toast': '^1.2.15',
          '@radix-ui/react-tooltip': '^1.2.8',
          '@tanstack/react-query': '^5.90.5',
          'class-variance-authority': '^0.7.1',
          clsx: '^2.1.1',
          'framer-motion': '^12.23.24',
          'lucide-react': '^0.542.0',
          react: '^19.1.1',
          'react-dom': '^19.1.1',
          'tailwind-merge': '^3.3.1',
        },
        devDependencies: {
          '@eslint/js': '^9.31.0',
          '@types/node': '^22.18.6',
          '@types/react': '^19.1.16',
          '@types/react-dom': '^19.1.9',
          '@vitejs/plugin-react-swc': '^4.1.0',
          eslint: '^9.37.0',
          'eslint-plugin-react-hooks': '^5.2.0',
          'eslint-plugin-react-refresh': '^0.4.20',
          globals: '^16.4.0',
          prettier: '^3.6.2',
          tailwindcss: '^4.1.12',
          typescript: '^5.9.2',
          'typescript-eslint': '^8.41.0',
          vite: '^7.1.7',
        },
      },
      null,
      2,
    ) + '\n',

    'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "baseUrl": ".",
    "paths": {
      "@/components/*": ["src/components/*"],
      "@/hooks/*": ["src/hooks/*"],
      "@/lib/*": ["src/lib/*"],
      "@/styles/*": ["src/styles/*"]
    }
  },
  "include": ["src", "vite.config.ts"]
}
`,

    'vite.config.ts': `import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/components': path.resolve(__dirname, 'src/components'),
      '@/hooks': path.resolve(__dirname, 'src/hooks'),
      '@/lib': path.resolve(__dirname, 'src/lib'),
      '@/styles': path.resolve(__dirname, 'src/styles'),
    },
  },
});
`,

    'tailwind.config.ts': `import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        elevated: 'hsl(var(--elevated) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        primary: 'hsl(var(--primary) / <alpha-value>)',
        secondary: 'hsl(var(--secondary) / <alpha-value>)',
        accent: 'hsl(var(--accent) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
      },
    },
  },
};

export default config;
`,

    'eslint.config.js': `import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
`,

    'prettier.config.js': `export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
};
`,

    'index.html': `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Glyphor Web Template</title>
    <meta name="description" content="Glyphor React web template" />
    <meta property="og:title" content="Glyphor Web Template" />
    <meta property="og:description" content="Production-ready React template for Glyphor web builds" />
    <meta property="og:type" content="website" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"
    />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

    'public/favicon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#0A0A0B"/>
  <path d="M14 20h20v8H22v8h10v8H22v8h-8V20z" fill="#00E0FF"/>
  <path d="M40 20h10c6.627 0 12 5.373 12 12v0c0 6.627-5.373 12-12 12h-2v8h-8V20z" fill="#00A3FF"/>
  <rect x="48" y="28" width="4" height="8" rx="2" fill="#FAFAFA"/>
</svg>
`,

    'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';

// DO NOT MODIFY: template entry point contract
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,

    'src/App.tsx': `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Toaster() {
  return null;
}

export function App() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-dvh bg-background text-foreground">
          <main className="mx-auto max-w-5xl px-6 py-20">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-primary">Glyphor Template</p>
            <h1 className="mt-4 max-w-3xl text-balance text-5xl font-semibold leading-[1.05] md:text-6xl">
              Build-ready React foundation for Codex-driven web creation.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
              This starter intentionally keeps components and pages empty so build agents can populate the
              project from a normalized design brief.
            </p>
          </main>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
`,

    'src/lib/utils.ts': `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,

    'src/styles/fonts.css': `:root {
  --font-display: 'Clash Display', 'Satoshi', 'Segoe UI', sans-serif;
  --font-body: 'Satoshi', 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
`,

    'src/styles/tokens.css': `:root {
  --prism-hyper-cyan: #00e0ff;
  --prism-azure: #00a3ff;
  --prism-blue: #1171ed;
  --prism-soft-indigo: #6e77df;

  --prism-background: #0a0a0b;
  --prism-surface: #141416;
  --prism-elevated: #1c1c1e;

  --prism-text: #fafafa;
  --prism-text-muted: #888888;
  --prism-border: rgba(255, 255, 255, 0.06);

  --glass-bg: rgba(255, 255, 255, 0.03);
  --glass-blur: 20px;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 40px;
  --space-6: 48px;
  --space-7: 56px;
  --space-8: 64px;

  --text-xs: 0.75rem;
  --text-sm: 0.9375rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5625rem;
  --text-2xl: 1.9531rem;
  --text-3xl: 2.4414rem;
  --text-4xl: 3.0518rem;
  --text-5xl: 3.8147rem;
  --text-6xl: 4.7684rem;

  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-emphasized: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
}
`,

    'src/styles/theme.css': `:root {
  --background: 240 5% 4%;
  --foreground: 0 0% 98%;
  --surface: 240 4% 9%;
  --elevated: 240 4% 12%;
  --muted-foreground: 0 0% 54%;
  --border: 0 0% 100% / 0.06;

  --primary: 187 100% 50%;
  --secondary: 201 100% 50%;
  --accent: 235 64% 66%;
}

.dark {
  --background: 240 5% 4%;
  --foreground: 0 0% 98%;
  --surface: 240 4% 9%;
  --elevated: 240 4% 12%;
  --muted-foreground: 0 0% 54%;
  --border: 0 0% 100% / 0.06;

  --primary: 187 100% 50%;
  --secondary: 201 100% 50%;
  --accent: 235 64% 66%;
}
`,

    'src/styles/tailwind.css': `@import 'tailwindcss';

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-surface: hsl(var(--surface));
  --color-elevated: hsl(var(--elevated));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-border: hsl(var(--border));
  --color-primary: hsl(var(--primary));
  --color-secondary: hsl(var(--secondary));
  --color-accent: hsl(var(--accent));

  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --font-mono: var(--font-mono);

  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
}
`,

    'src/styles/global.css': `*, *::before, *::after {
  box-sizing: border-box;
}

* {
  margin: 0;
}

html, body, #root {
  min-height: 100%;
}

body {
  font-family: var(--font-body);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

a {
  color: inherit;
  text-decoration: none;
}
`,

    'src/styles/index.css': `@import './fonts.css';
@import './tailwind.css';
@import './theme.css';
@import './tokens.css';
@import './global.css';
`,

    '.codex/skills/ux-engineer/SKILL.md': `---
name: ux-engineer
description: >
  Build complete, production-ready websites from a design brief.
  Generates all files in a single pass with award-winning design quality.
  Trigger when asked to build a website, landing page, web app, or any web-facing product.
---

## Design Rules

- Banned fonts: Inter, Roboto, Open Sans, Poppins, system-ui as primary.
- Token-only color usage: no hardcoded hex/rgb in className strings.
- Enforce 70/20/10 composition for neutral/support/accent use.
- Require surface ladder separation across sections.
- Ban centered-everything three-column SaaS template structures.
- Require asymmetry, hierarchy, and intentional negative space.
- Require interaction budget minimums and choreographed animation.
- Use Lucide React for icons, never emoji.
- Use text wordmark only for logos.
- Require image manifest references to /images/* with CSS fallbacks.
- Max 7 generated images unless brief explicitly justifies more.

## Implementation Rules

- Stack: React + TypeScript + Tailwind + shadcn/ui + Framer Motion.
- File contract: create only approved app files; do not modify template bootstrap files unless required.
- Package rules: additive dependency changes only.
- Use token bridge variables for all design colors and spacing.
- Favor shadcn primitives for reliability; use cinematic components sparingly.

## Media Handling

- Reference all assets as /images/{name}.{ext} or /videos/{name}.{ext}.
- Include image_manifest entries for every referenced media asset.
- Assume media is generated post-build via Pulse.
- Provide visual fallback states before media exists.

## Quality Enforcement

- Include design_plan with sections, color_strategy, interaction_budget, brief_alignment.
- Require 3+ distinct surfaces for pages with 4+ sections.
- Restrict accent color to CTA and highlight usage.
- Verify section coverage, interaction coverage, and responsive behavior before completion.

## Common Deductions To Avoid

- Hero heading too small on desktop.
- Adjacent sections with identical surface/background treatment.
- Grid cards animating simultaneously with no stagger.
- Missing visible focus ring on interactive controls.
- Hardcoded color values bypassing token system.
`,
  };

  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(outRoot, relativePath, content);
  }

  const scaffoldDirs = [
    'src/components',
    'src/pages',
    'src/hooks',
    'public/images',
    'public/videos',
  ];

  for (const dir of scaffoldDirs) {
    ensureDir(path.join(outRoot, dir));
  }

  if (args.initGit) {
    execSync('git init', { cwd: outRoot, stdio: 'inherit' });
  }

  process.stdout.write(`Scaffold created at ${outRoot}\n`);
  process.stdout.write('Next steps:\n');
  process.stdout.write(`  cd ${outRoot}\n`);
  process.stdout.write('  npm install\n');
  process.stdout.write('  npm run build\n');
  process.stdout.write('  npm run lint\n');
  process.stdout.write('  npm run typecheck\n');
}

main();
