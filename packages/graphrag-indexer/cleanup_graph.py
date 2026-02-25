"""Clean up junk and duplicate GraphRAG nodes from Supabase kg_nodes."""
from supabase import create_client
from graphrag_indexer.config import SUPABASE_URL, SUPABASE_KEY
from collections import Counter, defaultdict
import json

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── 1. Delete junk nodes ──────────────────────────────────────────
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

# Paginate all GraphRAG nodes
all_nodes = []
offset = 0
while True:
    batch = sb.table("kg_nodes").select("id, title, node_type, content").eq("source_type", "graphrag").range(offset, offset + 999).execute()
    if not batch.data:
        break
    all_nodes.extend(batch.data)
    if len(batch.data) < 1000:
        break
    offset += 1000

print(f"Total GraphRAG nodes: {len(all_nodes)}")

# Identify junk
junk_ids = set()
for n in all_nodes:
    t = n["title"].strip()
    tl = t.lower()
    if "[]" in t or "{}" in t:
        junk_ids.add(n["id"])
    elif len(t) <= 2:
        junk_ids.add(n["id"])
    elif tl in GENERIC:
        junk_ids.add(n["id"])

print(f"Junk nodes to delete: {len(junk_ids)}")

# Delete junk nodes (edges cascade-deleted via FK)
deleted = 0
for nid in junk_ids:
    sb.table("kg_nodes").delete().eq("id", nid).execute()
    deleted += 1
print(f"Deleted {deleted} junk nodes")

# ── 2. Merge duplicates ──────────────────────────────────────────
# Re-fetch remaining nodes
all_nodes = []
offset = 0
while True:
    batch = sb.table("kg_nodes").select("id, title, node_type, content, times_validated").eq("source_type", "graphrag").range(offset, offset + 999).execute()
    if not batch.data:
        break
    all_nodes.extend(batch.data)
    if len(batch.data) < 1000:
        break
    offset += 1000

# Group by normalized title
by_title = defaultdict(list)
for n in all_nodes:
    key = n["title"].strip().upper()
    by_title[key].append(n)

dupes = {k: v for k, v in by_title.items() if len(v) > 1}
print(f"\nDuplicate groups to merge: {len(dupes)}")

merged = 0
for title, nodes in dupes.items():
    # Keep the one with best content (longest description)
    nodes.sort(key=lambda x: len(x.get("content", "")), reverse=True)
    keeper = nodes[0]
    victims = nodes[1:]

    for v in victims:
        # Re-point edges from victim to keeper
        sb.table("kg_edges").update({"source_id": keeper["id"]}).eq("source_id", v["id"]).execute()
        sb.table("kg_edges").update({"target_id": keeper["id"]}).eq("target_id", v["id"]).execute()
        # Delete victim node
        sb.table("kg_nodes").delete().eq("id", v["id"]).execute()
        merged += 1

    # Bump keeper's validation count
    tv = keeper.get("times_validated", 0) + len(victims)
    sb.table("kg_nodes").update({"times_validated": tv}).eq("id", keeper["id"]).execute()

print(f"Merged {merged} duplicate nodes (kept best description)")

# ── 3. Final stats ───────────────────────────────────────────────
remaining_nodes = sb.table("kg_nodes").select("id", count="exact").eq("source_type", "graphrag").execute()
remaining_edges = sb.table("kg_edges").select("id", count="exact").eq("created_by", "graphrag-indexer").execute()

# Also remove any self-referencing edges that resulted from merge
self_edges = sb.table("kg_edges").select("id, source_id, target_id").eq("created_by", "graphrag-indexer").execute()
self_refs = [e for e in self_edges.data if e["source_id"] == e["target_id"]]
for e in self_refs:
    sb.table("kg_edges").delete().eq("id", e["id"]).execute()
print(f"Removed {len(self_refs)} self-referencing edges from merges")

remaining_nodes = sb.table("kg_nodes").select("id", count="exact").eq("source_type", "graphrag").execute()
remaining_edges = sb.table("kg_edges").select("id", count="exact").eq("created_by", "graphrag-indexer").execute()
print(f"\nFinal: {remaining_nodes.count} GraphRAG nodes, {remaining_edges.count} GraphRAG edges")

# Also remove duplicate edges (same source+target after merge)
# These will be handled by the unique constraint, but let's count
total_nodes = sb.table("kg_nodes").select("id", count="exact").execute()
total_edges = sb.table("kg_edges").select("id", count="exact").execute()
print(f"Total graph: {total_nodes.count} nodes, {total_edges.count} edges")
