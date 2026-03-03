# GraphRAG Indexer

Auto-tuned entity extraction pipeline for the Glyphor knowledge graph.

Uses [Microsoft GraphRAG](https://microsoft.github.io/graphrag/) to:
1. **Auto-tune prompts** — adapts entity extraction prompts to Glyphor's domain (AI agents, products, infrastructure, competitive landscape)
2. **Extract entities & relationships** — from company knowledge docs and completed agent work outputs
3. **Sync to Supabase** — writes extracted entities into `kg_nodes` / `kg_edges` alongside agent-contributed knowledge

## Setup

```bash
cd packages/graphrag-indexer

# Create virtual environment
python -m venv .venv
```

**Activate virtual environment:**

On Linux/macOS:
```bash
source .venv/bin/activate
```

On Windows (PowerShell):
```powershell
.\.venv\Scripts\Activate.ps1
```

On Windows (Command Prompt):
```cmd
.venv\Scripts\activate.bat
```

**Install dependencies:**
```bash
pip install -r requirements.txt
```

## Usage

### Auto Prompt Tuning (run once, then periodically as domain evolves)
```bash
python -m graphrag_indexer.tune
```

### Run Entity Extraction
```bash
# Index company knowledge docs
python -m graphrag_indexer.index --source docs

# Index completed agent assignment outputs
python -m graphrag_indexer.index --source assignments

# Full indexing (both)
python -m graphrag_indexer.index --source all
```

### HTTP Trigger (called by scheduler)
```bash
python -m graphrag_indexer.server
```

## Architecture

```
graphrag_indexer/
├── __init__.py
├── config.py           # GraphRAG + Supabase config
├── collector.py        # Collects documents from knowledge base + Supabase
├── extractor.py        # Entity extraction using tuned prompts
├── bridge.py           # Syncs GraphRAG output → kg_nodes / kg_edges
├── tune.py             # Auto prompt tuning entry point
├── index.py            # Indexing entry point
└── server.py           # HTTP server for scheduler triggers
```

The indexer uses Gemini for entity extraction (same LLM as the agents) and
`gemini-embedding-001` for embeddings (matching the existing 768-dim vectors in `kg_nodes`).
