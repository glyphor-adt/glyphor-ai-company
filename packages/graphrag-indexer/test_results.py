"""Quick test to check build_index results."""
import asyncio, os
os.chdir(r'c:\Users\KristinaDenney\source\repos\glyphor-ai-company\packages\graphrag-indexer')
from dotenv import load_dotenv
load_dotenv()
os.environ.setdefault('GOOGLE_AI_API_KEY', os.getenv('GOOGLE_AI_API_KEY', ''))

from graphrag_indexer.extractor import write_settings_yaml
from graphrag.config.load_config import load_config
from graphrag.api import build_index

write_settings_yaml()
config = load_config(root_dir=r'c:\Users\KristinaDenney\source\repos\glyphor-ai-company\packages\graphrag-indexer')
results = asyncio.run(build_index(config=config, verbose=False))

for r in results:
    attrs = [a for a in dir(r) if not a.startswith('_')]
    print(f'Workflow: {r.workflow} | Error: {getattr(r, "error", None)} | Attrs: {attrs}')

print(f'\nTotal workflows: {len(results)}')

# Check output dir
for root, dirs, files in os.walk('output'):
    for f in files:
        path = os.path.join(root, f)
        print(f'  {os.path.getsize(path):>10} bytes  {path}')
