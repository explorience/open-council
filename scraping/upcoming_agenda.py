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
  uv run upcoming_agenda.py --dry-run            # print what it found, write nothing
  uv run upcoming_agenda.py --days 60            # write output/upcoming/<date>.json
"""

import argparse
import hashlib
import json
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://pub-london.escribemeetings.com/"
CALENDAR_URL = BASE_URL + "MeetingsCalendarView.aspx/GetCalendarMeetings"
USER_AGENT = "OpenCouncil-research (+https://github.com/explorience/open-council)"
MIN_INTERVAL_SECONDS = 1.0
HERE = Path(__file__).parent
CACHE_DIR = HERE / ".cache" / "upcoming"
OUTPUT_DIR = HERE / "output" / "upcoming"

STREET_TYPES = (
    "Road|Street|Avenue|Drive|Boulevard|Lane|Court|Crescent|Way|Place|Line|"
    "Trail|Parkway|Circle|Terrace|Gate|Row|Walk|Heights|Gardens"
)
# Conservative: a civic number (or range) + 1 to 3 capitalised words + a full street type,
# optionally followed by a compass direction. Abbreviations (St, Rd) are not matched.
ADDRESS_RE = re.compile(
    r"\b\d{1,5}(?:\s?[-–]\s?\d{1,5})?\s+(?:[A-Z][A-Za-z.'’]+\s+){1,3}"
    rf"(?:{STREET_TYPES})\b(?:\s+(?:East|West|North|South))?"
)
# Planning file numbers seen on London agendas (OZ-1234, Z-1234, O-1234, H-1234, P-1234,
# 39T-23505, 39CD-23501, SPA24-051). Anything else is left null.
FILE_NUMBER_RE = re.compile(r"\b(?:39T|39CD|OZ|SPA\d{2}|Z|O|H|P)-\d{3,5}\b")


class PoliteFetcher:
    """GET/POST with a User-Agent, a 1 request/second floor and an on-disk cache."""

    def __init__(self, cache_dir=CACHE_DIR, min_interval=MIN_INTERVAL_SECONDS, session=None):
        self.cache_dir = Path(cache_dir)
        self.min_interval = min_interval
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._last = 0.0
        self.network_requests = 0
        self.cache_hits = 0

    def _key(self, method, url, body):
        raw = f"{method} {url} {json.dumps(body, sort_keys=True)}"
        return hashlib.sha1(raw.encode()).hexdigest()

    def _fetch(self, method, url, body, use_cache):
        path = self.cache_dir / self._key(method, url, body)
        if use_cache and path.exists():
            self.cache_hits += 1
            return path.read_text(encoding="utf-8")
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
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return text

    def get(self, url, use_cache=True):
        return self._fetch("GET", url, None, use_cache)

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
        # "Merged" is the agenda including addeds: prefer it when the City has posted one.
        for doc_type in ("Merged", "Agenda"):
            for doc in m.get("MeetingDocumentLink") or []:
                if doc.get("Type") != doc_type:
                    continue
                url = urljoin(BASE_URL, doc.get("Url") or "") or None
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
            }
        )
    return out


def _text(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip() if node else ""


def find_addresses(text):
    seen = []
    for match in ADDRESS_RE.finditer(text or ""):
        value = re.sub(r"\s+", " ", match.group(0)).strip()
        if value not in seen:
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
        if not stub["agenda_url"]:
            record["status"] = "no_agenda_yet" if not stub["has_agenda"] else "agenda_link_missing"
            results.append(record)
            continue
        try:
            html = fetcher.get(stub["agenda_url"])
            parsed = parse_agenda(html, stub["agenda_url"])
            record["items"] = parsed["items"]
            record["parse_failures"] = parsed["parse_failures"]
            record["status"] = "parsed" if not parsed["parse_failures"] else "parsed_with_failures"
        except requests.RequestException as exc:
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
    ap.add_argument("--dry-run", action="store_true", help="print what was found, write nothing")
    ap.add_argument("--out", type=Path, default=OUTPUT_DIR, help="output directory")
    ap.add_argument("--json", action="store_true", help="with --dry-run, print full JSON")
    args = ap.parse_args(argv)

    fetcher = PoliteFetcher()
    today = date.today()
    start = args.start or today
    results = scrape(fetcher, start, start + timedelta(days=args.days))
    print(summarise(results))
    print(f"Network requests: {fetcher.network_requests}, cache hits: {fetcher.cache_hits}")
    if args.dry_run:
        if args.json:
            print(json.dumps(results, indent=2, ensure_ascii=False))
        print("(dry run: nothing written)")
        return 0
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"{today.isoformat()}.json"
    payload = {"scraped_at": datetime.now().isoformat(timespec="seconds"), "meetings": results}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
