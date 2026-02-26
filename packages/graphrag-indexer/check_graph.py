"""Quick diagnostic of knowledge graph data in Supabase."""
from supabase import create_client
from collections import Counter
from graphrag_indexer.config import SUPABASE_URL, SUPABASE_KEY

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# Node type distribution
nodes = sb.table("kg_nodes").select("node_type, title").execute()
type_counts = Counter(n["node_type"] for n in nodes.data)
total = len(nodes.data)
print(f"=== NODE TYPE DISTRIBUTION ({total} total) ===")
for t, c in type_counts.most_common():
    pct = c * 100 // total
    print(f"  {c:4d} ({pct:2d}%)  {t}")

# Edge type distribution
edges = sb.table("kg_edges").select("edge_type").execute()
edge_counts = Counter(e["edge_type"] for e in edges.data)
print(f"\n=== EDGE TYPE DISTRIBUTION ({len(edges.data)} total) ===")
for t, c in edge_counts.most_common():
    print(f"  {c:4d}  {t}")

# Sample entity-type nodes
entity_nodes = [n for n in nodes.data if n["node_type"] == "entity"]
print(f"\n=== SAMPLE 'entity' NODES (first 20) ===")
for n in entity_nodes[:20]:
    print(f"  {n['title']}")

# Check for unrecognized edge types vs dashboard
dashboard_types = {"causes", "precedes", "relates_to", "part_of", "depends_on",
                   "created_by", "assigned_to", "measured_by", "mitigates", "enables"}
bridge_types = set(edge_counts.keys())
unrecognized = bridge_types - dashboard_types
if unrecognized:
    print(f"\n=== EDGE TYPES UNKNOWN TO DASHBOARD ===")
    for t in sorted(unrecognized):
        print(f"  {t} ({edge_counts[t]} edges)")

# Check for unrecognized node types vs dashboard
dashboard_node_types = {"entity", "concept", "decision", "metric", "risk",
                        "opportunity", "learning", "goal", "project", "process", "person"}
unrecognized_nodes = set(type_counts.keys()) - dashboard_node_types
if unrecognized_nodes:
    print(f"\n=== NODE TYPES UNKNOWN TO DASHBOARD ===")
    for t in sorted(unrecognized_nodes):
        print(f"  {t} ({type_counts[t]} nodes)")
