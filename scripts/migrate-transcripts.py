#!/usr/bin/env python3
"""
Migrate transcript data from array format to consolidated string format.

This script converts existing JSON files that have transcripts stored as
an array of segments (SRT format) to the new consolidated string format.

Usage: python scripts/migrate-transcripts.py [--dry-run]
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List


def timestamp_to_seconds(timestamp: str) -> float:
    """Convert timestamp string (HH:MM:SS.mmm) to seconds."""
    parts = timestamp.replace(',', '.').split(':')
    hours = int(parts[0])
    minutes = int(parts[1])
    seconds = float(parts[2])
    return hours * 3600 + minutes * 60 + seconds


def get_transcript_duration(segments: List[Dict[str, Any]]) -> str:
    """Get human-readable duration from transcript segments."""
    if not segments:
        return "0 minutes"

    last_segment = segments[-1]
    total_seconds = timestamp_to_seconds(last_segment['end'])

    hours = int(total_seconds // 3600)
    minutes = int((total_seconds % 3600) // 60)

    if hours > 0:
        return f"{hours} hour{'s' if hours != 1 else ''}, {minutes} minute{'s' if minutes != 1 else ''}"
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


def consolidate_transcript(segments: List[Dict[str, Any]]) -> str:
    """Consolidate transcript segments into a single text string."""
    if not segments:
        return ""
    return " ".join(segment['text'] for segment in segments)


def migrate_meeting(json_path: Path, dry_run: bool = False) -> bool:
    """
    Migrate a single meeting JSON file from array to string format.

    Returns True if migration was performed, False if skipped.
    """
    try:
        with open(json_path, 'r') as f:
            meeting = json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"  Error reading {json_path}: {e}")
        return False

    # Check if transcript exists and is in array format
    transcript = meeting.get('transcript')
    if not transcript:
        return False  # No transcript

    if isinstance(transcript, str):
        return False  # Already migrated

    if not isinstance(transcript, list):
        print(f"  Unexpected transcript type in {json_path}: {type(transcript)}")
        return False

    if len(transcript) == 0:
        return False  # Empty transcript

    # Verify it's the expected segment format
    if not all(isinstance(seg, dict) and 'text' in seg for seg in transcript):
        print(f"  Unexpected segment format in {json_path}")
        return False

    # Perform migration
    consolidated_text = consolidate_transcript(transcript)
    duration = get_transcript_duration(transcript)

    if dry_run:
        print(f"  Would migrate: {json_path.name}")
        print(f"    Segments: {len(transcript)} -> Consolidated: {len(consolidated_text)} chars")
        print(f"    Duration: {duration}")
        return True

    # Update meeting data
    meeting['transcript'] = consolidated_text
    meeting['transcript_duration'] = duration

    # Save updated meeting
    try:
        with open(json_path, 'w') as f:
            json.dump(meeting, f, indent=2)
        return True
    except IOError as e:
        print(f"  Error writing {json_path}: {e}")
        return False


def main():
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("🔍 DRY RUN - No files will be modified\n")
    else:
        print("📦 Migrating transcripts to consolidated format\n")

    # Find data directory
    script_dir = Path(__file__).parent
    data_dir = script_dir.parent / 'data'

    if not data_dir.exists():
        print(f"Error: Data directory not found at {data_dir}")
        sys.exit(1)

    stats = {
        'migrated': 0,
        'already_migrated': 0,
        'no_transcript': 0,
        'errors': 0
    }

    # Get all month directories
    month_dirs = sorted(
        [d for d in data_dir.iterdir() if d.is_dir() and d.name[:4].isdigit()],
        key=lambda x: x.name,
        reverse=True  # Newest first
    )

    print(f"Scanning {len(month_dirs)} month directories...\n")

    for month_dir in month_dirs:
        json_files = list(month_dir.glob('*.json'))

        for json_path in json_files:
            result = migrate_meeting(json_path, dry_run=dry_run)

            if result:
                stats['migrated'] += 1
                if not dry_run:
                    print(f"  ✓ Migrated: {month_dir.name}/{json_path.name}")
            else:
                # Check why it wasn't migrated
                try:
                    with open(json_path, 'r') as f:
                        meeting = json.load(f)
                    transcript = meeting.get('transcript')
                    if not transcript:
                        stats['no_transcript'] += 1
                    elif isinstance(transcript, str):
                        stats['already_migrated'] += 1
                    else:
                        stats['errors'] += 1
                except:
                    stats['errors'] += 1

    print(f"\n📊 Results:")
    print(f"   Migrated: {stats['migrated']}")
    print(f"   Already migrated: {stats['already_migrated']}")
    print(f"   No transcript: {stats['no_transcript']}")
    print(f"   Errors: {stats['errors']}")

    if dry_run:
        print(f"\n💡 Run without --dry-run to apply changes")


if __name__ == '__main__':
    main()
