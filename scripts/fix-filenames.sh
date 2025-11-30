#!/bin/bash
# Fix files with newlines in their names

cd /home/user/open-council/content

# Find and rename files with newlines
find . -type f -name "*.md" | while IFS= read -r file; do
  if echo "$file" | grep -q $'\n'; then
    dir=$(dirname "$file")
    old_name=$(basename "$file")
    new_name=$(echo "$old_name" | tr '\n' ' ' | tr -s ' ')
    if [ "$old_name" != "$new_name" ]; then
      echo "Renaming: $dir"
      mv "$file" "$dir/$new_name" 2>/dev/null || echo "  Failed to rename"
    fi
  fi
done

echo "Done fixing filenames"
