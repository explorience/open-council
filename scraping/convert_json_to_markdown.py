#!/usr/bin/env python3
"""
Convert existing JSON files to markdown files.

This script finds all JSON files in ../data/ that don't have corresponding
markdown files in ../content/ and generates the markdown from the JSON data.

Usage:
  python convert_json_to_markdown.py              # Process all JSON files
  python convert_json_to_markdown.py 2021         # Process only 2021 files
  python convert_json_to_markdown.py 2019 2022    # Process files from 2019-2022
"""

import json
import sys
from pathlib import Path
from datetime import datetime

def callout(title, content):
    """Generate a markdown callout box"""
    output = ""
    output += f"> [!abstract]- {title}\n"
    formatted_content = content.strip().replace('\n', '\n> ')
    output += f"> {formatted_content}"
    return output

def format_paragraph(para_data):
    """Format a paragraph from JSON data"""
    if isinstance(para_data, dict) and para_data.get("__class__") == "Paragraph":
        return para_data.get("string", "")
    return str(para_data) if para_data else ""

def format_vote(vote_data):
    """Format a vote table from JSON data"""
    if not vote_data or not isinstance(vote_data, dict):
        return ""

    rows = vote_data.get("rows", [])
    if not rows:
        return ""

    output = "\n| Vote | Members |\n|------|----------|\n"
    for row in rows:
        vote_type = row.get("vote", "")
        voters = ', '.join(row.get("voters", []))
        output += f"| {vote_type} | {voters} |\n"
    return output + "\n"

def format_motion(motion_data):
    """Format a motion from JSON data"""
    if not motion_data or not isinstance(motion_data, dict):
        return ""

    output = ""

    # Pre-motion texts
    for text in motion_data.get("pre_motion_texts", []):
        output += format_paragraph(text) + "\n\n"

    # Moved by / Seconded by
    moved_by = motion_data.get("moved_by", {})
    if moved_by:
        output += format_paragraph(moved_by) + "\n\n"

    seconded_by = motion_data.get("seconded_by", {})
    if seconded_by:
        output += format_paragraph(seconded_by) + "\n\n"

    # Motion texts
    for text in motion_data.get("motion_texts", []):
        output += format_paragraph(text) + "\n\n"

    # Vote
    vote_data = motion_data.get("vote")
    if vote_data:
        output += format_vote(vote_data)

    # Result
    result = motion_data.get("result", {})
    if result:
        result_text = format_paragraph(result)
        if result_text:
            output += f"**{result_text}**\n\n"

    # Post-motion texts
    for text in motion_data.get("post_motion_texts", []):
        output += format_paragraph(text) + "\n\n"

    return output

def format_content(content_data):
    """Format content (can be paragraph, motion, or list)"""
    if not content_data:
        return ""

    if isinstance(content_data, list):
        output = ""
        for item in content_data:
            output += format_content(item)
        return output

    if isinstance(content_data, dict):
        class_name = content_data.get("__class__")

        if class_name == "Paragraph":
            return format_paragraph(content_data) + "\n\n"
        elif class_name == "Motion":
            return format_motion(content_data)
        elif class_name == "Content":
            # Content object has a content list
            return format_content(content_data.get("content", []))

    return ""

def format_meeting_item(item_data, level=1, prefix=""):
    """Format a meeting item and its sub-items"""
    if not item_data or not isinstance(item_data, dict):
        return ""

    output = ""
    number = item_data.get("number", "")
    title = item_data.get("title", "")
    number_str = f"{prefix}{number}." if number else ""

    # Add heading
    output += f"{'#' * level} {number_str} {title}\n\n"

    # Add content
    content = item_data.get("content", [])
    output += format_content(content)

    # Add attachments
    attachments = item_data.get("attachments", [])
    if attachments:
        output += "**Attachments:**\n"
        for att in attachments:
            if att and isinstance(att, dict):
                att_title = att.get("title", "")
                att_url = att.get("url", "")
                if att_title and att_url:
                    output += f"- [{att_title}]({att_url})\n"
        output += "\n"

    # Recursively format sub-items
    sub_items = item_data.get("items", {})
    for key in sorted(sub_items.keys(), key=lambda x: (len(x), x)):  # Sort by length then value
        output += format_meeting_item(sub_items[key], level + 1, number_str)

    return output

def json_to_markdown(json_path):
    """Convert a JSON meeting file to markdown"""

    # Read JSON data
    with open(json_path, 'r') as f:
        data = json.load(f)

    # Extract meeting data
    title = data.get("title")
    meeting_type = data.get("meeting_type", "")
    datetime_str = data.get("datetime", "")
    meeting_datetime = datetime.strptime(datetime_str, "%Y-%m-%d %H:%M:%S")
    url = data.get("url", "")
    present = data.get("present", [])
    absent = data.get("absent", [])
    also_present = data.get("also_present", [])
    remote_attendance = data.get("remote_attendance", [])
    content = data.get("content")
    items = data.get("items", {})
    bills = data.get("bills")

    # Generate markdown
    output = ""

    # Frontmatter
    output += "---\n"
    output += f"title: {title or meeting_type}\n"
    output += f"date: {meeting_datetime.strftime('%Y-%m-%d')}\n"
    output += "---\n"

    # Meeting info
    output += "{d:%B} {d.day}, {d.year}, at {d:%l}:{d.minute:02} {d:%p}\n\n".format(d=meeting_datetime)
    output += f"[Original link]({url})\n\n"

    # Attendance
    output += f"{callout('Present:', ', '.join(present))}\n\n"
    if absent:
        output += f"{callout('Absent:', ', '.join(absent))}\n\n"
    if also_present:
        output += f"{callout('Also Present:', ', '.join(also_present))}\n\n"
    if remote_attendance:
        output += f"{callout('Remote Attendance:', ', '.join(remote_attendance))}\n\n"

    # Content
    output += format_content(content)

    # Items
    for key in sorted(items.keys(), key=lambda x: (len(x), x)):  # Sort by length then value
        output += format_meeting_item(items[key], 1, "")

    # Bills (if any)
    if bills:
        output += f"# Appendix: New Bills\n\n"
        output += format_content(bills)

    # Write markdown file
    yyyy_mm = meeting_datetime.strftime("%Y-%m")
    yyyy_mm_dd = meeting_datetime.strftime("%Y-%m-%d")
    formatted_title = f"{yyyy_mm_dd} {title or meeting_type}"

    md_path = Path(f"../content/{yyyy_mm}/{formatted_title.replace('/', '-')}.md")
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(output)

    return formatted_title

def main():
    data_dir = Path("../data")
    content_dir = Path("../content")

    # Parse command line arguments
    if len(sys.argv) == 1:
        # Process all years
        pattern = "**/*.json"
        start_year = None
        end_year = None
    elif len(sys.argv) == 2:
        # Process specific year
        year = int(sys.argv[1])
        pattern = "**/*.json"
        start_year = year
        end_year = year
    elif len(sys.argv) == 3:
        # Process year range
        start_year = int(sys.argv[1])
        end_year = int(sys.argv[2])
        pattern = "**/*.json"
    else:
        print(__doc__)
        sys.exit(1)

    # Find all JSON files
    json_files = list(data_dir.glob(pattern))

    # Filter by year range if specified
    if start_year is not None and end_year is not None:
        json_files = [f for f in json_files if start_year <= int(f.parent.name[:4]) <= end_year]

    # Find which ones need markdown conversion
    to_convert = []
    for json_file in json_files:
        # Calculate expected markdown path
        month_dir = json_file.parent.name
        md_name = json_file.stem + ".md"
        md_path = content_dir / month_dir / md_name

        if not md_path.exists():
            to_convert.append(json_file)

    print(f"\n📊 Found {len(json_files)} total JSON files")
    print(f"   • {len(json_files) - len(to_convert)} already have markdown")
    print(f"   • {len(to_convert)} need conversion\n")

    if not to_convert:
        print("✅ All JSON files already have corresponding markdown files!")
        return

    print(f"🔄 Converting {len(to_convert)} JSON files to markdown...\n")

    converted = []
    errors = []

    for i, json_file in enumerate(sorted(to_convert), 1):
        try:
            print(f"[{i}/{len(to_convert)}] Converting {json_file.name}...")
            title = json_to_markdown(json_file)
            converted.append(title)
        except Exception as e:
            print(f"   ❌ Error: {e}")
            errors.append((json_file.name, str(e)))
            import traceback
            traceback.print_exc()

    print("\n" + "="*70)
    print("✅ CONVERSION COMPLETE")
    print("="*70)
    print(f"\n{len(converted)} meetings converted successfully")
    if errors:
        print(f"{len(errors)} meetings had errors:")
        for name, error in errors[:10]:
            print(f"   • {name}: {error}")
        if len(errors) > 10:
            print(f"   ... and {len(errors) - 10} more")
    print()

if __name__ == "__main__":
    main()
