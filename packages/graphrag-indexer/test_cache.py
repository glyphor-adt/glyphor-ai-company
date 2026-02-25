"""Quick test of cache-based entity extraction."""
from graphrag_indexer.extractor import load_entities_from_cache

entities, relationships = load_entities_from_cache()
print(f"Entities: {len(entities)}")
print(f"Relationships: {len(relationships)}")

print("\nSample entities:")
for e in entities[:15]:
    desc = e["description"][:80]
    print(f"  [{e['type']}] {e['name']}: {desc}")

print("\nSample relationships:")
for r in relationships[:15]:
    print(f"  {r['source']} --[{r['type']}]--> {r['target']} (w={r['weight']})")

# Count by type
from collections import Counter
type_counts = Counter(e["type"] for e in entities)
print("\nEntity type counts:")
for t, c in type_counts.most_common():
    print(f"  {t}: {c}")
