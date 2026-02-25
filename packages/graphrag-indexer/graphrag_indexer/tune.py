"""
Auto Prompt Tuner — adapts GraphRAG extraction prompts to the Glyphor domain.

Reads the staged input documents and uses GraphRAG v3's auto-tuning to generate
domain-specific entity extraction, summarization, and community report prompts.
Outputs tuned prompts to the prompts/ directory.

Usage:
    python -m graphrag_indexer.tune [--source docs|assignments|all]
"""

import argparse
import asyncio
import os
from pathlib import Path

from .collector import stage_documents
from .config import (
    DOMAIN, GEMINI_API_KEY,
    INDEXER_ROOT, PROMPTS_DIR,
)
from .extractor import write_settings_yaml


async def run_auto_tune(source: str = "all", limit: int = 15):
    """
    Run GraphRAG auto prompt tuning:
    1. Stage input documents
    2. Write settings.yaml
    3. Generate tuned prompts via the LLM
    4. Write prompts to prompts/ directory
    """
    print("[Tune] Staging documents...")
    doc_count = stage_documents(source)
    if doc_count == 0:
        print("[Tune] No documents found — nothing to tune.")
        return

    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)

    # Ensure GOOGLE_AI_API_KEY is set for litellm
    os.environ.setdefault("GOOGLE_AI_API_KEY", GEMINI_API_KEY)

    print(f"[Tune] Generating tuned prompts from {doc_count} documents...")

    # Write settings.yaml and load config
    write_settings_yaml()

    from graphrag.config import load_config
    from graphrag.api import prompt_tune

    config = load_config(root_dir=str(INDEXER_ROOT))

    # Run auto prompt tuning — returns (entity_extraction, entity_summary, community_summary)
    entity_prompt, entity_summary_prompt, community_prompt = await prompt_tune.generate_indexing_prompts(
        config=config,
        domain=DOMAIN,
        language="English",
        discover_entity_types=True,
        max_tokens=8192,
        limit=limit,
        k=5,
    )

    # Write tuned prompts
    prompt_map = {
        "entity_extraction": entity_prompt,
        "summarize_descriptions": entity_summary_prompt,
        "community_report": community_prompt,
    }

    for name, content in prompt_map.items():
        prompt_file = PROMPTS_DIR / f"{name}.txt"
        prompt_file.write_text(content, encoding="utf-8")
        print(f"  -> Wrote {prompt_file.name} ({len(content)} chars)")

    print(f"[Tune] Tuning complete — {len(prompt_map)} prompts written to {PROMPTS_DIR}")


def main():
    parser = argparse.ArgumentParser(description="Auto-tune GraphRAG prompts for Glyphor domain")
    parser.add_argument(
        "--source", choices=["docs", "assignments", "all"], default="all",
        help="Which documents to use for tuning (default: all)",
    )
    parser.add_argument(
        "--limit", type=int, default=15,
        help="Max documents to sample for tuning (default: 15)",
    )
    args = parser.parse_args()
    asyncio.run(run_auto_tune(source=args.source, limit=args.limit))


if __name__ == "__main__":
    main()
