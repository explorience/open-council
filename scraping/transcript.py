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

# Anthropic API for AI-powered extraction
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')

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

    max_articles = 10  # Collect up to 10 relevant articles

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

                # Skip articles about other cities based on URL path
                url_lower = url.lower()
                # Check for city names in URL (with word boundaries using hyphen separators)
                other_city_patterns = [
                    'st-thomas', 'stthomas', '-woodstock', 'woodstock-',
                    '-strathroy', 'strathroy-', '-chatham', 'chatham-', '-windsor', 'windsor-'
                ]
                if any(pattern in url_lower for pattern in other_city_patterns):
                    if verbose:
                        print(f"    → Skipped [{i+1}]: URL indicates other city: {url[:70]}...")
                    continue

                # Skip if title doesn't seem relevant to council business
                title_lower = title.lower()

                # Skip crime/court news about councillors (not meeting business)
                crime_keywords = ['charged', 'charges', 'arrest', 'extortion', 'criminal', 'court', 'police', 'investigation', 'allegation', 'allegations']
                if any(word in title_lower for word in crime_keywords):
                    if verbose:
                        print(f"    → Skipped [{i+1}]: crime/court news, not meeting business: {title[:60]}...")
                    continue

                # Skip celebration/anniversary articles that aren't about council decisions
                celebration_keywords = ['celebrate', 'celebration', 'anniversary', 'birthday', 'turning 200', 'turning 100', 'turning 150']
                if any(word in title_lower for word in celebration_keywords):
                    # Only skip if there's no indication of a council decision
                    decision_keywords = ['vote', 'passed', 'rejected', 'approved', 'denied', 'defeats', 'backs', 'rejects']
                    if not any(word in title_lower for word in decision_keywords):
                        if verbose:
                            print(f"    → Skipped [{i+1}]: celebration/anniversary news, not meeting business: {title[:60]}...")
                        continue

                # Require council-related keywords
                if not any(word in title_lower for word in ['council', 'vote', 'councillor', 'city hall', 'budget', 'committee']):
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
        # Try archive.org first to bypass paywall
        # Format: https://web.archive.org/web/2/{url} gets most recent snapshot
        archive_url = f"https://web.archive.org/web/2/{url}"
        use_archive = False

        response = requests.post(
            FIRECRAWL_API_URL,
            headers={
                'Authorization': f'Bearer {FIRECRAWL_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'url': archive_url,
                'formats': ['markdown'],
                'waitFor': 3000,
            },
            timeout=45
        )

        # Check if archive.org returned actual article content (not its homepage)
        archive_ok = False
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                markdown = data.get('data', {}).get('markdown', '')
                metadata = data.get('data', {}).get('metadata', {})
                title = metadata.get('title', '') or ''
                # Detect archive.org homepage/error pages
                if 'Wayback Machine' not in title and 'Internet Archive' not in markdown[:500]:
                    archive_ok = True
                    use_archive = True
                    if verbose:
                        print(f"      → Using archive.org version")

        # If archive.org failed or returned homepage, try direct URL with social media bot headers
        # Postmedia sites sometimes allow social media crawlers through for link previews
        if not archive_ok:
            if verbose:
                print(f"      → Archive.org unavailable, trying direct URL...")
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
                    'headers': {
                        'User-Agent': 'Twitterbot/1.0',
                        'Referer': 'https://t.co/',
                    }
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

        # Check if article is from around the meeting date
        # Only use metadata dates - content dates are unreliable
        article_date = None

        if not use_archive:
            date_match = re.search(r'(\d{4}-\d{2}-\d{2})', str(metadata))
            if date_match:
                try:
                    article_date = datetime.strptime(date_match.group(1), '%Y-%m-%d')
                    # Filter out articles too far from meeting date
                    days_diff = abs((article_date - meeting_date).days)
                    if days_diff > 3:
                        if verbose:
                            print(f"      → Rejected: article date {article_date.strftime('%Y-%m-%d')} too far from meeting date")
                        return None
                except:
                    pass

        # Extract title
        title = metadata.get('title', '') or metadata.get('og:title', '')
        if not title:
            title_match = re.search(r'^#\s+(.+?)$', markdown, re.MULTILINE)
            title = title_match.group(1) if title_match else 'Unknown'

        # Filter out articles about other cities (e.g., St. Thomas, Woodstock)
        title_lower = title.lower()
        # Check for St. Thomas in various formats
        st_thomas_patterns = [
            'st. thomas', 'st thomas', 'stthomas',
            'thomas city', 'thomas council', 'thomas mayor',
            'thomas citycouncil',  # URL slug variant
        ]
        other_cities = ['woodstock', 'strathroy', 'chatham', 'windsor']

        is_other_city = any(p in title_lower for p in st_thomas_patterns + other_cities)
        if is_other_city and 'london' not in title_lower:
            if verbose:
                print(f"      → Rejected: article about another city, not London")
            return None

        # Second-pass filter: Skip crime/court news (actual title may differ from search result)
        crime_keywords = ['charged', 'charges', 'arrest', 'extortion', 'criminal', 'court', 'police', 'investigation', 'allegation', 'allegations']
        if any(word in title_lower for word in crime_keywords):
            if verbose:
                print(f"      → Rejected: crime/court news, not meeting business")
            return None

        # Second-pass filter: Skip celebration/anniversary articles without council decisions
        celebration_keywords = ['celebrate', 'celebration', 'anniversary', 'birthday', 'turning 200', 'turning 100', 'turning 150']
        if any(word in title_lower for word in celebration_keywords):
            decision_keywords = ['vote', 'passed', 'rejected', 'approved', 'denied', 'defeats', 'backs', 'rejects']
            if not any(word in title_lower for word in decision_keywords):
                if verbose:
                    print(f"      → Rejected: celebration/anniversary news, not meeting business")
                return None

        # Extract vote information from the article (uses AI if available)
        vote_data = extract_vote_info(markdown, verbose=verbose)

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


def extract_vote_info_with_ai(markdown: str, verbose: bool = False) -> Optional[Dict[str, Any]]:
    """
    Use AI to extract vote information from article text.

    This is more robust than regex patterns as it can understand
    natural language variations in how votes are reported.

    Args:
        markdown: Article content in markdown format
        verbose: Whether to print debug info

    Returns:
        Dict with vote_summary, councillors_for, councillors_against, or None if failed
    """
    if not ANTHROPIC_API_KEY:
        if verbose:
            print(f"      → Skipping AI extraction: ANTHROPIC_API_KEY not set")
        return None

    # Truncate article to first 4000 chars to save tokens
    article_text = markdown[:4000]

    prompt = """Analyze this news article about a London, Ontario city council meeting and extract vote information.

Current London City Council members (2022-2026) - 15 total:
- Mayor Josh Morgan
- Ward 1: Hadleigh McAlister
- Ward 2: Shawn Lewis
- Ward 3: Peter Cuddy
- Ward 4: Susan Stevenson
- Ward 5: Jerry Pribil
- Ward 6: Sam Trosow
- Ward 7: Corrine Rahman
- Ward 8: Steve Lehman
- Ward 9: Anna Hopkins
- Ward 10: Paul Van Meerbergen
- Ward 11: Skylar Franke
- Ward 12: Elizabeth Peloza
- Ward 13: David Ferreira
- Ward 14: Steven Hillier

Extract the following information in JSON format:
{
  "vote_summary": "Brief description of the vote result (e.g. '8-7 in favour', 'unanimous', 'tie vote failed')",
  "vote_tally_for": <number of votes in favour, or null if not mentioned>,
  "vote_tally_against": <number of votes against, or null if not mentioned>,
  "councillors_for": ["list of councillor LAST NAMES who voted in favour/yes"],
  "councillors_against": ["list of councillor LAST NAMES who voted against/no"]
}

CRITICAL RULES:
- A councillor can ONLY appear in ONE list - either "councillors_for" OR "councillors_against", NEVER both
- Read carefully to determine which side each councillor voted on
- Pay attention to phrasing like "voted against" vs "voted in favour" - these are opposites
- If article says "X, Y, Z voted against... while all others voted in favour", put X, Y, Z in councillors_against only
- Only include councillors explicitly mentioned as voting for or against
- Use last names only (e.g. "Morgan", "Lewis", "Van Meerbergen")
- If no vote information is found, return empty lists and empty vote_summary
- Extract the numeric vote tally if mentioned (e.g. "8-7 vote" means vote_tally_for=8, vote_tally_against=7)

Article text:
"""

    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "content-type": "application/json",
                "anthropic-version": "2023-06-01"
            },
            json={
                "model": "claude-sonnet-4-5-20250929",
                "max_tokens": 500,
                "messages": [
                    {"role": "user", "content": prompt + article_text}
                ]
            },
            timeout=30
        )

        if response.status_code != 200:
            if verbose:
                print(f"      → AI extraction failed: HTTP {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"      → API error: {error_data.get('error', {}).get('message', 'unknown')}")
                except:
                    print(f"      → Response: {response.text[:200]}")
            return None

        data = response.json()
        content = data.get("content", [{}])[0].get("text", "")

        if not content:
            if verbose:
                print(f"      → AI returned empty content")
            return None

        # Parse JSON from response
        # Handle case where response might have markdown code blocks
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]

        content = content.strip()
        if not content:
            if verbose:
                print(f"      → AI response had no JSON content")
            return None

        result = json.loads(content)

        if verbose:
            print(f"      → AI extracted: {result.get('vote_summary', 'no vote info')}")

        councillors_for = result.get("councillors_for", [])
        councillors_against = result.get("councillors_against", [])
        vote_tally_for = result.get("vote_tally_for")
        vote_tally_against = result.get("vote_tally_against")

        if verbose:
            print(f"      → Raw AI result: for={councillors_for}, against={councillors_against}")
            print(f"      → Vote tallies: for={vote_tally_for}, against={vote_tally_against}")

        # All councillors for inference
        all_councillors = [
            "Morgan", "McAlister", "Lewis", "Cuddy", "Stevenson", "Pribil", "Trosow",
            "Rahman", "Lehman", "Hopkins", "Van Meerbergen", "Franke", "Peloza", "Ferreira", "Hillier"
        ]

        # CRITICAL: Handle duplicates (AI sometimes puts same councillors in both lists)
        duplicates = set(councillors_for) & set(councillors_against)
        if duplicates:
            if verbose:
                print(f"      → Warning: Found duplicates in both lists: {duplicates}")

            # Try to use vote tally to determine which side duplicates belong to
            if vote_tally_for and vote_tally_against:
                num_duplicates = len(duplicates)
                if num_duplicates == vote_tally_against:
                    # Duplicates match the against count - they voted against
                    if verbose:
                        print(f"      → Duplicates match against tally ({vote_tally_against}), placing in against")
                    councillors_against = list(duplicates)
                    councillors_for = []
                elif num_duplicates == vote_tally_for:
                    # Duplicates match the for count - they voted for
                    if verbose:
                        print(f"      → Duplicates match for tally ({vote_tally_for}), placing in for")
                    councillors_for = list(duplicates)
                    councillors_against = []
                else:
                    # Can't determine, remove from both
                    if verbose:
                        print(f"      → Can't determine side, removing duplicates from both lists")
                    councillors_for = [c for c in councillors_for if c not in duplicates]
                    councillors_against = [c for c in councillors_against if c not in duplicates]
            else:
                # No vote tally, remove from both
                if verbose:
                    print(f"      → No vote tally, removing duplicates from both lists")
                councillors_for = [c for c in councillors_for if c not in duplicates]
                councillors_against = [c for c in councillors_against if c not in duplicates]

        # Try to infer remaining councillors if vote tally adds up to 15 (full council)
        # This handles "X, Y, Z voted against... while all others voted in favour" cases
        if vote_tally_for and vote_tally_against:
            total_votes = vote_tally_for + vote_tally_against
            if total_votes == 15:  # Full council present
                # If we have the right number of councillors on one side, infer the other side
                if len(councillors_against) == vote_tally_against and len(councillors_for) < vote_tally_for:
                    # We have all the against votes, infer the for votes
                    inferred_for = [c for c in all_councillors if c not in councillors_against]
                    if len(inferred_for) == vote_tally_for:
                        if verbose:
                            print(f"      → Inferred {len(inferred_for)} councillors voting FOR from 'all others'")
                        councillors_for = inferred_for

                elif len(councillors_for) == vote_tally_for and len(councillors_against) < vote_tally_against:
                    # We have all the for votes, infer the against votes
                    inferred_against = [c for c in all_councillors if c not in councillors_for]
                    if len(inferred_against) == vote_tally_against:
                        if verbose:
                            print(f"      → Inferred {len(inferred_against)} councillors voting AGAINST from 'all others'")
                        councillors_against = inferred_against

        if verbose:
            print(f"      → Final result: for={councillors_for}, against={councillors_against}")

        return {
            "vote_summary": result.get("vote_summary", ""),
            "councillors_for": councillors_for,
            "councillors_against": councillors_against,
            "raw_mentions": []
        }

    except Exception as e:
        if verbose:
            print(f"      → AI extraction error: {e}")
        return None


def extract_vote_info(markdown: str, verbose: bool = False) -> Dict[str, Any]:
    """
    Extract vote tallies and councillor positions from article text.

    Uses AI extraction if available, falls back to regex patterns.

    Args:
        markdown: Article content in markdown format
        verbose: Whether to print debug info

    Returns:
        Dict with vote_summary (str), councillors_for (list), councillors_against (list)
    """
    # Try AI extraction first (more robust)
    ai_result = extract_vote_info_with_ai(markdown, verbose=verbose)
    if ai_result and (ai_result["vote_summary"] or ai_result["councillors_for"] or ai_result["councillors_against"]):
        return ai_result

    # Fall back to regex patterns
    result = {
        "vote_summary": "",
        "councillors_for": [],
        "councillors_against": [],
        "raw_mentions": []
    }

    # Known councillor names (current London council 2022-2026)
    # Mayor + 14 ward councillors
    councillor_names = [
        "Morgan",           # Mayor Josh Morgan
        "McAlister",        # Ward 1 - Hadleigh McAlister
        "Lewis",            # Ward 2 - Shawn Lewis
        "Cuddy",            # Ward 3 - Peter Cuddy
        "Stevenson",        # Ward 4 - Susan Stevenson
        "Pribil",           # Ward 5 - Jerry Pribil
        "Trosow",           # Ward 6 - Sam Trosow
        "Rahman",           # Ward 7 - Corrine Rahman
        "Lehman",           # Ward 8 - Steve Lehman
        "Hopkins",          # Ward 9 - Anna Hopkins
        "Van Meerbergen",   # Ward 10 - Paul Van Meerbergen
        "Franke",           # Ward 11 - Skylar Franke
        "Peloza",           # Ward 12 - Elizabeth Peloza
        "Ferreira",         # Ward 13 - David Ferreira
        "Hillier",          # Ward 14 - Steven Hillier
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

    # Look for lists of councillors who voted against
    # Pattern 1: "Councillors X, Y, Z voted against [thing]"
    # Pattern 2: "voting against were: X, Y, Z"
    against_list_patterns = [
        r'[Cc]ouncillors?\s+([^.]+?)\s+voted\s+against',
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

    # Look for lists of councillors who voted in favour
    # Pattern 1: "Councillors X, Y, Z voted in favour"
    # Pattern 2: "voting in favour were: X, Y, Z"
    favour_list_patterns = [
        r'[Cc]ouncillors?\s+([^.]+?)\s+voted\s+(?:in favour|for|yes)',
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
        Summary string (first ~2000 meaningful characters)
    """
    # Remove markdown formatting
    text = re.sub(r'!\[[^\]]*\]\([^)]+\)', '', markdown)  # Remove images first (![...](url))
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)  # Links - keep text, remove URL
    text = re.sub(r'[#*_`]', '', text)  # Formatting chars
    text = re.sub(r'\n+', ' ', text)  # Newlines
    text = re.sub(r'\s+', ' ', text)  # Multiple spaces

    # Remove common garbage patterns (paywall, newsletter, footer, etc.)
    garbage_patterns = [
        r'Thanks for signing up!.*?junk folder\.?',
        r'A welcome email is on its way\.?',
        r'The next issue of.*?will soon be in your inbox\.?',
        r'We encountered an issue signing you up\.?',
        r'If you don\'t see it,.*?junk folder\.?',
        r'Local News\s*',  # Category labels
        r'News\s*Local News\s*',
        r'Share this Story:.*?Email',  # Share buttons
        r'Related Stories.*',  # Related articles section
        r'More on this Topic.*',
        r'Recommended from Editorial.*',
        r'Postmedia is committed to.*',
        r'Comments\s*Postmedia.*',
        r'This Week in Flyers.*',
        r'Article content\s*',
        r'breadcrumb.*?Local News',
        r'We apologize, but this video has failed to load',
        r'Try refreshing your browser',
        r'tap here to see other videos from our team',
    ]
    for pattern in garbage_patterns:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE | re.DOTALL)

    # Phrases that indicate we should skip this sentence entirely
    skip_phrases = [
        'subscribe', 'sign up', 'newsletter', 'advertisement', 'skip to content',
        'sign in', 'create an account', 'email address', 'continue or', 'view more offers',
        'google', 'microsoft', 'apple', 'facebook',
        'already have an account', 'forgot password', 'log in', 'register',
        'welcome email', 'junk folder', 'inbox', 'cookie', 'privacy policy',
        'terms of service', 'share this', 'recommended from', 'more on this topic',
        'comments are closed', 'posting guidelines', 'report an error',
        'have a story idea', 'send it to us', 'related stories',
        'this week in flyers', 'postmedia network', 'postmedia is committed',
    ]
    lines = text.split('. ')

    summary_parts = []
    char_count = 0

    for line in lines:
        line = line.strip()
        # Skip very short lines or lines that are just category/byline fragments
        if not line or len(line) < 25:
            continue
        # Skip lines with garbage phrases
        if any(phrase in line.lower() for phrase in skip_phrases):
            continue
        # Skip lines that are just author bylines
        if re.match(r'^By\s+[A-Z][a-z]+\s+[A-Z]', line):
            continue
        # Skip lines that are just dates
        if re.match(r'^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)', line):
            continue

        summary_parts.append(line)
        char_count += len(line) + 2  # +2 for ". " separator

        if char_count >= 2000:
            break

    result = '. '.join(summary_parts)

    # Only add "..." if we actually truncated
    if char_count >= 2000 and result:
        return result[:2000] + '...'
    return result


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


def consolidate_transcript(segments: List[Dict[str, Any]]) -> str:
    """
    Consolidate transcript segments into a single text string.

    Joins all segment text with spaces, producing a single continuous transcript.
    This simplifies storage and improves downstream chunking for embeddings.

    Args:
        segments: List of transcript segment dicts with 'text' field

    Returns:
        Consolidated transcript as a single string
    """
    if not segments:
        return ""

    return " ".join(segment['text'] for segment in segments)


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
    existing_transcript = meeting.get('transcript')
    if existing_transcript and (isinstance(existing_transcript, str) or len(existing_transcript) > 0):
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
    transcript_segments = fetch_transcript(meeting_date, meeting_type, verbose=verbose)
    if not transcript_segments:
        return False

    # Add consolidated transcript to meeting data
    meeting['transcript'] = consolidate_transcript(transcript_segments)
    meeting['transcript_duration'] = get_transcript_duration(transcript_segments)
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
                    existing_transcript = meeting.get('transcript')
                    if existing_transcript and (isinstance(existing_transcript, str) or len(existing_transcript) > 0):
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
    transcript_segments = fetch_transcript(date, meeting_type)
    if not transcript_segments:
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
        "transcript": consolidate_transcript(transcript_segments),
        "transcript_source": "lillian_skinner_archive",
        "transcript_source_url": build_transcript_url(date, meeting_type),
        "transcript_duration": get_transcript_duration(transcript_segments),
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
