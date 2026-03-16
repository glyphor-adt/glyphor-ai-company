/**
 * integration-example.ts
 * 
 * Shows how to replace toolSubsets.ts with toolRetriever.ts
 * in an agent's run.ts file.
 * 
 * BEFORE (current):
 *   const allTools = [
 *     ...createChiefOfStaffTools(),      // Layer 1
 *     ...sharepointTools(),              // Layer 2
 *     ...coreTools(),                    // Layer 2
 *     ...createAgent365McpTools(role),   // Layer 3
 *     ...createGlyphorMcpTools(role),    // Layer 4
 *     ...dynamicTools,                   // Layer 5
 *   ];
 *   const tools = filterAndCapTools(allTools, 128);  // ← toolSubsets.ts guillotine
 *   const result = await model.invoke({ tools, messages });
 * 
 * AFTER (with retriever):
 *   const allTools = [ ...same assembly... ];
 *   const { tools, trace } = await retriever.retrieve(taskContext, config);
 *   const result = await model.invoke({ tools, messages });
 */

import {
  ToolRetriever,
  OpenAIEmbeddingProvider,
  buildTaskContext,
  applyNativeToolSearch,
  generateAllUsageQueries,
  type ToolDefinition,
  type RetrievalConfig,
} from './toolRetriever';

// ─── Singleton Retriever (initialize once at startup) ────────────────────────

let retrieverInstance: ToolRetriever | null = null;

/**
 * Initialize the retriever at app startup.
 * Call this once in your main entry point (e.g., server.ts).
 */
export async function initializeToolRetriever(
  allTools: ToolDefinition[],
  usageQueriesMap?: Map<string, string[]>
): Promise<ToolRetriever> {
  const embedder = new OpenAIEmbeddingProvider(
    process.env.OPENAI_API_KEY!,
    'text-embedding-3-small'  // ~$0.02 per 1M tokens — negligible
  );

  const retriever = new ToolRetriever(embedder);
  await retriever.indexTools(allTools, usageQueriesMap);

  retrieverInstance = retriever;
  return retriever;
}

export function getRetriever(): ToolRetriever {
  if (!retrieverInstance) {
    throw new Error('Tool retriever not initialized. Call initializeToolRetriever() at startup.');
  }
  return retrieverInstance;
}


// ─── Example: Agent run.ts (Before vs After) ────────────────────────────────

/**
 * BEFORE: What a typical agent run.ts looked like with toolSubsets.ts
 */
async function runAgentBefore(
  role: string,
  department: string,
  model: string,
  messages: any[]
) {
  // Assemble all tools from 5 layers
  const allTools: any[] = [
    // ...createRoleSpecificTools(role),
    // ...createSharepointTools(),
    // ...createCoreTools(),
    // ...createGraphTools(),
    // ...createCollectiveIntelligenceTools(),
    // ...createAgent365McpTools(role),
    // ...createGlyphorMcpTools(role),
    // ...loadDynamicTools(),
  ];

  // OLD: Dumb cap that drops search_sharepoint
  // const tools = filterAndCapTools(allTools, 128);

  // return model.invoke({ tools, messages });
}

/**
 * AFTER: Same agent run.ts with intelligent retrieval
 */
async function runAgentAfter(
  role: string,
  department: string,
  model: string,
  messages: any[]
) {
  const retriever = getRetriever();

  // Assemble all tools from 5 layers (unchanged)
  const allTools: ToolDefinition[] = [
    // ...createRoleSpecificTools(role),
    // ...createSharepointTools(),
    // ...createCoreTools(),
    // ...createGraphTools(),
    // ...createCollectiveIntelligenceTools(),
    // ...createAgent365McpTools(role),
    // ...createGlyphorMcpTools(role),
    // ...loadDynamicTools(),
  ];

  // Build rich task context from the latest user/agent message
  const lastMessage = messages[messages.length - 1]?.content || '';
  const taskContext = buildTaskContext(
    lastMessage,
    role,
    department,
    // Optional: pass recent tool calls for continuity
    // e.g., ['search_sharepoint', 'send_message']
  );

  // NEW: Intelligent retrieval
  const { tools, trace } = await retriever.retrieve(taskContext, {
    model,
    department,
    agentRole: role,
  });

  // Optional: For Claude 4.5+/4.6, add native tool search as second safety net
  const finalTools = applyNativeToolSearch(
    tools,
    model,
    new Set(trace.pinnedTools)
  );

  // Log for debugging (remove in prod or send to observability)
  console.log(`[${role}] Retrieved ${tools.length}/${allTools.length} tools for model ${model}`);
  console.log(`[${role}] Pinned: ${trace.pinnedTools.join(', ')}`);
  console.log(`[${role}] Top retrieved: ${trace.retrievedTools.slice(0, 5).map(t => `${t.name}(${t.score.toFixed(3)})`).join(', ')}`);

  // return model.invoke({ tools: finalTools, messages });
}


// ─── Setup Script: Generate Tool2Vec Queries ─────────────────────────────────

/**
 * Run this ONCE to generate usage queries for all tools.
 * Save the output to your DB (tool_registry table) or a JSON file.
 * 
 * Example: npx ts-node scripts/generateToolQueries.ts
 */
async function setupTool2VecQueries() {
  // Load all your tools (same assembly as run.ts)
  const allTools: ToolDefinition[] = [
    // ... assemble from all 5 layers
  ];

  // Use any LLM to generate the usage queries
  const llmCall = async (prompt: string): Promise<string> => {
    // Example using OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini', // cheap and fast for this
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      }),
    });
    const data = await response.json() as any;
    return data.choices[0].message.content;
  };

  console.log('Generating Tool2Vec usage queries...');
  const usageQueriesMap = await generateAllUsageQueries(allTools, llmCall, 8);

  // Save to file for loading at startup
  const output: Record<string, string[]> = {};
  for (const [name, queries] of usageQueriesMap) {
    output[name] = queries;
  }

  const fs = await import('fs');
  fs.writeFileSync(
    'tool2vec-queries.json',
    JSON.stringify(output, null, 2)
  );

  console.log(`Generated queries for ${usageQueriesMap.size} tools → tool2vec-queries.json`);
}


// ─── Startup Wiring ──────────────────────────────────────────────────────────

/**
 * Example startup sequence.
 * Call from your main server.ts or wherever agents are initialized.
 */
async function startup() {
  // 1. Assemble all tools
  const allTools: ToolDefinition[] = [
    // ... assemble from all 5 layers
  ];

  // 2. Load pre-generated Tool2Vec queries
  const fs = await import('fs');
  let usageQueriesMap: Map<string, string[]> | undefined;

  try {
    const raw = JSON.parse(fs.readFileSync('tool2vec-queries.json', 'utf-8'));
    usageQueriesMap = new Map(Object.entries(raw));
    console.log(`Loaded Tool2Vec queries for ${usageQueriesMap.size} tools`);
  } catch {
    console.warn('No tool2vec-queries.json found — falling back to description-based embeddings');
  }

  // 3. Initialize the retriever (indexes + embeds all tools)
  const retriever = await initializeToolRetriever(allTools, usageQueriesMap);
  console.log(`Tool retriever ready: ${retriever.getStats().totalTools} tools indexed`);

  // 4. Optional: Debug a specific tool's retrievability
  const debug = await retriever.debugToolRetrieval(
    'search_sharepoint',
    'find the Q3 marketing deck on our file server'
  );
  console.log('search_sharepoint debug:', debug);
  // Expected: { exists: true, bm25Rank: 2, vectorRank: 1, vectorScore: 0.87, bm25Score: 4.2 }
}


// ─── DB Integration: Persist Tool2Vec in tool_registry ───────────────────────

/**
 * Alternative to JSON file: store Tool2Vec queries in your existing
 * tool_registry table. Add a column:
 * 
 *   ALTER TABLE tool_registry
 *   ADD COLUMN usage_queries JSONB DEFAULT '[]'::jsonb;
 * 
 * Then load at startup:
 */
async function loadUsageQueriesFromDB(
  db: any // your DB client
): Promise<Map<string, string[]>> {
  const rows = await db.query(`
    SELECT name, usage_queries 
    FROM tool_registry 
    WHERE is_active = true 
    AND usage_queries IS NOT NULL
    AND jsonb_array_length(usage_queries) > 0
  `);

  const map = new Map<string, string[]>();
  for (const row of rows) {
    map.set(row.name, row.usage_queries);
  }
  return map;
}

/**
 * Save generated queries back to DB:
 */
async function saveUsageQueriesToDB(
  db: any,
  queriesMap: Map<string, string[]>
): Promise<void> {
  for (const [name, queries] of queriesMap) {
    await db.query(`
      UPDATE tool_registry 
      SET usage_queries = $1::jsonb 
      WHERE name = $2
    `, [JSON.stringify(queries), name]);
  }
}
