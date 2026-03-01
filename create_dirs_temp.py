import os
import sys

basePath = r"C:\Users\KristinaDenney\source\repos\glyphor-ai-company"
dirs = [
    r"packages\smoketest",
    r"packages\smoketest\src",
    r"packages\smoketest\src\layers",
    r"packages\smoketest\src\utils"
]

print("Creating directories...")
for dir in dirs:
    fullPath = os.path.join(basePath, dir)
    try:
        if not os.path.exists(fullPath):
            os.makedirs(fullPath)
            print(f"✓ Created: {dir}")
        else:
            print(f"✓ Already exists: {dir}")
    except Exception as e:
        print(f"✗ Failed to create {dir}: {e}")
        sys.exit(1)

print("\nDirectory structure created successfully!")
print("\nListing structure:")
smoketest_path = os.path.join(basePath, "packages", "smoketest")
for root, dirs_list, files_list in os.walk(smoketest_path):
    level = root.replace(smoketest_path, "").count(os.sep)
    indent = " " * 2 * level
    print(f"{indent}{os.path.basename(root)}/")
    sub_indent = " " * 2 * (level + 1)
    for file in files_list:
        print(f"{sub_indent}{file}")
