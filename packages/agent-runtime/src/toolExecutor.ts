/**
 * Tool Executor — Manages tool set and dispatches tool calls
 *
 * Ported from Fuse V7 runtime/toolExecutor.ts.
 * Adapted: removed Fuse-specific long-running tools, added company agent tool timeouts.
 */

import type { ToolDefinition, ToolContext, ToolResult, GeminiToolDeclaration } from './types.js';

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const LONG_TOOL_TIMEOUT_MS = 120_000;

// Company tools that legitimately take longer (API calls, report generation)
const LONG_RUNNING_TOOLS = new Set([
  'generate_briefing',
  'analyze_usage',
  'competitive_scan',
  'generate_content',
  'financial_report',
  'health_scoring',
  'kyc_research',
]);

export class ToolExecutor {
  private tools: Map<string, ToolDefinition>;

  constructor(tools: ToolDefinition[]) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }

  addTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  removeTool(name: string): void {
    this.tools.delete(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getDeclarations(): GeminiToolDeclaration[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [
            k,
            {
              type: v.type,
              description: v.description,
              ...(v.enum ? { enum: v.enum } : {}),
              ...(v.items ? { items: v.items } : {}),
              ...(v.properties ? { properties: v.properties } : {}),
            },
          ]),
        ),
        required: Object.entries(t.parameters)
          .filter(([, v]) => v.required)
          .map(([k]) => k),
      },
    }));
  }

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${toolName}`, filesWritten: 0, memoryKeysWritten: 0 };
    }

    if (context.abortSignal.aborted) {
      return { success: false, error: 'Agent aborted before tool execution', filesWritten: 0, memoryKeysWritten: 0 };
    }

    const timeoutMs = LONG_RUNNING_TOOLS.has(toolName) ? LONG_TOOL_TIMEOUT_MS : DEFAULT_TOOL_TIMEOUT_MS;

    try {
      const toolPromise = tool.execute(params, context);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`)), timeoutMs),
      );

      const abortPromise = new Promise<never>((_, reject) => {
        if (context.abortSignal.aborted) {
          reject(new Error('Agent aborted'));
          return;
        }
        context.abortSignal.addEventListener(
          'abort',
          () => reject(new Error('Agent aborted')),
          { once: true },
        );
      });

      const result = await Promise.race([toolPromise, timeoutPromise, abortPromise]);

      return {
        success: result.success,
        data: result.data,
        error: result.error,
        filesWritten: result.filesWritten ?? 0,
        memoryKeysWritten: result.memoryKeysWritten ?? 0,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        filesWritten: 0,
        memoryKeysWritten: 0,
      };
    }
  }
}
