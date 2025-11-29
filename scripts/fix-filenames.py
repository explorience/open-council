#!/usr/bin/env python3
"""Fix files with newlines in their names."""

import os
import re

content_dir = "/home/user/open-council/content"

count = 0
for root, dirs, files in os.walk(content_dir):
    for filename in files:
        if "\n" in filename:
            old_path = os.path.join(root, filename)
            new_filename = filename.replace("\n", " ").replace("  ", " ").strip()
            new_path = os.path.join(root, new_filename)

            print(f"Renaming: {repr(filename)} -> {new_filename}")
            os.rename(old_path, new_path)

            # Also fix the frontmatter inside the file
            with open(new_path, 'r') as f:
                content = f.read()

            # Fix title in frontmatter if it has newlines
            fixed_content = re.sub(
                r'title: ([^\n]+)\n([A-Z][^\n-]+)',
                lambda m: f'title: "{m.group(1).strip()} {m.group(2).strip()}"',
                content
            )

            if fixed_content != content:
                with open(new_path, 'w') as f:
                    f.write(fixed_content)
                print(f"  Fixed frontmatter")

            count += 1

print(f"\nFixed {count} files")
