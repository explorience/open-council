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

# News sources to search for meeting coverage
NEWS_SOURCES = [
    {
        "name": "London Free Press",
        "search_url": "https://lfpress.com/?s=",
        "domain": "lfpress.com"
    }
]


def search_news_coverage(date: datetime, meeting_type: str, verbose: bool = False) -> List[Dict[str, Any]]:
    """
    Search for news articles covering a council meeting.

    Searches London Free Press for articles about the meeting published
    within 2 days of the meeting date.

    Args:
        date: Meeting date
        meeting_type: Type of meeting (e.g., "Council")
        verbose: Whether to print detailed logging

    Returns:
        List of news coverage dicts with source, url, title, summary, vote_info
    """
    if not FIRECRAWL_API_KEY:
        if verbose:
            print("    → Skipping news search: FIRECRAWL_API_KEY not set")
        return []

    coverage = []
    seen_urls = set()  # Track URLs to avoid duplicates across pages
    date_str = date.strftime('%Y-%m-%d')

    # Search LFPress for council-related articles
    # Use simple "city council" query - date filtering happens after fetch
    search_term = "city council"

    # Search first 5 pages of results (50 articles) to catch older articles
    # Note: date_range=-365d is required for pagination to work on LFPress
    base_params = f"search_text={requests.utils.quote(search_term)}&date_range=-365d&sort=desc"
    search_urls = [
        f"https://lfpress.com/search/?{base_params}",
        f"https://lfpress.com/search/?{base_params}&from=10",
        f"https://lfpress.com/search/?{base_params}&from=20",
        f"https://lfpress.com/search/?{base_params}&from=30",
        f"https://lfpress.com/search/?{base_params}&from=40",
    ]

    max_articles = 5  # Collect up to 5 relevant articles

    for page_num, search_url in enumerate(search_urls, 1):
        if len(coverage) >= max_articles:
            break

        if verbose:
            print(f"    → Searching news: {search_term} (page {page_num})")

        try:
            # Use Firecrawl to search
            response = requests.post(
                FIRECRAWL_API_URL,
                headers={
                    'Authorization': f'Bearer {FIRECRAWL_API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'url': search_url,
                    'formats': ['markdown'],
                    'waitFor': 2000,
                },
                timeout=30
            )

            if response.status_code != 200:
                if verbose:
                    print(f"    → News search failed: {response.status_code}")
                continue

            data = response.json()
            if not data.get('success'):
                continue

            markdown = data.get('data', {}).get('markdown', '')

            # Parse search results to find article URLs
            # LFPress search results have links like [Title](url)
            article_links = re.findall(r'\[([^\]]+)\]\((https://lfpress\.com/news/[^)]+)\)', markdown)

            if verbose:
                print(f"    → Found {len(article_links)} potential articles")

            # Check each article to see if it's about this meeting
            for i, (title, url) in enumerate(article_links[:15]):  # Check first 15 results
                if len(coverage) >= max_articles:
                    break

                # Skip duplicates
                if url in seen_urls:
                    if verbose:
                        print(f"    → Skipped [{i+1}]: duplicate URL")
                    continue
                seen_urls.add(url)

                # Skip if title doesn't seem relevant
                title_lower = title.lower()
                if not any(word in title_lower for word in ['council', 'vote', 'councillor', 'city hall', 'budget']):
                    if verbose:
                        print(f"    → Skipped [{i+1}]: title lacks keywords: {title[:60]}...")
                    continue

                if verbose:
                    print(f"    → Checking [{i+1}]: {title[:60]}...")

                article = fetch_news_article(url, date, verbose=verbose)
                if article:
                    coverage.append(article)
                    if verbose:
                        print(f"    ✓ Found relevant article: {article['title'][:50]}...")
                elif verbose:
                    print(f"    → Failed to fetch article [{i+1}]")

        except Exception as e:
            if verbose:
                print(f"    → Error searching news: {e}")

    return coverage


def fetch_news_article(url: str, meeting_date: datetime, verbose: bool = False) -> Optional[Dict[str, Any]]:
    """
    Fetch and parse a news article for vote information.

    Args:
        url: Article URL
        meeting_date: The meeting date to verify article relevance
        verbose: Whether to print detailed logging

    Returns:
        Dict with source, url, title, date, summary, vote_info or None if not relevant
    """
    if not FIRECRAWL_API_KEY:
        return None

    try:
        response = requests.post(
            FIRECRAWL_API_URL,
            headers={
                'Authorization': f'Bearer {FIRECRAWL_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'url': url,
                'formats': ['markdown'],
                'waitFor': 2000,
            },
            timeout=30
        )

        if response.status_code != 200:
            return None

        data = response.json()
        if not data.get('success'):
            return None

        markdown = data.get('data', {}).get('markdown', '')
        metadata = data.get('data', {}).get('metadata', {})

        # Check if article is from around the meeting date (same day or next day)
        article_date = None
        # Try to find date in metadata or content
        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', str(metadata))
        if date_match:
            try:
                article_date = datetime.strptime(date_match.group(1), '%Y-%m-%d')
            except:
                pass

        # Filter by date: article must be within 3 days of meeting date
        if article_date:
            days_diff = abs((article_date - meeting_date).days)
            if days_diff > 3:
                if verbose:
                    print(f"      → Rejected: article date {article_date.strftime('%Y-%m-%d')} too far from meeting date")
                return None

        # Extract title
        title = metadata.get('title', '') or metadata.get('og:title', '')
        if not title:
            title_match = re.search(r'^#\s+(.+?)$', markdown, re.MULTILINE)
            title = title_match.group(1) if title_match else 'Unknown'

        # Filter out articles about other cities (e.g., St. Thomas)
        title_lower = title.lower()
        if 'st. thomas' in title_lower or 'st thomas' in title_lower:
            if 'london' not in title_lower:
                if verbose:
                    print(f"      → Rejected: article about St. Thomas, not London")
                return None

        # Extract vote information from the article
        vote_data = extract_vote_info(markdown)

        # Create summary (first ~500 chars of meaningful content)
        summary = create_article_summary(markdown)

        return {
            "source": "London Free Press",
            "url": url,
            "title": title.strip(),
            "date": article_date.strftime('%Y-%m-%d') if article_date else meeting_date.strftime('%Y-%m-%d'),
            "summary": summary,
            "vote_summary": vote_data["vote_summary"],
            "councillors_for": vote_data["councillors_for"],
            "councillors_against": vote_data["councillors_against"],
        }

    except Exception as e:
        if verbose:
            print(f"    → Error fetching article: {e}")
        return None


def extract_vote_info(markdown: str) -> Dict[str, Any]:
    """
    Extract vote tallies and councillor positions from article text.

    Looks for patterns like:
    - "passed 8-7"
    - "voted 10-5"
    - "Councillor X voted against"
    - "unanimous"
    - Lists of councillors who voted for/against

    Args:
        markdown: Article content in markdown format

    Returns:
        Dict with vote_summary (str), councillors_for (list), councillors_against (list)
    """
    result = {
        "vote_summary": "",
        "councillors_for": [],
        "councillors_against": [],
        "raw_mentions": []
    }

    # Known councillor names (current London council)
    councillor_names = [
        "Morgan", "Lewis", "Lehman", "Peloza", "Stevenson", "Hopkins",
        "Cassidy", "Ferreira", "Franke", "Hillier", "McAlister", "Pribil",
        "Rahman", "Trosow", "Van Meerbergen"
    ]

    vote_summary_parts = []

    # Look for vote tallies
    vote_patterns = [
        r'(pass(?:ed)?|approv(?:ed)?|defeat(?:ed)?|reject(?:ed)?|fail(?:ed)?)\s+(\d+[-–]\d+)',
        r'(\d+[-–]\d+)\s+(vote|in favour|against)',
        r'(unanimous(?:ly)?)',
        r'(split|divided|close)\s+(?:vote|decision)',
    ]

    for pattern in vote_patterns:
        matches = re.findall(pattern, markdown, re.IGNORECASE)
        for match in matches:
            if isinstance(match, tuple):
                vote_summary_parts.append(' '.join(match))
            else:
                vote_summary_parts.append(match)

    # Look for "voting against were:" or "voting in favour were:" patterns
    against_list_patterns = [
        r'(?:voting|voted)\s+(?:against|no)\s*(?:were|:)\s*([^.]+)',
        r'(?:opposed|opposing)\s*(?:were|:)\s*([^.]+)',
        r'(?:the\s+)?no\s+votes?\s*(?:came from|were|:)\s*([^.]+)',
    ]

    for pattern in against_list_patterns:
        matches = re.findall(pattern, markdown, re.IGNORECASE)
        for match in matches:
            # Extract councillor names from the list
            for name in councillor_names:
                if name.lower() in match.lower():
                    if name not in result["councillors_against"]:
                        result["councillors_against"].append(name)

    favour_list_patterns = [
        r'(?:voting|voted)\s+(?:in favour|for|yes)\s*(?:were|:)\s*([^.]+)',
        r'(?:supporting|in support)\s*(?:were|:)\s*([^.]+)',
        r'(?:the\s+)?yes\s+votes?\s*(?:came from|were|:)\s*([^.]+)',
    ]

    for pattern in favour_list_patterns:
        matches = re.findall(pattern, markdown, re.IGNORECASE)
        for match in matches:
            for name in councillor_names:
                if name.lower() in match.lower():
                    if name not in result["councillors_for"]:
                        result["councillors_for"].append(name)

    # Look for individual councillor mentions with voting stance
    councillor_patterns = [
        r'(?:Councillor|Coun\.|Deputy Mayor|Mayor)\s+(\w+)\s+(?:voted|was)\s+(against|in favour|for|no|yes)',
        r'(\w+)\s+(?:voted|was one of[^.]*voting)\s+(against|in favour|for|no|yes)',
        r'(\w+)\s+(?:opposed|supported)\s+(?:the|this)',
    ]

    for pattern in councillor_patterns:
        matches = re.findall(pattern, markdown, re.IGNORECASE)
        for match in matches:
            name = match[0] if isinstance(match, tuple) else match
            stance = match[1].lower() if isinstance(match, tuple) and len(match) > 1 else ""

            # Verify it's a known councillor name
            if name in councillor_names:
                result["raw_mentions"].append(f"{name} {stance}")
                if stance in ['against', 'no', 'opposed']:
                    if name not in result["councillors_against"]:
                        result["councillors_against"].append(name)
                elif stance in ['for', 'yes', 'in favour', 'supported']:
                    if name not in result["councillors_for"]:
                        result["councillors_for"].append(name)

    # Build vote summary
    result["vote_summary"] = '; '.join(list(set(vote_summary_parts))[:5]) if vote_summary_parts else ''

    return result


def create_article_summary(markdown: str) -> str:
    """
    Create a brief summary from article content.

    Args:
        markdown: Article content in markdown format

    Returns:
        Summary string (first ~500 meaningful characters)
    """
    # Remove markdown formatting
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', markdown)  # Links
    text = re.sub(r'[#*_`]', '', text)  # Formatting chars
    text = re.sub(r'\n+', ' ', text)  # Newlines
    text = re.sub(r'\s+', ' ', text)  # Multiple spaces

    # Skip common header/nav content
    skip_phrases = ['subscribe', 'sign up', 'newsletter', 'advertisement', 'skip to content']
    lines = text.split('. ')

    summary_parts = []
    char_count = 0

    for line in lines:
        line = line.strip()
        if not line or len(line) < 20:
            continue
        if any(phrase in line.lower() for phrase in skip_phrases):
            continue

        summary_parts.append(line)
        char_count += len(line)

        if char_count > 500:
            break

    return '. '.join(summary_parts)[:600] + '...' if summary_parts else ''


# Mapping from our meeting types to Lillian's directory structure
# Lillian uses full committee names in the URL (URL-encoded with %20 for spaces)
MEETING_TYPE_MAPPING = {
    "Council": "Council",
    "City Council": "Council",
    "Planning and Environment Committee": "Planning and Environment Committee",
    "Corporate Services Committee": "Corporate Services Committee",
    "Community and Protective Services Committee": "Community and Protective Services Committee",
    "Civic Works Committee": "Civic Works Committee",
    "Strategic Priorities and Policy Committee": "Strategic Priorities and Policy Committee",
    "Infrastructure and Corporate Services Committee": "Infrastructure and Corporate Services Committee",
    "Audit Committee": "Audit Committee",
    "Budget Committee": "Budget Committee",
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
    https://london.lillianskinner.ca/Meetings/Planning%20and%20Environment%20Committee/2025/11-12/.transcript.srt
    """
    from urllib.parse import quote

    mapped_type = MEETING_TYPE_MAPPING.get(meeting_type)
    if not mapped_type:
        if verbose:
            print(f"    → No URL mapping for meeting type: '{meeting_type}'")
        return None

    year = date.strftime('%Y')
    month_day = date.strftime('%m-%d')

    # URL-encode the committee name (spaces become %20)
    encoded_type = quote(mapped_type, safe='')

    return f"{ARCHIVE_BASE_URL}/Meetings/{encoded_type}/{year}/{month_day}/.transcript.srt"


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
                'formats': ['rawHtml'],
                'waitFor': 2000,  # Wait 2 seconds for any JS/redirects
                'timeout': 30000,  # 30 second timeout
            },
            timeout=60
        )

        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                # For SRT files, the content is in rawHtml
                raw_content = data.get('data', {}).get('rawHtml', '')
                if raw_content:
                    # Check if content is already valid SRT format
                    if '-->' in raw_content and re.search(r'\d{2}:\d{2}:\d{2}', raw_content):
                        if verbose:
                            print(f"    → Found transcript ({len(raw_content)} bytes)")
                        return raw_content

                    # Firecrawl may wrap SRT in HTML - extract text from <pre> or <body>
                    if raw_content.strip().startswith('<'):
                        from bs4 import BeautifulSoup
                        soup = BeautifulSoup(raw_content, 'html.parser')

                        # Try to find content in <pre> tag first (common for plain text files)
                        pre_tag = soup.find('pre')
                        if pre_tag:
                            text_content = pre_tag.get_text()
                        else:
                            # Fall back to body text
                            text_content = soup.get_text()

                        # Check if extracted content is valid SRT
                        if '-->' in text_content and re.search(r'\d{2}:\d{2}:\d{2}', text_content):
                            if verbose:
                                print(f"    → Found transcript in HTML ({len(text_content)} bytes)")
                            return text_content
                        else:
                            if verbose:
                                preview = text_content[:100].replace('\n', '\\n')
                                print(f"    → Extracted text is not SRT format: {preview}...")
                            return None
                    else:
                        if verbose:
                            preview = raw_content[:100].replace('\n', '\\n')
                            print(f"    → Response is not SRT format ({len(raw_content)} bytes): {preview}...")
                        return None
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


def sync_all_transcripts(data_dir: Path = None, verbose: bool = False, limit: int = 0) -> Dict[str, int]:
    """
    Sync transcripts for all meetings that don't have them yet.

    Args:
        data_dir: Directory containing meeting data
        verbose: Whether to print detailed logging (set VERBOSE=1 env var to enable)
        limit: Maximum number of meetings to check (0 = unlimited, set LIMIT env var)

    Returns:
        Dict with counts: added, skipped, errors
    """
    if data_dir is None:
        data_dir = Path(__file__).parent.parent / 'data'

    stats = {'added': 0, 'skipped': 0, 'errors': 0, 'already_have': 0, 'no_mapping': 0, 'too_old': 0}

    # Lillian's archive only has transcripts from ~mid-2024 onwards
    # Skip older meetings to avoid wasting API calls on non-existent transcripts
    TRANSCRIPT_CUTOFF = "2024-06"

    # Get all month directories, sorted newest first
    all_month_dirs = sorted(
        [d for d in data_dir.iterdir() if d.is_dir() and re.match(r'\d{4}-\d{2}', d.name)],
        key=lambda x: x.name,
        reverse=True
    )

    # Filter to only include months after the cutoff
    month_dirs = [d for d in all_month_dirs if d.name >= TRANSCRIPT_CUTOFF]
    skipped_months = len(all_month_dirs) - len(month_dirs)

    print(f"Scanning {len(month_dirs)} month directories for transcripts (skipping {skipped_months} months before {TRANSCRIPT_CUTOFF})...")
    print(f"Firecrawl API key: {'configured' if FIRECRAWL_API_KEY else 'NOT SET'}")
    print(f"Verbose mode: {'enabled' if verbose else 'disabled (set VERBOSE=1 to enable)'}")
    print(f"Limit: {limit if limit > 0 else 'unlimited'}")
    print()

    checked_count = 0

    for month_dir in month_dirs:
        # Get JSON files sorted by name (newest first within month)
        json_files = sorted(month_dir.glob('*.json'), key=lambda x: x.name, reverse=True)

        for json_path in json_files:
            # Check if we've hit the limit
            if limit > 0 and checked_count >= limit:
                print(f"\n  Reached limit of {limit} meetings, stopping.")
                return stats

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

            checked_count += 1
            print(f"  [{checked_count}{'/' + str(limit) if limit > 0 else ''}] Checking: {json_path.name}")

            if add_transcript_to_meeting(json_path, verbose=verbose):
                print(f"    ✓ Added transcript")
                stats['added'] += 1
            else:
                stats['skipped'] += 1

    return stats


def create_transcript_only_meeting(
    date: datetime,
    meeting_type: str,
    data_dir: Path = None,
    fetch_news: bool = True
) -> Optional[Path]:
    """
    Create a meeting JSON file from transcript only (no official minutes yet).

    This is useful when Lillian's archive has the transcript but the city
    hasn't published official minutes yet.

    Also searches for news coverage to supplement the transcript with
    vote information from London Free Press.

    Args:
        date: Meeting date
        meeting_type: Meeting type (e.g., "Council", "Planning and Environment Committee")
        data_dir: Path to data directory (defaults to ../data)
        fetch_news: Whether to search for news coverage (default True)

    Returns:
        Path to created JSON file, or None if transcript not available
    """
    if data_dir is None:
        data_dir = Path(__file__).parent.parent / 'data'

    # Fetch transcript
    transcript = fetch_transcript(date, meeting_type)
    if not transcript:
        print(f"  No transcript available for {date.strftime('%Y-%m-%d')} {meeting_type}")
        return None

    # Create month directory if needed
    month_dir = data_dir / date.strftime('%Y-%m')
    month_dir.mkdir(parents=True, exist_ok=True)

    # Generate filename
    mapped_type = MEETING_TYPE_MAPPING.get(meeting_type, meeting_type.replace(' ', '-'))
    filename = f"{date.strftime('%Y-%m-%d')}-{mapped_type}.json"
    json_path = month_dir / filename

    # Check if file already exists
    if json_path.exists():
        print(f"  Meeting file already exists: {json_path}")
        return None

    # Search for news coverage (for vote information)
    news_coverage = []
    if fetch_news and meeting_type in ['Council', 'City Council', 'Budget Committee']:
        print(f"  📰 Searching for news coverage...")
        news_coverage = search_news_coverage(date, meeting_type, verbose=True)
        if news_coverage:
            print(f"  ✓ Found {len(news_coverage)} news article(s) with vote info")

    # Create meeting structure with transcript only
    meeting_data = {
        "title": f"{meeting_type} Meeting",
        "datetime": date.strftime('%Y-%m-%d'),
        "url": None,  # No official minutes URL yet
        "meeting_type": meeting_type,
        "data_sources": {
            "official_minutes": False,
            "transcript": True,
            "news_coverage": bool(news_coverage)
        },
        "transcript": transcript,
        "transcript_source": "lillian_skinner_archive",
        "transcript_source_url": build_transcript_url(date, meeting_type),
        "transcript_duration": get_transcript_duration(transcript),
        "news_coverage": news_coverage,
        # Empty placeholders for official minutes data
        "present": [],
        "absent": [],
        "also_present": [],
        "items": {}
    }

    # Save to file
    try:
        with open(json_path, 'w') as f:
            json.dump(meeting_data, f, indent=2)
        print(f"  ✓ Created transcript-only meeting: {json_path.name}")
        return json_path
    except IOError as e:
        print(f"  Error writing {json_path}: {e}")
        return None


def scan_archive_for_new_transcripts(
    data_dir: Path = None,
    days_back: int = 30
) -> Dict[str, Any]:
    """
    Scan Lillian's archive for transcripts we don't have yet.

    Checks recent dates for each meeting type and creates transcript-only
    meeting files for any new transcripts found.

    Args:
        data_dir: Path to data directory (defaults to ../data)
        days_back: How many days back to scan (default 30)

    Returns:
        Dict with counts: created, already_exist, not_available
    """
    if data_dir is None:
        data_dir = Path(__file__).parent.parent / 'data'

    stats = {'created': 0, 'already_exist': 0, 'not_available': 0}

    # Meeting types to check
    meeting_types = list(MEETING_TYPE_MAPPING.keys())

    # Generate dates to check (newest first)
    today = datetime.now()
    dates_to_check = [today - timedelta(days=i) for i in range(days_back)]

    print(f"Scanning Lillian's archive for new transcripts...")
    print(f"  Checking {len(dates_to_check)} days across {len(meeting_types)} meeting types\n")

    for date in dates_to_check:
        for meeting_type in meeting_types:
            # Build expected filename
            mapped_type = MEETING_TYPE_MAPPING.get(meeting_type, meeting_type.replace(' ', '-'))
            month_dir = data_dir / date.strftime('%Y-%m')
            filename = f"{date.strftime('%Y-%m-%d')}-{mapped_type}.json"
            json_path = month_dir / filename

            # Skip if we already have this meeting
            if json_path.exists():
                stats['already_exist'] += 1
                continue

            # Check if transcript is available
            url = build_transcript_url(date, meeting_type)
            if not url:
                continue

            # Try to create transcript-only meeting
            result = create_transcript_only_meeting(date, meeting_type, data_dir)
            if result:
                stats['created'] += 1
            else:
                stats['not_available'] += 1

    return stats


if __name__ == '__main__':
    import sys

    # Check for verbose mode via environment variable
    verbose = os.environ.get('VERBOSE', '').lower() in ('1', 'true', 'yes')

    # Check for limit via environment variable (0 = unlimited)
    try:
        limit = int(os.environ.get('LIMIT', '0'))
    except ValueError:
        limit = 0

    if len(sys.argv) >= 2 and sys.argv[1] == '--scan':
        # Scan archive for new transcripts (creates transcript-only meetings)
        days = int(sys.argv[2]) if len(sys.argv) > 2 else 30
        print(f"🔍 Scanning Lillian's Archive for New Transcripts\n")
        stats = scan_archive_for_new_transcripts(days_back=days)

        print(f"\n📊 Results:")
        print(f"   Created: {stats['created']}")
        print(f"   Already exist: {stats['already_exist']}")
        print(f"   Not available: {stats['not_available']}")

    elif len(sys.argv) >= 2 and sys.argv[1] == '--create':
        # Create transcript-only meeting for specific date/type
        if len(sys.argv) < 4:
            print("Usage: python transcript.py --create 2025-11-25 Council")
            sys.exit(1)

        date_str = sys.argv[2]
        meeting_type = sys.argv[3]
        date = datetime.strptime(date_str, '%Y-%m-%d')

        print(f"📝 Creating transcript-only meeting for {date_str} {meeting_type}\n")
        result = create_transcript_only_meeting(date, meeting_type)
        if result:
            print(f"\n✅ Created: {result}")
        else:
            print("\n❌ Failed to create meeting file")

    elif len(sys.argv) == 3:
        # Fetch specific meeting transcript (preview only, don't save)
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
        # Sync all transcripts (add to existing meetings)
        print("🎙️ Transcript Sync\n")
        print("This adds transcripts to EXISTING meeting files.\n")
        print("To scan for NEW meetings from Lillian's archive, use:")
        print("  python transcript.py --scan [days_back]\n")
        print("To create a specific transcript-only meeting, use:")
        print("  python transcript.py --create 2025-11-25 Council\n")

        stats = sync_all_transcripts(verbose=verbose, limit=limit)

        print(f"\n📊 Results:")
        print(f"   Added: {stats['added']}")
        print(f"   Already have: {stats['already_have']}")
        print(f"   Not available: {stats['skipped']}")
        print(f"   Errors: {stats['errors']}")
