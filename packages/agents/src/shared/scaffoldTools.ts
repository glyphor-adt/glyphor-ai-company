/**
 * Scaffold Tools — Component and page scaffolding
 *
 * Tools:
 *   scaffold_component  — Generate React component from template
 *   scaffold_page       — Generate new page with routing
 *   list_templates      — List available templates
 *   clone_and_modify    — Clone existing component as starting point
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import {
  createOrUpdateFile,
  getFileContents,
  GLYPHOR_REPOS,
} from '@glyphor/integrations';

/* ─── Component Templates ────────────────────────────────────────────── */

const COMPONENT_TEMPLATES: Record<string, (name: string, withTests: boolean, withStorybook: boolean) => Record<string, string>> = {
  card: (name, withTests, withStorybook) => {
    const files: Record<string, string> = {};
    files[`${name}.tsx`] = `import React from 'react';\n\ninterface ${name}Props {\n  title: string;\n  children: React.ReactNode;\n}\n\nexport function ${name}({ title, children }: ${name}Props) {\n  return (\n    <div className="rounded-lg border bg-card p-6 shadow-sm">\n      <h3 className="text-lg font-semibold">{title}</h3>\n      <div className="mt-2">{children}</div>\n    </div>\n  );\n}\n`;
    if (withTests) files[`${name}.test.tsx`] = `import { render, screen } from '@testing-library/react';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  it('renders title', () => {\n    render(<${name} title="Test">Content</${name}>);\n    expect(screen.getByText('Test')).toBeInTheDocument();\n  });\n});\n`;
    if (withStorybook) files[`${name}.stories.tsx`] = `import type { Meta, StoryObj } from '@storybook/react';\nimport { ${name} } from './${name}';\n\nconst meta: Meta<typeof ${name}> = {\n  title: 'Components/${name}',\n  component: ${name},\n};\n\nexport default meta;\ntype Story = StoryObj<typeof ${name}>;\n\nexport const Default: Story = {\n  args: {\n    title: 'Card Title',\n    children: 'Card content goes here.',\n  },\n};\n`;
    return files;
  },

  page: (name, withTests, withStorybook) => {
    const files: Record<string, string> = {};
    files[`${name}.tsx`] = `import React from 'react';\n\nexport function ${name}() {\n  return (\n    <div className="container mx-auto py-8">\n      <h1 className="text-2xl font-bold">${name}</h1>\n      <div className="mt-6">{/* Page content */}</div>\n    </div>\n  );\n}\n`;
    if (withTests) files[`${name}.test.tsx`] = `import { render, screen } from '@testing-library/react';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  it('renders heading', () => {\n    render(<${name} />);\n    expect(screen.getByText('${name}')).toBeInTheDocument();\n  });\n});\n`;
    if (withStorybook) files[`${name}.stories.tsx`] = `import type { Meta, StoryObj } from '@storybook/react';\nimport { ${name} } from './${name}';\n\nconst meta: Meta<typeof ${name}> = {\n  title: 'Pages/${name}',\n  component: ${name},\n};\n\nexport default meta;\ntype Story = StoryObj<typeof ${name}>;\n\nexport const Default: Story = {};\n`;
    return files;
  },

  layout: (name, withTests, withStorybook) => {
    const files: Record<string, string> = {};
    files[`${name}.tsx`] = `import React from 'react';\n\ninterface ${name}Props {\n  children: React.ReactNode;\n}\n\nexport function ${name}({ children }: ${name}Props) {\n  return (\n    <div className="flex min-h-screen">\n      <aside className="w-64 border-r bg-muted p-4">{/* Sidebar */}</aside>\n      <main className="flex-1 p-6">{children}</main>\n    </div>\n  );\n}\n`;
    if (withTests) files[`${name}.test.tsx`] = `import { render, screen } from '@testing-library/react';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  it('renders children', () => {\n    render(<${name}><span>Content</span></${name}>);\n    expect(screen.getByText('Content')).toBeInTheDocument();\n  });\n});\n`;
    if (withStorybook) files[`${name}.stories.tsx`] = `import type { Meta, StoryObj } from '@storybook/react';\nimport { ${name} } from './${name}';\n\nconst meta: Meta<typeof ${name}> = {\n  title: 'Layouts/${name}',\n  component: ${name},\n};\n\nexport default meta;\ntype Story = StoryObj<typeof ${name}>;\n\nexport const Default: Story = {\n  args: {\n    children: 'Layout content goes here.',\n  },\n};\n`;
    return files;
  },

  widget: (name, withTests, withStorybook) => {
    const files: Record<string, string> = {};
    files[`${name}.tsx`] = `import React from 'react';\n\ninterface ${name}Props {\n  label: string;\n  value: string | number;\n}\n\nexport function ${name}({ label, value }: ${name}Props) {\n  return (\n    <div className="rounded-md border bg-card p-4">\n      <span className="text-sm text-muted-foreground">{label}</span>\n      <p className="mt-1 text-2xl font-bold">{value}</p>\n    </div>\n  );\n}\n`;
    if (withTests) files[`${name}.test.tsx`] = `import { render, screen } from '@testing-library/react';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  it('renders label and value', () => {\n    render(<${name} label="Metric" value={42} />);\n    expect(screen.getByText('Metric')).toBeInTheDocument();\n    expect(screen.getByText('42')).toBeInTheDocument();\n  });\n});\n`;
    if (withStorybook) files[`${name}.stories.tsx`] = `import type { Meta, StoryObj } from '@storybook/react';\nimport { ${name} } from './${name}';\n\nconst meta: Meta<typeof ${name}> = {\n  title: 'Components/${name}',\n  component: ${name},\n};\n\nexport default meta;\ntype Story = StoryObj<typeof ${name}>;\n\nexport const Default: Story = {\n  args: {\n    label: 'Total Users',\n    value: 1234,\n  },\n};\n`;
    return files;
  },

  form: (name, withTests, withStorybook) => {
    const files: Record<string, string> = {};
    files[`${name}.tsx`] = `import React, { useState } from 'react';\n\ninterface ${name}Props {\n  onSubmit: (data: Record<string, string>) => void;\n}\n\nexport function ${name}({ onSubmit }: ${name}Props) {\n  const [values, setValues] = useState<Record<string, string>>({});\n\n  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {\n    setValues((prev) => ({ ...prev, [field]: e.target.value }));\n  };\n\n  const handleSubmit = (e: React.FormEvent) => {\n    e.preventDefault();\n    onSubmit(values);\n  };\n\n  return (\n    <form onSubmit={handleSubmit} className="space-y-4">\n      <div>\n        <label className="block text-sm font-medium">Field</label>\n        <input\n          type="text"\n          onChange={handleChange('field')}\n          className="mt-1 w-full rounded-md border px-3 py-2"\n        />\n      </div>\n      <button type="submit" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">\n        Submit\n      </button>\n    </form>\n  );\n}\n`;
    if (withTests) files[`${name}.test.tsx`] = `import { render, screen, fireEvent } from '@testing-library/react';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  it('calls onSubmit when submitted', () => {\n    const handleSubmit = jest.fn();\n    render(<${name} onSubmit={handleSubmit} />);\n    fireEvent.click(screen.getByText('Submit'));\n    expect(handleSubmit).toHaveBeenCalled();\n  });\n});\n`;
    if (withStorybook) files[`${name}.stories.tsx`] = `import type { Meta, StoryObj } from '@storybook/react';\nimport { ${name} } from './${name}';\n\nconst meta: Meta<typeof ${name}> = {\n  title: 'Components/${name}',\n  component: ${name},\n};\n\nexport default meta;\ntype Story = StoryObj<typeof ${name}>;\n\nexport const Default: Story = {\n  args: {\n    onSubmit: (data) => console.log('Submitted:', data),\n  },\n};\n`;
    return files;
  },

  modal: (name, withTests, withStorybook) => {
    const files: Record<string, string> = {};
    files[`${name}.tsx`] = `import React from 'react';\n\ninterface ${name}Props {\n  open: boolean;\n  onClose: () => void;\n  title: string;\n  children: React.ReactNode;\n}\n\nexport function ${name}({ open, onClose, title, children }: ${name}Props) {\n  if (!open) return null;\n\n  return (\n    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">\n      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">\n        <div className="flex items-center justify-between">\n          <h2 className="text-lg font-semibold">{title}</h2>\n          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">\n            &times;\n          </button>\n        </div>\n        <div className="mt-4">{children}</div>\n      </div>\n    </div>\n  );\n}\n`;
    if (withTests) files[`${name}.test.tsx`] = `import { render, screen, fireEvent } from '@testing-library/react';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  it('renders when open', () => {\n    render(<${name} open={true} onClose={() => {}} title="Test Modal">Content</${name}>);\n    expect(screen.getByText('Test Modal')).toBeInTheDocument();\n  });\n\n  it('does not render when closed', () => {\n    const { container } = render(<${name} open={false} onClose={() => {}} title="Test Modal">Content</${name}>);\n    expect(container.firstChild).toBeNull();\n  });\n});\n`;
    if (withStorybook) files[`${name}.stories.tsx`] = `import type { Meta, StoryObj } from '@storybook/react';\nimport { ${name} } from './${name}';\n\nconst meta: Meta<typeof ${name}> = {\n  title: 'Components/${name}',\n  component: ${name},\n};\n\nexport default meta;\ntype Story = StoryObj<typeof ${name}>;\n\nexport const Default: Story = {\n  args: {\n    open: true,\n    onClose: () => {},\n    title: 'Modal Title',\n    children: 'Modal content goes here.',\n  },\n};\n`;
    return files;
  },

  table: (name, withTests, withStorybook) => {
    const files: Record<string, string> = {};
    files[`${name}.tsx`] = `import React from 'react';\n\ninterface Column<T> {\n  key: keyof T;\n  header: string;\n}\n\ninterface ${name}Props<T extends Record<string, unknown>> {\n  columns: Column<T>[];\n  data: T[];\n}\n\nexport function ${name}<T extends Record<string, unknown>>({ columns, data }: ${name}Props<T>) {\n  return (\n    <div className="overflow-x-auto rounded-lg border">\n      <table className="w-full text-sm">\n        <thead className="border-b bg-muted">\n          <tr>\n            {columns.map((col) => (\n              <th key={String(col.key)} className="px-4 py-2 text-left font-medium">\n                {col.header}\n              </th>\n            ))}\n          </tr>\n        </thead>\n        <tbody>\n          {data.map((row, i) => (\n            <tr key={i} className="border-b last:border-0">\n              {columns.map((col) => (\n                <td key={String(col.key)} className="px-4 py-2">\n                  {String(row[col.key] ?? '')}\n                </td>\n              ))}\n            </tr>\n          ))}\n        </tbody>\n      </table>\n    </div>\n  );\n}\n`;
    if (withTests) files[`${name}.test.tsx`] = `import { render, screen } from '@testing-library/react';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  it('renders columns and data', () => {\n    const columns = [{ key: 'name' as const, header: 'Name' }];\n    const data = [{ name: 'Alice' }];\n    render(<${name} columns={columns} data={data} />);\n    expect(screen.getByText('Name')).toBeInTheDocument();\n    expect(screen.getByText('Alice')).toBeInTheDocument();\n  });\n});\n`;
    if (withStorybook) files[`${name}.stories.tsx`] = `import type { Meta, StoryObj } from '@storybook/react';\nimport { ${name} } from './${name}';\n\nconst meta: Meta<typeof ${name}> = {\n  title: 'Components/${name}',\n  component: ${name},\n};\n\nexport default meta;\ntype Story = StoryObj<typeof ${name}>;\n\nexport const Default: Story = {\n  args: {\n    columns: [\n      { key: 'name', header: 'Name' },\n      { key: 'role', header: 'Role' },\n    ],\n    data: [\n      { name: 'Alice', role: 'Engineer' },\n      { name: 'Bob', role: 'Designer' },\n    ],\n  },\n};\n`;
    return files;
  },
};

/* ─── Template Descriptions ──────────────────────────────────────────── */

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  card: 'Bordered card component with title and children content area',
  page: 'Full page component with container layout and heading',
  layout: 'Page layout with sidebar navigation and main content area',
  widget: 'Compact display widget with label and value (e.g. dashboard metrics)',
  form: 'Form component with controlled inputs and submit handler',
  modal: 'Modal dialog overlay with title, close button, and children content',
  table: 'Generic data table with configurable columns and row rendering',
};

/* ─── Layout Templates for scaffold_page ─────────────────────────────── */

const LAYOUT_WRAPPERS: Record<string, (content: string) => string> = {
  sidebar: (content) =>
    `    <div className="flex min-h-screen">\n      <aside className="w-64 border-r bg-muted p-4">{/* Sidebar */}</aside>\n      <main className="flex-1 p-6">\n${content}\n      </main>\n    </div>`,
  fullwidth: (content) =>
    `    <div className="w-full">\n      <main className="p-6">\n${content}\n      </main>\n    </div>`,
  centered: (content) =>
    `    <div className="flex min-h-screen items-center justify-center">\n      <main className="w-full max-w-3xl p-6">\n${content}\n      </main>\n    </div>`,
};

/* ─── Helpers ────────────────────────────────────────────────────────── */

function validateBranch(branch: string): ToolResult | null {
  if (!branch.startsWith('feature/design-')) {
    return { success: false, error: 'Branch must start with "feature/design-"' };
  }
  return null;
}

function validatePascalCase(name: string): ToolResult | null {
  if (!/^[A-Z][A-Za-z0-9]+$/.test(name)) {
    return { success: false, error: `Name "${name}" must be PascalCase (start with uppercase, alphanumeric only)` };
  }
  return null;
}

/* ─── Factory ────────────────────────────────────────────────────────── */

export function createScaffoldTools(): ToolDefinition[] {
  return [
    /* ─── Scaffold component ─── */
    {
      name: 'scaffold_component',
      description:
        'Generate a new React component from a template. Creates component file, optional test file, ' +
        'and optional Storybook story on a feature/design-* branch.',
      parameters: {
        name: {
          type: 'string',
          description: 'PascalCase component name (e.g. UserCard, SettingsModal)',
          required: true,
        },
        type: {
          type: 'string',
          description: 'Template type to scaffold from',
          required: true,
          enum: ['card', 'page', 'layout', 'widget', 'form', 'modal', 'table'],
        },
        with_tests: {
          type: 'boolean',
          description: 'Generate test file (default: true)',
          required: false,
        },
        with_storybook: {
          type: 'boolean',
          description: 'Generate Storybook story (default: true)',
          required: false,
        },
        branch: {
          type: 'string',
          description: 'Target branch (must start with "feature/design-")',
          required: true,
        },
        directory: {
          type: 'string',
          description: 'Target directory within the repo (default: packages/dashboard/src/components)',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const name = params.name as string;
          const type = params.type as string;
          const branch = params.branch as string;
          const withTests = params.with_tests !== false;
          const withStorybook = params.with_storybook !== false;
          const directory = (params.directory as string) || 'packages/dashboard/src/components';

          const branchErr = validateBranch(branch);
          if (branchErr) return branchErr;

          const nameErr = validatePascalCase(name);
          if (nameErr) return nameErr;

          const templateFn = COMPONENT_TEMPLATES[type];
          if (!templateFn) {
            return { success: false, error: `Unknown template type "${type}". Available: ${Object.keys(COMPONENT_TEMPLATES).join(', ')}` };
          }

          const files = templateFn(name, withTests, withStorybook);
          const repoName = GLYPHOR_REPOS.company;
          const createdFiles: string[] = [];

          for (const [fileName, content] of Object.entries(files)) {
            const filePath = `${directory}/${name}/${fileName}`;
            await createOrUpdateFile(
              repoName,
              filePath,
              content,
              `scaffold: add ${fileName} for ${name} ${type} component`,
              branch,
            );
            createdFiles.push(filePath);
          }

          return { success: true, data: { component: name, type, branch, files: createdFiles } };
        } catch (err) {
          return { success: false, error: `Failed to scaffold component: ${(err as Error).message}` };
        }
      },
    },

    /* ─── Scaffold page ─── */
    {
      name: 'scaffold_page',
      description:
        'Generate a new page component with layout and optional route configuration ' +
        'on a feature/design-* branch.',
      parameters: {
        name: {
          type: 'string',
          description: 'PascalCase page name (e.g. SettingsPage, DashboardOverview)',
          required: true,
        },
        path: {
          type: 'string',
          description: 'URL path for the page (e.g. /settings, /dashboard/overview)',
          required: true,
        },
        layout: {
          type: 'string',
          description: 'Page layout type (default: sidebar)',
          required: false,
          enum: ['sidebar', 'fullwidth', 'centered'],
        },
        sections: {
          type: 'string',
          description: 'Comma-separated section names to include in the page (e.g. "header,filters,content")',
          required: false,
        },
        branch: {
          type: 'string',
          description: 'Target branch (must start with "feature/design-")',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const name = params.name as string;
          const urlPath = params.path as string;
          const layout = (params.layout as string) || 'sidebar';
          const sections = params.sections ? (params.sections as string).split(',').map((s) => s.trim()) : [];
          const branch = params.branch as string;

          const branchErr = validateBranch(branch);
          if (branchErr) return branchErr;

          const nameErr = validatePascalCase(name);
          if (nameErr) return nameErr;

          const layoutWrapper = LAYOUT_WRAPPERS[layout];
          if (!layoutWrapper) {
            return { success: false, error: `Unknown layout "${layout}". Available: sidebar, fullwidth, centered` };
          }

          // Build section content
          let sectionContent = `        <h1 className="text-2xl font-bold">${name}</h1>`;
          if (sections.length > 0) {
            const sectionBlocks = sections
              .map((s) => `        <section id="${s}" className="mt-6">\n          <h2 className="text-lg font-semibold">${s.charAt(0).toUpperCase() + s.slice(1)}</h2>\n          <div>{/* ${s} content */}</div>\n        </section>`)
              .join('\n');
            sectionContent += '\n' + sectionBlocks;
          }

          const pageBody = layoutWrapper(sectionContent);
          const pageContent = `import React from 'react';\n\nexport function ${name}() {\n  return (\n${pageBody}\n  );\n}\n`;

          const repoName = GLYPHOR_REPOS.company;
          const directory = 'packages/dashboard/src/pages';
          const createdFiles: string[] = [];

          // Write page component
          const pagePath = `${directory}/${name}/${name}.tsx`;
          await createOrUpdateFile(repoName, pagePath, pageContent, `scaffold: add ${name} page`, branch);
          createdFiles.push(pagePath);

          // Write test file
          const testContent = `import { render, screen } from '@testing-library/react';\nimport { ${name} } from './${name}';\n\ndescribe('${name}', () => {\n  it('renders heading', () => {\n    render(<${name} />);\n    expect(screen.getByText('${name}')).toBeInTheDocument();\n  });\n});\n`;
          const testPath = `${directory}/${name}/${name}.test.tsx`;
          await createOrUpdateFile(repoName, testPath, testContent, `scaffold: add ${name} page test`, branch);
          createdFiles.push(testPath);

          // Attempt to update route config
          let routeUpdated = false;
          try {
            const routeConfigPath = 'packages/dashboard/src/routes.tsx';
            const routeFile = await getFileContents(repoName, routeConfigPath, branch);
            if (routeFile) {
              const importLine = `import { ${name} } from './pages/${name}/${name}';\n`;
              const routeLine = `  { path: '${urlPath}', element: <${name} /> },\n`;
              const updatedConfig = importLine + routeFile.content + '\n// Added by scaffold_page\n' + routeLine;
              await createOrUpdateFile(repoName, routeConfigPath, updatedConfig, `scaffold: add route for ${name}`, branch);
              routeUpdated = true;
            }
          } catch {
            // Route config not found or not updatable — continue without error
          }

          return {
            success: true,
            data: {
              page: name,
              urlPath,
              layout,
              sections,
              branch,
              files: createdFiles,
              routeUpdated,
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to scaffold page: ${(err as Error).message}` };
        }
      },
    },

    /* ─── List templates ─── */
    {
      name: 'list_templates',
      description:
        'List all available component and page scaffold templates with descriptions of what each generates.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        const templates = Object.entries(TEMPLATE_DESCRIPTIONS).map(([type, description]) => ({
          type,
          description,
          generates: ['component file (.tsx)', 'test file (.test.tsx)', 'storybook story (.stories.tsx)'],
        }));

        const layouts = Object.keys(LAYOUT_WRAPPERS).map((layout) => ({
          type: layout,
          description:
            layout === 'sidebar' ? 'Side navigation with main content area' :
            layout === 'fullwidth' ? 'Full-width page without sidebar' :
            'Centered content container with max width',
        }));

        return {
          success: true,
          data: { component_templates: templates, page_layouts: layouts },
        };
      },
    },

    /* ─── Clone and modify ─── */
    {
      name: 'clone_and_modify',
      description:
        'Clone an existing component as a starting point for a new one. Reads the source file, ' +
        'renames all component references to the new name, and writes to a feature/design-* branch.',
      parameters: {
        source_path: {
          type: 'string',
          description: 'Path to the existing component file within the repo (e.g. packages/dashboard/src/components/UserCard/UserCard.tsx)',
          required: true,
        },
        new_name: {
          type: 'string',
          description: 'PascalCase name for the new component',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Target branch (must start with "feature/design-")',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const sourcePath = params.source_path as string;
          const newName = params.new_name as string;
          const branch = params.branch as string;

          const branchErr = validateBranch(branch);
          if (branchErr) return branchErr;

          const nameErr = validatePascalCase(newName);
          if (nameErr) return nameErr;

          const repoName = GLYPHOR_REPOS.company;
          const sourceFile = await getFileContents(repoName, sourcePath);
          if (!sourceFile) {
            return { success: false, error: `Source file not found: ${sourcePath}` };
          }

          // Extract the original component name from the file path
          const sourceFileName = sourcePath.split('/').pop() ?? '';
          const originalName = sourceFileName.replace(/\.(tsx?|jsx?)$/, '');
          if (!originalName) {
            return { success: false, error: `Could not determine component name from path: ${sourcePath}` };
          }

          // Replace all references to the original component name
          const newContent = sourceFile.content.replace(
            new RegExp(originalName, 'g'),
            newName,
          );

          // Determine target directory from source path
          const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
          const parentDir = sourceDir.substring(0, sourceDir.lastIndexOf('/'));
          const targetPath = `${parentDir}/${newName}/${newName}.tsx`;

          await createOrUpdateFile(
            repoName,
            targetPath,
            newContent,
            `scaffold: clone ${originalName} as ${newName}`,
            branch,
          );

          return {
            success: true,
            data: {
              source: sourcePath,
              target: targetPath,
              originalName,
              newName,
              branch,
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to clone component: ${(err as Error).message}` };
        }
      },
    },
  ];
}
