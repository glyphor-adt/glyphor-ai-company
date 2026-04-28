import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { CompanyAgentRole, ToolDeclaration } from '../types.js';
import { getAlwaysLoadedTools, supportsAnthropicToolSearch, supportsOpenAIToolSearch } from '../toolSearchConfig.js';

export interface ToolRetrieverRequest {
  model: string;
  taskContext: string;
  role: CompanyAgentRole;
  department?: string;
  maxTools?: number;
  bm25Weight?: number;
}

export interface ToolRetrieverTrace {
  totalCandidates: number;
  pinnedTools: string[];
  /** Breakdown of how pinned tools were selected. */
  rolePins: string[];
  corePins: string[];
  deptPins: string[];
  retrievedTools: Array<{ name: string; score: number; method: 'bm25' | 'vector' | 'hybrid' }>;
  modelCap: number;
  model: string;
}

export interface ToolRetrieverResult {
  tools: ToolDeclaration[];
  trace: ToolRetrieverTrace;
}

interface ToolIndexEntry {
  tool: ToolDeclaration;
  bm25Tokens: string[];
  vector: number[];
}

const VECTOR_DIMENSIONS = 384;
const DEFAULT_CAP = 40;
const DEFAULT_BM25_WEIGHT = 0.35;

const CORE_PINNED_TOOLS = new Set<string>([
  'save_memory',
  'recall_memories',
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'send_agent_message',
  'check_team_status',
  'check_team_assignments',
  'check_messages',
  'request_tool_access',
  'check_tool_access',
  'list_my_tools',
  'tool_search',
  'search_sharepoint',
  'read_sharepoint_document',
  'upload_to_sharepoint',
  'read_inbox',
  'send_email',
  'reply_to_email',
  'reply_email_with_attachments',
  'forward_email',
  'mark_email_as_read',
  'move_email',
  'get_email_by_id',
  'get_message',
  'list_emails',
  'list_messages',
  'list_inbox',
  'list_mail_folders',
  'read_company_knowledge',
]);

const DEPARTMENT_PINS: Record<string, string[]> = {
  marketing: ['search_sharepoint'],
  finance: ['search_sharepoint', 'revenue_lookup'],
  engineering: ['search_sharepoint'],
  operations: ['search_sharepoint'],
  sales: ['search_sharepoint'],
  design: ['search_sharepoint'],
  product: ['search_sharepoint'],
  legal: ['search_sharepoint'],
  research: ['search_sharepoint'],
  hr: ['search_sharepoint'],
};

const ROLE_TO_DEPARTMENT: Partial<Record<CompanyAgentRole, string>> = {
  'chief-of-staff': 'operations',
  ops: 'operations',
  'adi-rose': 'operations',
  cto: 'engineering',
  'platform-engineer': 'engineering',
  'quality-engineer': 'engineering',
  'devops-engineer': 'engineering',
  cfo: 'finance',
  cmo: 'marketing',
  cpo: 'product',
  clo: 'legal',
  'bob-the-tax-pro': 'legal',
  'vp-design': 'design',
  'vp-research': 'research',
};

const TOOL2VEC_PATH_CANDIDATES = [
  'tool2vec-queries.json',
  'docs/sample-tool2vec-queries.json',
];

function getModelCap(model: string): number {
  if (/^gpt-5\.4(?:-|$)/i.test(model)) return 128;
  if (/^claude-opus-4-7(?:-|$)/i.test(model)) return 128;
  if (/^claude-sonnet-4-6(?:-|$)/i.test(model)) return 100;
  if (/^gpt-5-nano(?:-|$)/i.test(model)) return 20;
  if (/^gpt-5-mini(?:-|$)/i.test(model)) return 40;
  if (/^gpt-5(?:-|$)|^gpt-5\.[12](?:-|$)/i.test(model)) return 64;
  if (/^gpt-4\.1-nano(?:-|$)/i.test(model)) return 20;
  if (/^gpt-4\.1-mini(?:-|$)/i.test(model)) return 40;
  if (/^gpt-4\.1(?:-|$)/i.test(model)) return 64;
  if (/^gemini-3\.1-flash-lite-preview(?:-|$)/i.test(model)) return 25;
  if (/^gemini-3\.1-pro-preview(?:-|$)|^gemini-2\.5-pro(?:-|$)/i.test(model)) return 64;
  return DEFAULT_CAP;
}

function inferDepartment(role: CompanyAgentRole, explicitDepartment?: string): string | undefined {
  return explicitDepartment ?? ROLE_TO_DEPARTMENT[role];
}

function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/[_-]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((token) => token.length > 1);
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    if (token === 'sharepoint' || token === 'onedrive' || token === 'm365') {
      expanded.push('documents', 'files');
    }
    if (token === 'document' || token === 'documents' || token === 'file' || token === 'files') {
      expanded.push('library');
    }
    if (token === 'message' || token === 'messages' || token === 'email' || token === 'teams') {
      expanded.push('communication');
    }
  }
  return expanded;
}

function hashToken(value: string, seed = 0): number {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeVector(vector: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }
  if (norm === 0) return vector;
  const invNorm = 1 / Math.sqrt(norm);
  for (let i = 0; i < vector.length; i++) {
    vector[i] *= invNorm;
  }
  return vector;
}

function vectorizeText(text: string): number[] {
  const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0);
  const normalized = text.toLowerCase();
  const tokens = tokenize(normalized);
  const featureCounts = new Map<string, number>();

  for (const token of tokens) {
    featureCounts.set(token, (featureCounts.get(token) ?? 0) + 1);
    if (token.length >= 5) {
      for (let i = 0; i <= token.length - 3; i++) {
        const trigram = token.slice(i, i + 3);
        featureCounts.set(`tri:${trigram}`, (featureCounts.get(`tri:${trigram}`) ?? 0) + 1);
      }
    }
  }

  for (const [feature, count] of featureCounts.entries()) {
    const index = hashToken(feature) % VECTOR_DIMENSIONS;
    const sign = (hashToken(feature, 17) & 1) === 0 ? 1 : -1;
    const weight = Math.sqrt(count);
    vector[index] += sign * weight;
  }

  return normalizeVector(vector);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

class BM25Index {
  private readonly documents: Array<Map<string, number>> = [];
  private readonly docLengths: number[] = [];
  private readonly docFreq: Map<string, number> = new Map();
  private avgDocLength = 0;
  private readonly k1 = 1.5;
  private readonly b = 0.75;

  addDocument(tokens: string[]): void {
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    this.documents.push(termFreq);
    this.docLengths.push(tokens.length);

    for (const token of new Set(tokens)) {
      this.docFreq.set(token, (this.docFreq.get(token) ?? 0) + 1);
    }

    const totalLength = this.docLengths.reduce((sum, value) => sum + value, 0);
    this.avgDocLength = totalLength / this.docLengths.length;
  }

  search(query: string, topK: number): Array<{ index: number; score: number }> {
    if (this.documents.length === 0) return [];
    const queryTokens = tokenize(query);
    const uniqueQueryTokens = Array.from(new Set(queryTokens));
    const scores: Array<{ index: number; score: number }> = [];
    const totalDocs = this.documents.length;

    for (let i = 0; i < this.documents.length; i++) {
      const doc = this.documents[i];
      const docLength = this.docLengths[i];
      let score = 0;

      for (const queryToken of uniqueQueryTokens) {
        const tf = doc.get(queryToken) ?? 0;
        if (tf === 0) continue;

        const df = this.docFreq.get(queryToken) ?? 0;
        if (df === 0) continue;

        const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
        const normFactor = tf + this.k1 * (1 - this.b + this.b * (docLength / (this.avgDocLength || 1)));
        score += idf * ((tf * (this.k1 + 1)) / normFactor);
      }

      if (score > 0) {
        scores.push({ index: i, score });
      }
    }

    scores.sort((left, right) => right.score - left.score);
    return scores.slice(0, topK);
  }
}

function toUsageQueryMap(
  input?: Map<string, string[]> | Record<string, string[]>,
): Map<string, string[]> {
  if (!input) return new Map();
  if (input instanceof Map) return new Map(input);
  return new Map(Object.entries(input));
}

function buildToolText(tool: ToolDeclaration, usageQueries: string[]): string {
  const parameterNames = Object.keys(tool.parameters.properties ?? {});
  return [
    tool.name,
    ...splitIdentifier(tool.name),
    tool.description,
    ...parameterNames,
    ...usageQueries,
  ].join(' ');
}

function dedupeToolsByName(tools: ToolDeclaration[]): ToolDeclaration[] {
  const seen = new Set<string>();
  const deduped: ToolDeclaration[] = [];

  for (const tool of tools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    deduped.push(tool);
  }

  return deduped;
}

function loadUsageQueriesFromFile(): Map<string, string[]> {
  for (const candidate of TOOL2VEC_PATH_CANDIDATES) {
    const absolutePath = resolve(process.cwd(), candidate);
    if (!existsSync(absolutePath)) continue;

    try {
      const raw = readFileSync(absolutePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result = new Map<string, string[]>();

      for (const [toolName, maybeQueries] of Object.entries(parsed)) {
        if (!Array.isArray(maybeQueries)) continue;
        const queries = maybeQueries
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        if (queries.length > 0) {
          result.set(toolName, queries);
        }
      }

      if (result.size > 0) {
        console.log(`[ToolRetriever] Loaded Tool2Vec queries from ${candidate} (${result.size} tools)`);
        return result;
      }
    } catch (error) {
      console.warn(`[ToolRetriever] Failed to read ${candidate}:`, (error as Error).message);
    }
  }

  return new Map();
}

export class ToolRetriever {
  private readonly entries: ToolIndexEntry[] = [];
  private readonly toolNameToIndex = new Map<string, number>();
  private bm25 = new BM25Index();
  private indexedSignature = '';
  private usageQueries = new Map<string, string[]>();
  private queriesInitialized = false;

  setUsageQueries(input?: Map<string, string[]> | Record<string, string[]>): void {
    this.usageQueries = toUsageQueryMap(input);
    this.queriesInitialized = true;
    this.indexedSignature = '';
  }

  private ensureQueriesInitialized(): void {
    if (this.queriesInitialized) return;
    this.usageQueries = loadUsageQueriesFromFile();
    this.queriesInitialized = true;
  }

  private computeSignature(tools: ToolDeclaration[]): string {
    const hash = createHash('sha256');
    for (const tool of dedupeToolsByName(tools)) {
      hash.update(tool.name);
      hash.update('\n');
      hash.update(tool.description ?? '');
      hash.update('\n');
      hash.update(JSON.stringify(tool.parameters ?? {}));
      hash.update('\n');
      const queries = this.usageQueries.get(tool.name) ?? [];
      hash.update(JSON.stringify(queries));
      hash.update('\n');
    }
    return hash.digest('hex');
  }

  private indexTools(tools: ToolDeclaration[]): void {
    this.ensureQueriesInitialized();
    const dedupedTools = dedupeToolsByName(tools);
    const signature = this.computeSignature(dedupedTools);
    if (signature === this.indexedSignature) return;

    this.entries.length = 0;
    this.toolNameToIndex.clear();
    this.bm25 = new BM25Index();

    for (let i = 0; i < dedupedTools.length; i++) {
      const tool = dedupedTools[i];
      const usageQueries = this.usageQueries.get(tool.name) ?? [];
      const toolText = buildToolText(tool, usageQueries);
      const bm25Tokens = tokenize(toolText);
      const vector = vectorizeText(toolText);

      this.entries.push({ tool, bm25Tokens, vector });
      this.toolNameToIndex.set(tool.name, i);
      this.bm25.addDocument(bm25Tokens);
    }

    this.indexedSignature = signature;
  }

  async warm(tools: ToolDeclaration[]): Promise<void> {
    this.indexTools(tools);
  }

  async retrieve(
    tools: ToolDeclaration[],
    request: ToolRetrieverRequest,
  ): Promise<ToolRetrieverResult> {
    this.indexTools(tools);

    const modelCap = Math.max(1, request.maxTools ?? getModelCap(request.model));
    const bm25Weight = request.bm25Weight ?? DEFAULT_BM25_WEIGHT;

    // Role-specific pins first — they are the agent's bread-and-butter tools
    // and must survive the model cap slice before generic core pins.
    const rolePinSet = new Set(getAlwaysLoadedTools(request.role));
    const corePinSet = new Set(CORE_PINNED_TOOLS);
    const department = inferDepartment(request.role, request.department);
    const deptPinSet = new Set<string>();
    if (department) {
      for (const toolName of DEPARTMENT_PINS[department] ?? []) {
        deptPinSet.add(toolName);
      }
    }

    const pinnedNames = new Set<string>([
      ...rolePinSet,
      ...corePinSet,
      ...deptPinSet,
    ]);

    const pinnedTools: ToolDeclaration[] = [];
    const pinnedToolNames: string[] = [];
    const rolePinNames: string[] = [];
    const corePinNames: string[] = [];
    const deptPinNames: string[] = [];

    for (const pinnedName of pinnedNames) {
      const index = this.toolNameToIndex.get(pinnedName);
      if (index === undefined) continue;
      pinnedTools.push(this.entries[index].tool);
      pinnedToolNames.push(pinnedName);
      if (rolePinSet.has(pinnedName)) rolePinNames.push(pinnedName);
      else if (deptPinSet.has(pinnedName)) deptPinNames.push(pinnedName);
      else if (corePinSet.has(pinnedName)) corePinNames.push(pinnedName);
    }

    const maxSemanticSlots = Math.max(
      1,
      Number.parseInt(process.env.AGENT_TOOL_RETRIEVER_MAX_SEMANTIC_SLOTS?.trim() ?? '', 10) || 32,
    );
    const remainingSlots = Math.min(
      Math.max(0, modelCap - pinnedTools.length),
      maxSemanticSlots,
    );

    if (remainingSlots === 0) {
      const noSearchTools = this.applyDeferredLoading(
        pinnedTools.slice(0, modelCap),
        request.model,
        new Set(pinnedToolNames),
      );
      return {
        tools: noSearchTools,
        trace: {
          totalCandidates: this.entries.length,
          pinnedTools: pinnedToolNames,
          rolePins: rolePinNames,
          corePins: corePinNames,
          deptPins: deptPinNames,
          retrievedTools: [],
          modelCap,
          model: request.model,
        },
      };
    }

    const queryEmbedding = vectorizeText(request.taskContext);
    const maxCandidateWindow = Math.max(
      25,
      Number.parseInt(process.env.AGENT_TOOL_RETRIEVER_CANDIDATE_WINDOW?.trim() ?? '', 10) || 120,
    );
    const candidateWindow = Math.min(this.entries.length, Math.max(remainingSlots * 4, 25), maxCandidateWindow);

    const bm25Results = this.bm25.search(request.taskContext, candidateWindow);
    const vectorResults = this.entries
      .map((entry, index) => ({ index, score: cosineSimilarity(queryEmbedding, entry.vector) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, candidateWindow);

    const fusedScores = new Map<number, { score: number; method: 'bm25' | 'vector' | 'hybrid' }>();
    const reciprocalRankConstant = 60;

    for (let rank = 0; rank < bm25Results.length; rank++) {
      const index = bm25Results[rank].index;
      const score = bm25Weight / (reciprocalRankConstant + rank + 1);
      fusedScores.set(index, { score, method: 'bm25' });
    }

    const vectorWeight = 1 - bm25Weight;
    for (let rank = 0; rank < vectorResults.length; rank++) {
      const index = vectorResults[rank].index;
      const score = vectorWeight / (reciprocalRankConstant + rank + 1);
      const existing = fusedScores.get(index);
      if (existing) {
        existing.score += score;
        existing.method = 'hybrid';
      } else {
        fusedScores.set(index, { score, method: 'vector' });
      }
    }

    const ranked = Array.from(fusedScores.entries())
      .filter(([index]) => !pinnedNames.has(this.entries[index].tool.name))
      .sort((left, right) => right[1].score - left[1].score)
      .slice(0, remainingSlots)
      .map(([index, ranking]) => ({
        tool: this.entries[index].tool,
        name: this.entries[index].tool.name,
        score: ranking.score,
        method: ranking.method,
      }));

    const selectedTools = this.applyDeferredLoading(
      [...pinnedTools, ...ranked.map((entry) => entry.tool)],
      request.model,
      new Set(pinnedToolNames),
    );

    return {
      tools: selectedTools,
      trace: {
        totalCandidates: this.entries.length,
        pinnedTools: pinnedToolNames,
        rolePins: rolePinNames,
        corePins: corePinNames,
        deptPins: deptPinNames,
        retrievedTools: ranked.map((entry) => ({
          name: entry.name,
          score: entry.score,
          method: entry.method,
        })),
        modelCap,
        model: request.model,
      },
    };
  }

  async debugToolRetrieval(
    tools: ToolDeclaration[],
    toolName: string,
    taskContext: string,
  ): Promise<{
    exists: boolean;
    bm25Rank: number | null;
    vectorRank: number | null;
    vectorScore: number | null;
    bm25Score: number | null;
  }> {
    this.indexTools(tools);

    const index = this.toolNameToIndex.get(toolName);
    if (index === undefined) {
      return {
        exists: false,
        bm25Rank: null,
        vectorRank: null,
        vectorScore: null,
        bm25Score: null,
      };
    }

    const bm25Results = this.bm25.search(taskContext, this.entries.length);
    const vectorQuery = vectorizeText(taskContext);
    const vectorResults = this.entries
      .map((entry, entryIndex) => ({
        index: entryIndex,
        score: cosineSimilarity(vectorQuery, entry.vector),
      }))
      .sort((left, right) => right.score - left.score);

    const bm25Result = bm25Results.find((candidate) => candidate.index === index);
    const vectorResult = vectorResults.find((candidate) => candidate.index === index);

    return {
      exists: true,
      bm25Rank: bm25Result ? bm25Results.indexOf(bm25Result) + 1 : null,
      vectorRank: vectorResult ? vectorResults.indexOf(vectorResult) + 1 : null,
      vectorScore: vectorResult?.score ?? null,
      bm25Score: bm25Result?.score ?? null,
    };
  }

  getStats(): { totalTools: number; indexed: boolean } {
    return {
      totalTools: this.entries.length,
      indexed: this.indexedSignature.length > 0,
    };
  }

  private applyDeferredLoading(
    tools: ToolDeclaration[],
    model: string,
    pinnedToolNames: Set<string>,
  ): ToolDeclaration[] {
    const supportsNativeToolSearch = supportsAnthropicToolSearch(model) || supportsOpenAIToolSearch(model);
    if (!supportsNativeToolSearch) return tools;

    return tools.map((tool) => {
      if (pinnedToolNames.has(tool.name)) {
        if (tool.defer_loading === undefined) return tool;
        const pinnedTool = { ...tool };
        delete pinnedTool.defer_loading;
        return pinnedTool;
      }
      if (tool.defer_loading === true) return tool;
      return {
        ...tool,
        defer_loading: true,
      };
    });
  }
}

const singletonRetriever = new ToolRetriever();

export function getToolRetriever(): ToolRetriever {
  return singletonRetriever;
}

export async function initializeToolRetriever(
  allTools?: ToolDeclaration[],
  usageQueries?: Map<string, string[]> | Record<string, string[]>,
): Promise<ToolRetriever> {
  if (usageQueries) {
    singletonRetriever.setUsageQueries(usageQueries);
  }
  if (allTools?.length) {
    await singletonRetriever.warm(allTools);
  }
  return singletonRetriever;
}

export function buildToolTaskContext(params: {
  message: string;
  task?: string;
  role: CompanyAgentRole;
  department?: string;
  recentTools?: string[];
}): string {
  const parts: string[] = [params.message];

  if (params.task) parts.push(`Task: ${params.task}`);
  parts.push(`Role: ${params.role}`);
  if (params.department) parts.push(`Department: ${params.department}`);

  if (params.recentTools?.length) {
    parts.push(`Recent tools: ${params.recentTools.slice(-5).join(', ')}`);
  }

  return parts.join('\n');
}
