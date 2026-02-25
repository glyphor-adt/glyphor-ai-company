"""Quick analysis of GraphRAG node quality in Supabase."""
from supabase import create_client
from graphrag_indexer.config import SUPABASE_URL, SUPABASE_KEY
from collections import Counter

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# Paginate all GraphRAG nodes
all_nodes = []
offset = 0
while True:
    batch = sb.table("kg_nodes").select("title, node_type, content").eq("source_type", "graphrag").range(offset, offset + 999).execute()
    if not batch.data:
        break
    all_nodes.extend(batch.data)
    if len(batch.data) < 1000:
        break
    offset += 1000

print(f"Total GraphRAG nodes: {len(all_nodes)}")

# Junk detection
GENERIC = {
    "summary", "status", "type", "id", "name", "value", "data", "key",
    "result", "error", "message", "content", "title", "description",
    "count", "index", "text", "true", "false", "null", "undefined",
    "object", "array", "string", "number", "boolean", "function",
    "class", "method", "property", "field", "column", "row", "table",
    "list", "item", "element", "node", "edge", "source", "target",
    "weight", "score", "label", "tag", "category", "kind", "mode",
    "state", "action", "event", "task", "run", "step", "phase",
    "stage", "level", "tier", "turn", "round", "cycle", "version",
    "config", "option", "setting", "param", "arg", "input", "output",
    "format", "url", "path", "file", "dir", "log", "info", "debug",
    "warn", "test", "spec", "mock", "stub", "fix", "bug", "todo",
    "note", "comment",
}

junk_array = [n for n in all_nodes if "[]" in n["title"] or "{}" in n["title"]]
junk_short = [n for n in all_nodes if len(n["title"].strip()) <= 2]
junk_generic = [n for n in all_nodes if n["title"].strip().lower() in GENERIC]

print(f"Array notation junk: {len(junk_array)}")
print(f"Too short (<=2 chars): {len(junk_short)}")
print(f"Generic words: {len(junk_generic)}")

all_junk = set(n["title"] for n in junk_array + junk_short + junk_generic)
print(f"Total junk: {len(all_junk)} / {len(all_nodes)} ({100 * len(all_junk) / len(all_nodes):.1f}%)")

# Duplicates
title_counts = Counter(n["title"].strip().upper() for n in all_nodes)
dupes = {k: v for k, v in title_counts.items() if v > 1}
dupe_total = sum(v - 1 for v in dupes.values())
print(f"\nDuplicate titles: {len(dupes)} titles appearing >1 time ({dupe_total} extra copies)")
for k, v in sorted(dupes.items(), key=lambda x: -x[1])[:20]:
    print(f"  {v}x  {k[:70]}")

# Node type distribution
type_counts = Counter(n["node_type"] for n in all_nodes)
print("\n=== NODE TYPES ===")
for t, c in type_counts.most_common():
    print(f"  {c:5d}  {t}")

# Edge types
all_edges = []
offset = 0
while True:
    batch = sb.table("kg_edges").select("edge_type").eq("created_by", "graphrag-indexer").range(offset, offset + 999).execute()
    if not batch.data:
        break
    all_edges.extend(batch.data)
    if len(batch.data) < 1000:
        break
    offset += 1000

edge_types = Counter(e["edge_type"] for e in all_edges)
print(f"\n=== EDGE TYPES ({len(all_edges)} total) ===")
for t, c in edge_types.most_common():
    print(f"  {c:5d}  {t}")

# Sample some junk
if junk_array:
    print("\n=== JUNK SAMPLES (array notation) ===")
    for n in junk_array[:10]:
        print(f"  {n['title']}")
if junk_generic:
    print("\n=== JUNK SAMPLES (generic) ===")
    for n in junk_generic[:10]:
        print(f"  {n['title']}")
