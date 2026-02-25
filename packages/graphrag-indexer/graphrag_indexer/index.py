"""
Indexer — main entry point for the collect → extract → bridge pipeline.

Usage:
    python -m graphrag_indexer.index [--source docs|assignments|all] [--skip-collect]
"""

import argparse
import asyncio
import os

from .collector import stage_documents
from .config import INDEXER_ROOT, OUTPUT_DIR, PROMPTS_DIR, GEMINI_API_KEY
from .extractor import write_settings_yaml, load_extracted_entities, load_community_reports, load_entities_from_cache
from .bridge import GraphRAGBridge


async def run_graphrag_index():
    """
    Run GraphRAG indexing via the v3 Python API.
    Extracts entities, relationships, and community reports from staged input docs.
    """
    from graphrag.config.load_config import load_config
    from graphrag.api import build_index

    # Ensure API key is set for litellm
    os.environ.setdefault("GOOGLE_AI_API_KEY", GEMINI_API_KEY)

    write_settings_yaml()
    config = load_config(root_dir=str(INDEXER_ROOT))

    print("[Index] Running GraphRAG indexing...")
    results = await build_index(config=config, verbose=True)

    for result in results:
        if result.error:
            print(f"  [ERROR] {result.workflow}: {result.error}")
        else:
            print(f"  [OK] {result.workflow}")

    # Check for fatal errors
    failed = [r for r in results if r.error]
    if failed:
        print(f"[Index] Completed with {len(failed)} error(s)")
        raise RuntimeError(f"GraphRAG indexing failed: {failed[0].workflow}: {failed[0].error}")
    else:
        print("[Index] Indexing completed successfully")


def run_pipeline(source: str = "all", skip_collect: bool = False) -> dict:
    """
    Full pipeline: collect → extract (via graphrag API) → bridge to Supabase.
    Returns summary dict with counts.
    """
    # 1. Collect and stage documents
    if not skip_collect:
        print("[Pipeline] Step 1/3: Collecting documents...")
        doc_count = stage_documents(source)
        if doc_count == 0:
            print("[Pipeline] No documents found — nothing to index.")
            return {"status": "empty", "documents": 0}
        print(f"[Pipeline] Staged {doc_count} documents")
    else:
        print("[Pipeline] Step 1/3: Skipping collection (--skip-collect)")

    # 2. Run GraphRAG extraction (with retry for transient API errors)
    print("[Pipeline] Step 2/3: Running GraphRAG entity extraction...")
    has_tuned = (PROMPTS_DIR / "entity_extraction.txt").exists()
    if not has_tuned:
        print("  Warning: No tuned prompts found. Run `python -m graphrag_indexer.tune` first.")

    max_retries = 3
    use_cache_fallback = False
    for attempt in range(1, max_retries + 1):
        try:
            asyncio.run(run_graphrag_index())
            break
        except RuntimeError as e:
            if attempt < max_retries:
                import time
                wait = 30 * attempt
                print(f"  [Retry] Attempt {attempt}/{max_retries} failed ({e}), retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [Warning] All {max_retries} attempts failed. Using cache-based extraction fallback.")
                use_cache_fallback = True

    # 3. Load results and bridge to Supabase
    print("[Pipeline] Step 3/3: Syncing to knowledge graph...")
    if use_cache_fallback:
        entities, relationships = load_entities_from_cache()
        community_reports = []
    else:
        entities, relationships = load_extracted_entities()
        community_reports = load_community_reports()

    bridge = GraphRAGBridge()
    result = bridge.run(entities, relationships, community_reports)

    print(f"\n[Pipeline] Complete!")
    print(f"  Entities processed: {result['total_entities_processed']}")
    print(f"  Nodes created:      {result['nodes_created']}")
    print(f"  Edges created:      {result['edges_created']}")
    print(f"  Communities:        {result['communities_created']}")

    return result


def main():
    parser = argparse.ArgumentParser(description="Run GraphRAG indexing pipeline for Glyphor")
    parser.add_argument(
        "--source", choices=["docs", "assignments", "all"], default="all",
        help="Document source to index (default: all)",
    )
    parser.add_argument(
        "--skip-collect", action="store_true",
        help="Skip document collection — use existing input/ files",
    )
    args = parser.parse_args()
    run_pipeline(source=args.source, skip_collect=args.skip_collect)


if __name__ == "__main__":
    main()
