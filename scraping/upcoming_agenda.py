#!/usr/bin/env python3
"""Upcoming-agenda scraper for London, Ontario council and committee meetings.

Reads the public eSCRIBE calendar (JSON) and each upcoming meeting's agenda
page (HTML). Writes local JSON only: no database, no deploy, no login.

Rules it keeps:
- real User-Agent, at most one network request a second, every response cached on disk
- staff-report PDFs are never fetched (they sit behind a browser check); the link is
  recorded with read=false
- nothing is invented: a field that can't be parsed is null

Usage:
  uv run upcoming_agenda.py --dry-run            # print what it found, write no output or cache files
  uv run upcoming_agenda.py --days 60            # write output/upcoming/<date>.json
"""

import argparse
import hashlib
import json
import logging
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://pub-london.escribemeetings.com/"
CALENDAR_URL = BASE_URL + "MeetingsCalendarView.aspx/GetCalendarMeetings"
USER_AGENT = "OpenCouncil-research (+https://github.com/explorience/open-council)"
MIN_INTERVAL_SECONDS = 1.0
# Only the City's own eSCRIBE host is ever fetched; any other link in the calendar is skipped.
ALLOWED_HOSTS = frozenset({"pub-london.escribemeetings.com"})
# Cached agendas expire so addeds posted later are seen. Bad pages are never cached at all.
CACHE_TTL_SECONDS = 6 * 60 * 60
MIN_CACHEABLE_CHARS = 200
log = logging.getLogger("upcoming_agenda")
HERE = Path(__file__).parent
CACHE_DIR = HERE / ".cache" / "upcoming"
OUTPUT_DIR = HERE / "output" / "upcoming"

STREET_TYPES = (
    "Road|Street|Avenue|Drive|Boulevard|Lane|Court|Crescent|Way|Place|Line|"
    "Trail|Parkway|Circle|Terrace|Gate|Row|Walk|Heights|Gardens"
)
# Conservative: a civic number, range or list ("123, 125 and 127") + 1 to 3 capitalised words + a
# full street type, optionally followed by a compass direction. Abbreviations (Rd) are not matched;
# "St" is only read as part of a name ("365 St. James Street"). A number glued to a digit, dot,
# comma, dollar sign or hyphen ("4.2", "$1,200", "11-19") never starts an address.
_NUM = r"\d{1,5}"
_RANGE = rf"{_NUM}(?:\s?[-–]\s?{_NUM})?"
ADDRESS_RE = re.compile(
    rf"(?<![\w.,$/–-])(?P<nums>{_RANGE}(?:(?:,\s+and\s+|,\s+|\s+and\s+|\s+&\s+){_RANGE})*)"
    r"(?P<street>\s+(?:[A-Z][A-Za-z.'’]+\s+){1,3}"
    rf"(?:{STREET_TYPES})\b(?:\s+(?:East|West|North|South))?)"
)
# A number after one of these words is a reference, not a civic number ("Phase 2 Wonderland Road").
NOT_ADDRESS_PREFIX_RE = re.compile(
    r"\b(?:phase|item|part|report|section|schedule|appendix|stage|bill|no|number|policy|motion|"
    r"by-?law|recommendation|clause|table|figure)\.?\s*$",
    re.IGNORECASE,
)
# A lone number in 1900-2099 is probably a year. It is dropped when a year-ish word comes before it,
# or the name reads like a project or document title, not a place.
YEAR_CONTEXT_RE = re.compile(r"\b(?:the|of|in|for|during|since|by|from|to|fiscal|year|budget)\s*$", re.IGNORECASE)
PROJECT_WORD_RE = re.compile(
    r"(?:budget|plan|strategy|program|report|committee|update)\b|\s+(?:extension|widening|project|"
    r"improvements?|study|strategy|program)\b",
    re.IGNORECASE,
)
# Planning file numbers seen on London agendas (OZ-1234, Z-1234, O-1234, H-1234, P-1234,
# 39T-23505, 39CD-23501, SPA24-051). Anything else is left null.
FILE_NUMBER_RE = re.compile(r"\b(?:39T|39CD|OZ|SPA\d{2}|Z|O|H|P)-\d{3,5}\b")


class OffsiteURLError(ValueError):
    """A URL whose host is not on the allowlist. It is never fetched."""


def host_allowed(url, allowed_hosts=ALLOWED_HOSTS):
    return (urlparse(url).hostname or "").lower() in allowed_hosts


def looks_like_agenda(html):
    """An agenda page that parsed to nothing (browser check, half-posted) must not be cached."""
    return "AgendaItemContainer" in (html or "")


class PoliteFetcher:
    """GET/POST with a User-Agent, a 1 request/second floor and an on-disk cache."""

    def __init__(self, cache_dir=CACHE_DIR, min_interval=MIN_INTERVAL_SECONDS, session=None,
                 ttl_seconds=CACHE_TTL_SECONDS, write_cache=True, allowed_hosts=ALLOWED_HOSTS):
        self.cache_dir = Path(cache_dir)
        self.ttl_seconds = ttl_seconds
        self.write_cache = write_cache
        self.allowed_hosts = allowed_hosts
        self.min_interval = min_interval
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._last = 0.0
        self.network_requests = 0
        self.cache_hits = 0

    def _key(self, method, url, body):
        raw = f"{method} {url} {json.dumps(body, sort_keys=True)}"
        return hashlib.sha1(raw.encode()).hexdigest()

    def _fetch(self, method, url, body, use_cache, cache_ok=None):
        if (urlparse(url).hostname or "").lower() not in self.allowed_hosts:
            raise OffsiteURLError(f"host not on the allowlist: {url}")
        path = self.cache_dir / self._key(method, url, body)
        if use_cache and path.exists():
            if time.time() - path.stat().st_mtime < self.ttl_seconds:
                self.cache_hits += 1
                return path.read_text(encoding="utf-8")
            log.info("cache expired, refetching %s", url)
        wait = self.min_interval - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()
        self.network_requests += 1
        if method == "POST":
            resp = self.session.post(url, json=body, timeout=30)
        else:
            resp = self.session.get(url, timeout=30)
        resp.raise_for_status()
        text = resp.text
        # Only a plain 200 with a real-looking body is worth keeping; anything else is refetched next run.
        good = resp.status_code == 200 and len(text or "") >= MIN_CACHEABLE_CHARS and (cache_ok is None or cache_ok(text))
        if good and self.write_cache:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        elif not good:
            log.warning("not caching a bad page from %s (status %s, %d chars)", url, resp.status_code, len(text or ""))
        return text

    def get(self, url, use_cache=True, cache_ok=None):
        return self._fetch("GET", url, None, use_cache, cache_ok)

    def post_json(self, url, body, use_cache=False):
        # The calendar changes as agendas are posted, so it is only cached on request.
        return self._fetch("POST", url, body, use_cache)


def fetch_calendar(fetcher, start: date, end: date):
    body = {"calendarStartDate": start.isoformat(), "calendarEndDate": end.isoformat()}
    return json.loads(fetcher.post_json(CALENDAR_URL, body))["d"]


def parse_calendar(meetings):
    """Calendar JSON -> list of meeting stubs (no agenda items yet)."""
    out = []
    for m in meetings:
        agenda_html = None
        agenda_pdf = None
        offsite = []
        # "Merged" is the agenda including addeds: prefer it when the City has posted one.
        for doc_type in ("Merged", "Agenda"):
            for doc in m.get("MeetingDocumentLink") or []:
                if doc.get("Type") != doc_type:
                    continue
                url = urljoin(BASE_URL, doc.get("Url") or "") or None
                if url and not host_allowed(url):
                    offsite.append(url)
                    continue
                if doc.get("Format") == "HTML" and not agenda_html:
                    agenda_html = url
                elif doc.get("Format") == ".pdf" and not agenda_pdf:
                    agenda_pdf = url
        start = None
        try:
            start = datetime.strptime(m["StartDate"], "%Y/%m/%d %H:%M:%S").isoformat()
        except (KeyError, TypeError, ValueError):
            pass
        out.append(
            {
                "meeting_id": m.get("ID"),
                "name": m.get("MeetingName"),
                "start": start,
                "location": (m.get("Location") or None),
                "calendar_url": m.get("Url"),
                "has_agenda": bool(m.get("HasAgenda")),
                "agenda_url": agenda_html,
                "agenda_pdf_url": agenda_pdf,
                "offsite_links": offsite,
            }
        )
    return out


def _text(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip() if node else ""


def find_addresses(text):
    text = text or ""
    seen, keys = [], set()
    for match in ADDRESS_RE.finditer(text):
        if NOT_ADDRESS_PREFIX_RE.search(text[: match.start()]):
            continue
        nums = re.findall(_RANGE, match.group("nums"))
        street = re.sub(r"\s+", " ", match.group("street")).strip()
        if len(nums) == 1 and re.fullmatch(r"(?:19|20)\d\d", nums[0]):
            after = text[match.end():match.end() + 20]
            if (YEAR_CONTEXT_RE.search(text[: match.start()])
                    or PROJECT_WORD_RE.search(street) or PROJECT_WORD_RE.match(after)):
                continue
        for num in nums:
            value = f"{num} {street}"
            key = value.replace(".", "").lower()  # "St." and "St" are one address
            if key not in keys:
                keys.add(key)
                seen.append(value)
    return seen


def find_file_numbers(text):
    seen = []
    for match in FILE_NUMBER_RE.finditer(text or ""):
        if match.group(0) not in seen:
            seen.append(match.group(0))
    return seen


def _meeting_start(soup, failures):
    """Two layouts exist: one <time datetime="YYYY-MM-DD HH:MM">, or a date <time> plus a time <time>."""
    start_el = soup.select_one(".AgendaMeetingTimeStart time")
    value = start_el.get("datetime") if start_el else None
    if value and re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", value):
        return datetime.strptime(value, "%Y-%m-%d %H:%M").isoformat()
    date_el = soup.find("time", attrs={"datetime": re.compile(r"^\d{4}-\d{2}-\d{2}$")})
    if date_el and value and re.fullmatch(r"\d{2}:\d{2}", value):
        return datetime.strptime(f"{date_el['datetime']} {value}", "%Y-%m-%d %H:%M").isoformat()
    if value:
        failures.append(f"meeting time not parsed: {value!r}")
    return None


def parse_agenda(html, agenda_url=None):
    """Agenda HTML -> {"meeting": {...}, "items": [...], "parse_failures": [...]}."""
    soup = BeautifulSoup(html, "html.parser")
    failures = []

    title_el = soup.select_one(".AgendaHeaderTitle")
    heading = None
    if title_el:
        parts = [p.strip() for p in title_el.get_text("\n").split("\n") if p.strip()]
        heading = parts[-1] if parts else None
    meeting_start = _meeting_start(soup, failures)
    if not heading:
        failures.append("meeting heading not found")
    if not meeting_start:
        failures.append("meeting time not found")

    items = []
    for container in soup.select(".AgendaItemContainer"):
        counter = _text(container.select_one(".AgendaItemCounter")) or None
        title = _text(container.select_one(".AgendaItemTitle")) or None
        if not title:
            failures.append(f"item {counter or '?'}: no title")
        if not counter:
            failures.append(f"item with title {title!r}: no item number")

        # Only this item's own attachment list, not its child items'.
        own = container.select_one(".AgendaItem")
        links, seen_hrefs = [], set()
        for a in (own or container).select(".AgendaItemAttachment a.Link"):
            href = a.get("href")
            if not href or href in seen_hrefs:
                continue
            seen_hrefs.add(href)
            name = a.get("data-original-title") or _text(a) or None
            url = urljoin(BASE_URL, href)
            is_pdf = bool(name and name.lower().endswith(".pdf")) or "filestream" in href.lower()
            links.append({"name": name, "url": url, "is_pdf": is_pdf, "read": False})

        searchable = " ".join([title or ""] + [l["name"] or "" for l in links])
        items.append(
            {
                "item_number": counter,
                "title": title,
                "addresses": find_addresses(searchable),
                "file_numbers": find_file_numbers(searchable),
                "documents": links,
            }
        )
    if not items:
        failures.append("no agenda items found")

    return {
        "meeting": {"heading": heading, "start": meeting_start, "agenda_url": agenda_url},
        "items": items,
        "parse_failures": failures,
    }


def scrape(fetcher, start: date, end: date):
    meetings = parse_calendar(fetch_calendar(fetcher, start, end))
    results = []
    for stub in meetings:
        record = dict(stub, items=None, parse_failures=[])
        if stub["offsite_links"]:
            log.warning("skipped off-list link(s) for %r: %s", stub["name"], ", ".join(stub["offsite_links"]))
        if not stub["agenda_url"]:
            if stub["offsite_links"]:
                record["status"] = "agenda_link_offsite"
                results.append(record)
                continue
            record["status"] = "no_agenda_yet" if not stub["has_agenda"] else "agenda_link_missing"
            results.append(record)
            continue
        try:
            html = fetcher.get(stub["agenda_url"], cache_ok=looks_like_agenda)
            parsed = parse_agenda(html, stub["agenda_url"])
            record["items"] = parsed["items"]
            record["parse_failures"] = parsed["parse_failures"]
            record["status"] = "parsed" if not parsed["parse_failures"] else "parsed_with_failures"
        except (requests.RequestException, OffsiteURLError) as exc:
            record["status"] = "fetch_failed"
            record["parse_failures"] = [f"fetch failed: {exc}"]
        results.append(record)
    return results


def summarise(results):
    lines = [f"Meetings found: {len(results)}"]
    for r in results:
        n = len(r["items"]) if r["items"] is not None else None
        lines.append(
            f"- {r['start'] or 'date unknown'} | {r['name']} | {r['status']} | items: "
            f"{n if n is not None else 'n/a'} | failures: {len(r['parse_failures'])}"
        )
        for f in r["parse_failures"]:
            lines.append(f"    ! {f}")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=60, help="how far ahead to look (default 60)")
    ap.add_argument("--from", dest="start", type=date.fromisoformat, default=None,
                    help="start date YYYY-MM-DD (default today); use an earlier date to see meetings already held")
    ap.add_argument("--dry-run", action="store_true", help="print what was found, write no output or cache files")
    ap.add_argument("--out", type=Path, default=OUTPUT_DIR, help="output directory")
    ap.add_argument("--json", action="store_true", help="with --dry-run, print full JSON")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    fetcher = PoliteFetcher(write_cache=not args.dry_run)
    today = date.today()
    start = args.start or today
    results = scrape(fetcher, start, start + timedelta(days=args.days))
    print(summarise(results))
    print(f"Network requests: {fetcher.network_requests}, cache hits: {fetcher.cache_hits}")
    if args.dry_run:
        if args.json:
            print(json.dumps(results, indent=2, ensure_ascii=False))
        print("(dry run: no output or cache written)")
        return 0
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"{today.isoformat()}.json"
    payload = {"scraped_at": datetime.now().isoformat(timespec="seconds"), "meetings": results}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
