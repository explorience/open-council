"""
Transcript scraper and SRT parser for Lillian Skinner's London Council Archive.

This module fetches and parses SRT (SubRip Text) transcripts from:
https://london.lillianskinner.ca/

Uses the Firecrawl API for reliable scraping to avoid 403 errors.

Usage:
  python transcript.py                    # Sync all available transcripts
  python transcript.py 2025-11-26 Council # Fetch specific meeting transcript
"""

import os
import re
import json
import requests
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any


# Base URL for Lillian's archive
ARCHIVE_BASE_URL = "https://london.lillianskinner.ca"

# Firecrawl API configuration
FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"
FIRECRAWL_API_KEY = os.environ.get('FIRECRAWL_API_KEY', '')

# Mapping from our meeting types to Lillian's directory structure
MEETING_TYPE_MAPPING = {
    "Council": "Council",
    "City Council": "Council",
    "Planning and Environment Committee": "PEC",
    "Corporate Services Committee": "CSC",
    "Community and Protective Services Committee": "CPSC",
    "Civic Works Committee": "CWC",
    "Strategic Priorities and Policy Committee": "SPPC",
    "Infrastructure and Corporate Services Committee": "ICSC",
    "Audit Committee": "Audit",
    "Budget Committee": "Budget",
}


def parse_srt(srt_content: str) -> List[Dict[str, Any]]:
    """
    Parse SRT (SubRip Text) format into a list of transcript segments.

    SRT format:
    1
    00:22:06,750 --> 00:22:12,330
    - Okay, thank you, please be seated.

    2
    00:22:12,330 --> 00:22:14,240
    So this is the 19th meeting of council.

    Returns:
        List of dicts with keys: index, start, end, text
    """
    segments = []

    # Split by double newline to get individual subtitle blocks
    # Handle both \n\n and \r\n\r\n
    blocks = re.split(r'\n\s*\n', srt_content.strip())

    for block in blocks:
        if not block.strip():
            continue

        lines = block.strip().split('\n')
        if len(lines) < 3:
            continue

        try:
            # First line is the index number
            index = int(lines[0].strip())

            # Second line is the timestamp range
            timestamp_match = re.match(
                r'(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})',
                lines[1].strip()
            )
            if not timestamp_match:
                continue

            start_time = timestamp_match.group(1).replace(',', '.')
            end_time = timestamp_match.group(2).replace(',', '.')

            # Remaining lines are the text
            text = ' '.join(lines[2:]).strip()
            # Clean up the text - remove leading dashes that indicate speaker changes
            text = re.sub(r'^\s*-\s*', '', text)

            segments.append({
                'index': index,
                'start': start_time,
                'end': end_time,
                'text': text
            })
        except (ValueError, IndexError):
            continue

    return segments


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


def build_transcript_url(date: datetime, meeting_type: str, verbose: bool = False) -> Optional[str]:
    """
    Build the URL for a transcript on Lillian's archive.

    Example URL structure:
    https://london.lillianskinner.ca/Meetings/Council/2025/11-26/.transcript.srt
    """
    mapped_type = MEETING_TYPE_MAPPING.get(meeting_type)
    if not mapped_type:
        if verbose:
            print(f"    → No URL mapping for meeting type: '{meeting_type}'")
        return None

    year = date.strftime('%Y')
    month_day = date.strftime('%m-%d')

    return f"{ARCHIVE_BASE_URL}/Meetings/{mapped_type}/{year}/{month_day}/.transcript.srt"


def fetch_transcript_via_firecrawl(url: str, verbose: bool = False) -> Optional[str]:
    """
    Fetch content from a URL using the Firecrawl API.

    Args:
        url: The URL to fetch
        verbose: Whether to print detailed logging

    Returns:
        Raw content as string, or None if not available
    """
    if not FIRECRAWL_API_KEY:
        print("  Warning: FIRECRAWL_API_KEY not set, falling back to direct request")
        return None

    if verbose:
        print(f"    → Calling Firecrawl API for: {url}")

    try:
        response = requests.post(
            FIRECRAWL_API_URL,
            headers={
                'Authorization': f'Bearer {FIRECRAWL_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'url': url,
                'formats': ['rawHtml']
            },
            timeout=60
        )

        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                # For SRT files, the content is in rawHtml
                raw_content = data.get('data', {}).get('rawHtml', '')
                if raw_content:
                    if verbose:
                        print(f"    → Found transcript ({len(raw_content)} bytes)")
                    return raw_content
                else:
                    if verbose:
                        print(f"    → Firecrawl returned empty content")
            else:
                if verbose:
                    print(f"    → Firecrawl: URL not accessible (success=false)")
                return None
        elif response.status_code == 402:
            print("  Warning: Firecrawl API quota exceeded")
            return None
        elif response.status_code == 404:
            if verbose:
                print(f"    → Firecrawl: 404 not found")
            return None
        else:
            print(f"  Warning: Firecrawl API returned status {response.status_code}")
            return None
    except requests.RequestException as e:
        print(f"  Error calling Firecrawl API: {e}")
        return None

    return None


def fetch_transcript_direct(url: str) -> Optional[str]:
    """
    Fetch content from a URL directly (fallback method).

    Args:
        url: The URL to fetch

    Returns:
        Raw content as string, or None if not available
    """
    try:
        response = requests.get(url, timeout=30)
        if response.status_code == 200:
            return response.text
        elif response.status_code == 404:
            return None
        else:
            print(f"  Warning: Got status {response.status_code} for {url}")
            return None
    except requests.RequestException as e:
        print(f"  Error fetching transcript: {e}")
        return None


def fetch_transcript(date: datetime, meeting_type: str, verbose: bool = False) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch and parse a transcript for a specific meeting.

    Uses Firecrawl API if available, otherwise falls back to direct requests.

    Args:
        date: Meeting date
        meeting_type: Meeting type (e.g., "Council", "Planning and Environment Committee")
        verbose: Whether to print detailed logging

    Returns:
        List of transcript segments, or None if not available
    """
    url = build_transcript_url(date, meeting_type, verbose=verbose)
    if not url:
        return None

    # Try Firecrawl API first if key is available
    content = None
    if FIRECRAWL_API_KEY:
        content = fetch_transcript_via_firecrawl(url, verbose=verbose)

    # Fall back to direct request if Firecrawl didn't work
    if content is None and not FIRECRAWL_API_KEY:
        content = fetch_transcript_direct(url)

    if content:
        return parse_srt(content)

    return None


def add_transcript_to_meeting(json_path: Path, verbose: bool = False) -> bool:
    """
    Add transcript data to an existing meeting JSON file.

    Args:
        json_path: Path to the meeting JSON file
        verbose: Whether to print detailed logging

    Returns:
        True if transcript was added/updated, False otherwise
    """
    try:
        with open(json_path, 'r') as f:
            meeting = json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"  Error reading {json_path}: {e}")
        return False

    # Skip if transcript already exists and is non-empty
    if meeting.get('transcript') and len(meeting.get('transcript', [])) > 0:
        return False

    # Parse the meeting date
    datetime_str = meeting.get('datetime', '')
    if not datetime_str:
        if verbose:
            print(f"    → No datetime field in meeting")
        return False

    try:
        meeting_date = datetime.strptime(datetime_str.split()[0], '%Y-%m-%d')
    except ValueError:
        if verbose:
            print(f"    → Could not parse date: {datetime_str}")
        return False

    meeting_type = meeting.get('meeting_type', '')

    # Fetch transcript
    transcript = fetch_transcript(meeting_date, meeting_type, verbose=verbose)
    if not transcript:
        return False

    # Add transcript to meeting data
    meeting['transcript'] = transcript
    meeting['transcript_source'] = 'lillian_skinner_archive'
    meeting['transcript_source_url'] = build_transcript_url(meeting_date, meeting_type)

    # Save updated meeting
    try:
        with open(json_path, 'w') as f:
            json.dump(meeting, f, indent=2)
        return True
    except IOError as e:
        print(f"  Error writing {json_path}: {e}")
        return False


def sync_all_transcripts(data_dir: Path = None, verbose: bool = False) -> Dict[str, int]:
    """
    Sync transcripts for all meetings that don't have them yet.

    Args:
        data_dir: Directory containing meeting data
        verbose: Whether to print detailed logging (set VERBOSE=1 env var to enable)

    Returns:
        Dict with counts: added, skipped, errors
    """
    if data_dir is None:
        data_dir = Path(__file__).parent.parent / 'data'

    stats = {'added': 0, 'skipped': 0, 'errors': 0, 'already_have': 0, 'no_mapping': 0}

    # Get all month directories, sorted newest first
    month_dirs = sorted(
        [d for d in data_dir.iterdir() if d.is_dir() and re.match(r'\d{4}-\d{2}', d.name)],
        key=lambda x: x.name,
        reverse=True
    )

    print(f"Scanning {len(month_dirs)} month directories for transcripts...")
    print(f"Firecrawl API key: {'configured' if FIRECRAWL_API_KEY else 'NOT SET'}")
    print(f"Verbose mode: {'enabled' if verbose else 'disabled (set VERBOSE=1 to enable)'}")
    print()

    for month_dir in month_dirs:
        json_files = list(month_dir.glob('*.json'))

        for json_path in json_files:
            # Quick check if transcript already exists
            try:
                with open(json_path, 'r') as f:
                    meeting = json.load(f)
                    if meeting.get('transcript') and len(meeting.get('transcript', [])) > 0:
                        stats['already_have'] += 1
                        continue
            except:
                stats['errors'] += 1
                continue

            print(f"  Checking: {json_path.name}")

            if add_transcript_to_meeting(json_path, verbose=verbose):
                print(f"    ✓ Added transcript")
                stats['added'] += 1
            else:
                stats['skipped'] += 1

    return stats


if __name__ == '__main__':
    import sys

    # Check for verbose mode via environment variable
    verbose = os.environ.get('VERBOSE', '').lower() in ('1', 'true', 'yes')

    if len(sys.argv) == 3:
        # Fetch specific meeting transcript
        date_str = sys.argv[1]
        meeting_type = sys.argv[2]

        date = datetime.strptime(date_str, '%Y-%m-%d')
        transcript = fetch_transcript(date, meeting_type, verbose=True)

        if transcript:
            print(f"Found transcript with {len(transcript)} segments")
            print(f"Duration: {get_transcript_duration(transcript)}")
            print("\nFirst 5 segments:")
            for seg in transcript[:5]:
                print(f"  [{seg['start']}] {seg['text'][:80]}...")
        else:
            print("Transcript not available")
    else:
        # Sync all transcripts
        print("🎙️ Transcript Sync\n")
        stats = sync_all_transcripts(verbose=verbose)

        print(f"\n📊 Results:")
        print(f"   Added: {stats['added']}")
        print(f"   Already have: {stats['already_have']}")
        print(f"   Not available: {stats['skipped']}")
        print(f"   Errors: {stats['errors']}")
