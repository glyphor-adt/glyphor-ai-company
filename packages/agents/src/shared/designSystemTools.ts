/**
 * Design System Tools — Token management, component inventory, and validation
 *
 * Tools:
 *   get_design_tokens               — Read design tokens from source
 *   update_design_token             — Update token on design branch
 *   validate_tokens_vs_implementation — Compare tokens vs CSS usage
 *   get_color_palette               — Extract colors with contrast ratios
 *   get_typography_scale            — Extract typography definitions
 *   list_components                 — Inventory all React components
 *   get_component_usage             — Find component usage across codebase
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import {
  getFileContents,
  getGitHubClient,
  createOrUpdateFile,
  GLYPHOR_REPOS,
  type GlyphorRepo,
} from '@glyphor/integrations';

// ─── WCAG contrast helpers ──────────────────────────────────────────

function luminance(hex: string): number {
  const rgb = [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
  const lin = rgb.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1),
    l2 = luminance(hex2);
  const lighter = Math.max(l1, l2),
    darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ─── Helpers ────────────────────────────────────────────────────────

function repoName(repoKey?: string): string {
  const key = (repoKey || 'company') as GlyphorRepo;
  return GLYPHOR_REPOS[key] ?? GLYPHOR_REPOS.company;
}

/** Try to read a file; returns content string or null. */
async function tryRead(repo: string, path: string): Promise<string | null> {
  const file = await getFileContents(repo, path);
  return file?.content ?? null;
}

/** Very simple extraction of key-value-like tokens from a JS/TS config string. */
function extractTokenBlock(content: string, blockName: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  // Match the block: blockName: { ... }
  const blockRe = new RegExp(`['"]?${blockName}['"]?\\s*:\\s*\\{([^}]*)\\}`, 's');
  const match = content.match(blockRe);
  if (!match) return tokens;
  const inner = match[1];
  const pairRe = /['"]?([\w.-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(inner)) !== null) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

/** Collect all hex color values from a string. */
function findHexColors(content: string): Record<string, string> {
  const colors: Record<string, string> = {};
  const re = /['"]?([\w.-]+)['"]?\s*:\s*['"]?(#[0-9a-fA-F]{3,8})['"]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    colors[m[1]] = m[2];
  }
  return colors;
}

// ─── Token source paths to probe ────────────────────────────────────

const TOKEN_PATHS = [
  'packages/dashboard/tailwind.config.ts',
  'packages/dashboard/tailwind.config.js',
  'packages/design-tokens/index.ts',
  'packages/design-tokens/tokens.ts',
  'packages/design-tokens/src/index.ts',
  'packages/dashboard/src/theme/index.ts',
  'packages/dashboard/src/theme/tokens.ts',
];

const CATEGORY_KEYS: Record<string, string[]> = {
  colors: ['colors', 'color', 'backgroundColor', 'textColor', 'borderColor'],
  spacing: ['spacing', 'space', 'gap', 'margin', 'padding'],
  typography: ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'],
  shadows: ['boxShadow', 'shadow', 'dropShadow'],
  borders: ['borderWidth', 'borderStyle', 'borderColor'],
  radii: ['borderRadius', 'radius'],
  breakpoints: ['screens', 'breakpoints'],
};

// ═════════════════════════════════════════════════════════════════════
// Factory
// ═════════════════════════════════════════════════════════════════════

export function createDesignSystemTools(): ToolDefinition[] {
  return [
    // ─── 1. get_design_tokens ─────────────────────────────────────
    {
      name: 'get_design_tokens',
      description:
        'Read current design tokens from source files (tailwind config, theme files, design-tokens package). ' +
        'Returns tokens organized by category. Use this to understand the design system before proposing changes.',
      parameters: {
        category: {
          type: 'string',
          description: 'Token category to retrieve. Defaults to "all".',
          enum: ['colors', 'spacing', 'typography', 'shadows', 'borders', 'radii', 'breakpoints', 'all'],
        },
        repo: {
          type: 'string',
          description: 'Repository key (default: company).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const repo = repoName(params.repo as string);
        const category = (params.category as string) || 'all';

        try {
          const sources: { path: string; content: string }[] = [];

          for (const p of TOKEN_PATHS) {
            const content = await tryRead(repo, p);
            if (content) sources.push({ path: p, content });
          }

          if (sources.length === 0) {
            return {
              success: false,
              error: 'No token source files found. Checked: ' + TOKEN_PATHS.join(', '),
            };
          }

          const tokens: Record<string, Record<string, string>> = {};

          for (const src of sources) {
            const categoriesToScan =
              category === 'all' ? Object.keys(CATEGORY_KEYS) : [category];

            for (const cat of categoriesToScan) {
              const keys = CATEGORY_KEYS[cat] ?? [cat];
              for (const key of keys) {
                const found = extractTokenBlock(src.content, key);
                if (Object.keys(found).length > 0) {
                  tokens[cat] = { ...tokens[cat], ...found };
                }
              }
            }
          }

          return {
            success: true,
            data: {
              category,
              sourceFiles: sources.map(s => s.path),
              tokens,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to read design tokens: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ─── 2. update_design_token ───────────────────────────────────
    {
      name: 'update_design_token',
      description:
        'Update a specific design token value on a design branch. ' +
        'The branch must start with "feature/design-" to protect production tokens.',
      parameters: {
        token_path: {
          type: 'string',
          description: 'Path to the token file (e.g. packages/dashboard/tailwind.config.ts).',
          required: true,
        },
        token_name: {
          type: 'string',
          description: 'Name of the token to update (e.g. "primary", "spacing-4").',
          required: true,
        },
        new_value: {
          type: 'string',
          description: 'New value for the token.',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Branch to commit on (must start with "feature/design-").',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Explanation for why this token is being changed.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const tokenPath = params.token_path as string;
        const tokenName = params.token_name as string;
        const newValue = params.new_value as string;
        const branch = params.branch as string;
        const reason = params.reason as string;

        if (!branch.startsWith('feature/design-')) {
          return {
            success: false,
            error: 'Branch must start with "feature/design-" to protect production tokens.',
          };
        }

        try {
          const repo = GLYPHOR_REPOS.company;
          const existing = await getFileContents(repo, tokenPath, branch);
          if (!existing) {
            return {
              success: false,
              error: `File not found: ${tokenPath} on branch ${branch}`,
            };
          }

          // Replace the token value — handles both quoted and unquoted values
          const escapedName = tokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const tokenRe = new RegExp(
            `(['"]?${escapedName}['"]?\\s*:\\s*)(['"][^'"]*['"]|[^,\\n}]+)`,
          );
          const match = existing.content.match(tokenRe);
          if (!match) {
            return {
              success: false,
              error: `Token "${tokenName}" not found in ${tokenPath}`,
            };
          }

          const oldValue = match[2].trim();
          const updatedContent = existing.content.replace(
            tokenRe,
            `$1'${newValue}'`,
          );

          const result = await createOrUpdateFile(
            repo,
            tokenPath,
            updatedContent,
            branch,
            `design: update token ${tokenName} — ${reason}`,
          );

          return {
            success: true,
            data: {
              token: tokenName,
              oldValue,
              newValue,
              file: tokenPath,
              branch,
              reason,
              commitSha: result.commit_sha,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to update token: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ─── 3. validate_tokens_vs_implementation ─────────────────────
    {
      name: 'validate_tokens_vs_implementation',
      description:
        'Compare design tokens against actual CSS usage to find hardcoded values that should use tokens ' +
        'and tokens that may be unused. Searches for hardcoded hex colors, rgb(), and hsl() values.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository key (default: company).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const repo = repoName(params.repo as string);

        try {
          // 1. Gather defined tokens
          const definedColors: Record<string, string> = {};
          for (const p of TOKEN_PATHS) {
            const content = await tryRead(repo, p);
            if (content) {
              Object.assign(definedColors, findHexColors(content));
            }
          }

          // 2. Search for hardcoded color values in source files
          const gh = getGitHubClient();
          const org = 'glyphor-adt';
          const hardcodedPatterns = ['color:', 'background:', 'border-color:', 'background-color:'];
          const hardcodedFindings: { file: string; pattern: string }[] = [];

          for (const pattern of hardcodedPatterns) {
            try {
              const { data } = await gh.search.code({
                q: `${pattern} #  repo:${org}/${repo}`,
                per_page: 20,
              });
              for (const item of data.items) {
                hardcodedFindings.push({
                  file: item.path,
                  pattern,
                });
              }
            } catch {
              // Search may rate-limit; continue with other patterns
            }
          }

          // 3. Search for rgb()/hsl() hardcoded values
          for (const fn of ['rgb(', 'hsl(']) {
            try {
              const { data } = await gh.search.code({
                q: `${fn} repo:${org}/${repo}`,
                per_page: 20,
              });
              for (const item of data.items) {
                hardcodedFindings.push({
                  file: item.path,
                  pattern: fn,
                });
              }
            } catch {
              // Continue on rate-limit
            }
          }

          // Deduplicate files
          const uniqueFiles = [...new Set(hardcodedFindings.map(f => f.file))];

          return {
            success: true,
            data: {
              definedTokenCount: Object.keys(definedColors).length,
              definedTokens: definedColors,
              hardcodedColorFiles: uniqueFiles,
              hardcodedFindingCount: hardcodedFindings.length,
              findings: hardcodedFindings,
              recommendation:
                hardcodedFindings.length > 0
                  ? 'Found hardcoded color values that should reference design tokens.'
                  : 'No obvious hardcoded color values detected.',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Validation failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ─── 4. get_color_palette ─────────────────────────────────────
    {
      name: 'get_color_palette',
      description:
        'Extract the current color palette from design tokens and calculate WCAG contrast ratios ' +
        'against white (#ffffff) and black (#000000). Reports AA and AAA compliance for each color.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository key (default: company).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const repo = repoName(params.repo as string);

        try {
          const allColors: Record<string, string> = {};
          for (const p of TOKEN_PATHS) {
            const content = await tryRead(repo, p);
            if (content) {
              Object.assign(allColors, findHexColors(content));
            }
          }

          if (Object.keys(allColors).length === 0) {
            return {
              success: false,
              error: 'No colors found in token source files.',
            };
          }

          const palette = Object.entries(allColors).map(([name, hex]) => {
            // Normalize 3-char hex to 6-char
            const fullHex =
              hex.length === 4
                ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
                : hex;

            const vsWhite = contrastRatio(fullHex, '#ffffff');
            const vsBlack = contrastRatio(fullHex, '#000000');

            return {
              name,
              hex: fullHex,
              contrast: {
                vsWhite: {
                  ratio: Math.round(vsWhite * 100) / 100,
                  aa: vsWhite >= 4.5,
                  aaLarge: vsWhite >= 3,
                  aaa: vsWhite >= 7,
                },
                vsBlack: {
                  ratio: Math.round(vsBlack * 100) / 100,
                  aa: vsBlack >= 4.5,
                  aaLarge: vsBlack >= 3,
                  aaa: vsBlack >= 7,
                },
              },
            };
          });

          return {
            success: true,
            data: {
              colorCount: palette.length,
              palette,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to extract color palette: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ─── 5. get_typography_scale ──────────────────────────────────
    {
      name: 'get_typography_scale',
      description:
        'Extract typography definitions from design tokens — font families, sizes, weights, ' +
        'line heights, and letter spacing. Returns an organized typography scale.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository key (default: company).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const repo = repoName(params.repo as string);

        try {
          const typography: Record<string, Record<string, string>> = {};
          const typoKeys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];

          for (const p of TOKEN_PATHS) {
            const content = await tryRead(repo, p);
            if (!content) continue;
            for (const key of typoKeys) {
              const found = extractTokenBlock(content, key);
              if (Object.keys(found).length > 0) {
                typography[key] = { ...typography[key], ...found };
              }
            }
          }

          if (Object.keys(typography).length === 0) {
            return {
              success: false,
              error: 'No typography definitions found in token source files.',
            };
          }

          return {
            success: true,
            data: { typography },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to extract typography: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ─── 6. list_components ───────────────────────────────────────
    {
      name: 'list_components',
      description:
        'Inventory all React components (.tsx files) in the specified directory. ' +
        'Returns component names, file paths, and directory structure.',
      parameters: {
        directory: {
          type: 'string',
          description: 'Directory to scan (default: packages/dashboard/src/components).',
        },
        repo: {
          type: 'string',
          description: 'Repository key (default: company).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const repo = repoName(params.repo as string);
        const directory = (params.directory as string) || 'packages/dashboard/src/components';
        const gh = getGitHubClient();
        const org = 'glyphor-adt';

        try {
          const components: { name: string; path: string; directory: string }[] = [];

          async function scanDir(dirPath: string): Promise<void> {
            try {
              const { data } = await gh.repos.getContent({
                owner: org,
                repo,
                path: dirPath,
              });
              if (!Array.isArray(data)) return;

              for (const item of data) {
                if (item.type === 'dir') {
                  await scanDir(item.path);
                } else if (item.type === 'file' && item.name.endsWith('.tsx')) {
                  components.push({
                    name: item.name.replace(/\.tsx$/, ''),
                    path: item.path,
                    directory: dirPath,
                  });
                }
              }
            } catch (err) {
              if ((err as any).status !== 404) throw err;
            }
          }

          await scanDir(directory);

          return {
            success: true,
            data: {
              directory,
              componentCount: components.length,
              components,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to list components: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ─── 7. get_component_usage ───────────────────────────────────
    {
      name: 'get_component_usage',
      description:
        'Find everywhere a specific React component is imported and used across the codebase. ' +
        'Searches for import statements and JSX usage via the GitHub search API.',
      parameters: {
        component_name: {
          type: 'string',
          description: 'Name of the component to search for (e.g. "Button", "DataTable").',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository key (default: company).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const componentName = params.component_name as string;
        const repo = repoName(params.repo as string);
        const gh = getGitHubClient();
        const org = 'glyphor-adt';

        try {
          const usages: { file: string; type: 'import' | 'jsx' }[] = [];

          // Search for import statements
          try {
            const { data: importResults } = await gh.search.code({
              q: `import ${componentName} repo:${org}/${repo} language:tsx`,
              per_page: 50,
            });
            for (const item of importResults.items) {
              usages.push({ file: item.path, type: 'import' });
            }
          } catch {
            // Rate-limit or search error — continue
          }

          // Search for JSX usage: <ComponentName
          try {
            const { data: jsxResults } = await gh.search.code({
              q: `<${componentName} repo:${org}/${repo} language:tsx`,
              per_page: 50,
            });
            for (const item of jsxResults.items) {
              if (!usages.some(u => u.file === item.path)) {
                usages.push({ file: item.path, type: 'jsx' });
              }
            }
          } catch {
            // Continue
          }

          return {
            success: true,
            data: {
              component: componentName,
              usageCount: usages.length,
              usages,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to search component usage: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
