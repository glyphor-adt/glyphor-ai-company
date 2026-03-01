import os
import sys

basePath = r'C:\Users\KristinaDenney\source\repos\glyphor-ai-company'

# Create directories
dirs = [
    r'packages\smoketest',
    r'packages\smoketest\src',
    r'packages\smoketest\src\layers',
    r'packages\smoketest\src\utils'
]

print('Creating directories...')
for dir in dirs:
    fullPath = os.path.join(basePath, dir)
    try:
        os.makedirs(fullPath, exist_ok=True)
        print(f'✓ Created: {dir}')
    except Exception as e:
        print(f'✗ Failed to create {dir}: {e}')
        sys.exit(1)

print('\nDirectory structure created successfully!')
