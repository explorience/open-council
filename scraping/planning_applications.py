#!/usr/bin/env python3
"""Planning-applications scraper (with a snapshot diff) for the City of London, Ontario.

Reads london.ca's public "current planning applications" listing and each application
page. Writes a dated local JSON snapshot; `diff` compares two snapshots. Local files
only: no database, no deploy, no login.

Rules it keeps:
- real User-Agent, at most one network request a second, every response cached on disk
  with an expiry (default 24 hours; `--cache-max-age-hours`, 0 = always refetch)
- no bypassing a browser check: a 403/429/5xx or a challenge page is recorded as
  `blocked` and skipped, never retried or worked around
- PDFs are never fetched: each link is kept with read=false
- nothing is invented: a field the page doesn't print is null

Usage:
  uv run planning_applications.py scrape --dry-run     # print what it found, write nothing
  uv run planning_applications.py scrape               # write output/planning/<date>.json
  uv run planning_applications.py diff OLD.json NEW.json [--json]
"""

import argparse
import hashlib
import json
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

SITE = "https://london.ca"
LISTING_URL = SITE + "/business-development/planning-development-applications/planning-applications"
USER_AGENT = "OpenCouncil-research (+https://github.com/explorience/open-council)"
MIN_INTERVAL_SECONDS = 1.0
DEFAULT_CACHE_MAX_AGE_HOURS = 24.0
MAX_LISTING_PAGES = 30  # safety stop; the City showed 8 on 25 Nov 2026
HERE = Path(__file__).parent
CACHE_DIR = HERE / ".cache" / "planning"
OUTPUT_DIR = HERE / "output" / "planning"
SCHEMA_VERSION = 1

BLOCK_STATUSES = {401, 403, 429, 503}
CHALLENGE_MARKERS = (
    "just a moment",
    "verify you are human",
    "checking your browser",
    "attention required",
    "access denied",
)
DATE_IN_TEXT_RE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+(\d{1,2}),\s+(\d{4})\b"
)


class Blocked(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


class PoliteFetcher:
    """GET with a User-Agent, a 1 request/second floor and an on-disk cache that expires."""

    def __init__(
        self,
        cache_dir=CACHE_DIR,
        min_interval=MIN_INTERVAL_SECONDS,
        max_age_hours=DEFAULT_CACHE_MAX_AGE_HOURS,
        session=None,
        clock=time.time,
    ):
        self.cache_dir = Path(cache_dir)
        self.min_interval = min_interval
        self.max_age_seconds = max_age_hours * 3600
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.clock = clock
        self._last = 0.0
        self.network_requests = 0
        self.cache_hits = 0
        self.cache_expired = 0

    def _path(self, url):
        return self.cache_dir / hashlib.sha1(url.encode()).hexdigest()

    def get(self, url):
        """Return page text. Raises Blocked if the site refuses or shows a challenge page."""
        path = self._path(url)
        if path.exists():
            age = self.clock() - path.stat().st_mtime
            if age <= self.max_age_seconds:
                self.cache_hits += 1
                return path.read_text(encoding="utf-8")
            self.cache_expired += 1
        wait = self.min_interval - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()
        self.network_requests += 1
        try:
            resp = self.session.get(url, timeout=30)
        except requests.RequestException as exc:
            raise Blocked(f"request failed: {type(exc).__name__}") from exc
        if resp.status_code in BLOCK_STATUSES or resp.status_code >= 500:
            raise Blocked(f"HTTP {resp.status_code}")
        if resp.status_code != 200:
            raise Blocked(f"HTTP {resp.status_code}")
        head = resp.text[:3000].lower()
        if any(marker in head for marker in CHALLENGE_MARKERS):
            raise Blocked("browser check page")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(resp.text, encoding="utf-8")
        return resp.text


def _text(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip() if node else ""


def _none_if_empty(value):
    return value if value else None


def parse_printed_date(text):
    """'Tuesday, July 28, 2026' or '... - November 12, 2026' -> '2026-07-28'; else None."""
    m = DATE_IN_TEXT_RE.search(text or "")
    if not m:
        return None
    try:
        return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y").date().isoformat()
    except ValueError:
        return None


# ---------------------------------------------------------------- listing


def parse_listing(html):
    """Listing page -> (application URLs in page order, last pager index or None)."""
    soup = BeautifulSoup(html, "html.parser")
    urls = []
    for art in soup.select("article.node--type-planning-application"):
        link = art.select_one("h2 a[href]")
        if link:
            url = urljoin(SITE, link["href"])
            if url not in urls:
                urls.append(url)
    last = None
    for a in soup.select(".pager a[href]"):
        qs = parse_qs(urlparse(a["href"]).query)
        if "page" in qs and qs["page"][0].isdigit():
            last = max(last or 0, int(qs["page"][0]))
    return urls, last


# ---------------------------------------------------------------- application page

def _sidebar_field(sidebar, name):
    node = sidebar.select_one(f".field--name-{name} > .field__item") if sidebar else None
    return _none_if_empty(_text(node))


def _parse_contacts(sidebar):
    contacts = []
    if not sidebar:
        return contacts
    for term in sidebar.select(".taxonomy-term"):
        name = _text(term.select_one("h2"))
        role = _text(term.select_one(".field--name-description"))
        email = term.select_one("a[href^='mailto:']")
        phone = term.select_one(".field--name-field-phone .field__item")
        contacts.append(
            {
                "name": _none_if_empty(name),
                "role": _none_if_empty(role),
                "email": email["href"][len("mailto:"):] if email else None,
                "phone": _none_if_empty(_text(phone)),
            }
        )
    return contacts


def _classify_link(url):
    if url.lower().split("?")[0].endswith(".pdf"):
        return "pdf"
    if "escribemeetings.com" in url:
        return "escribe"
    return "other"


def _doc_category(label, section):
    low = (label or "").lower()
    sec = (section or "").lower()
    if low.startswith("notice"):
        return "notice"
    if low.startswith("report to") or sec == "staff planning reports":
        return "staff_report"
    if low.startswith("council") or sec == "council decision":
        return "council_decision"
    return "other"


def parse_application(html, url):
    """One application page -> dict. Anything not printed is None (or an empty list)."""
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main") or soup
    sidebar = soup.select_one(".node__sidebar")
    h1 = soup.find("h1")

    # Body: walk in document order, tracking the current h2 section. Headings are not
    # reliable (some pages fold the notices under "What is proposed?"), so `section` is
    # kept as printed and `category` is read from the label.
    body = main.select_one(".node__content") or main
    documents, status, proposed_lines = [], {}, []
    section, seen_urls, in_proposal = None, set(), True

    def add_status(key, line):
        if line and line not in status.setdefault(key, []):
            status[key].append(line)

    for el in body.find_all(["h2", "p", "ul", "a"]):
        if sidebar and sidebar in el.parents:
            continue
        if el.name == "h2":
            section = _text(el)
            if section.lower() != "what is proposed?":
                in_proposal = False
            continue
        if el.name == "a":
            href = urljoin(SITE, el.get("href") or "")
            if not el.get("href") or href.startswith("mailto:") or href in seen_urls:
                continue
            kind = _classify_link(href)
            if kind == "other":
                continue
            seen_urls.add(href)
            in_proposal = False
            label = _text(el)
            documents.append(
                {
                    "section": section,
                    "category": _doc_category(label, section),
                    "label": _none_if_empty(label),
                    "url": href,
                    "kind": kind,
                    "label_date": parse_printed_date(label),
                    "read": False,
                }
            )
            continue
        if el.find_parent("a") or (el.name == "ul" and el.find_parent("p")):
            continue
        line = _text(el)
        low = line.lower()
        if not line or "please contact the planner" in low:
            continue
        if low.startswith("notice of community information"):
            in_proposal = False
            add_status("community_info_meeting", line)
        elif in_proposal and el.name in ("p", "ul") and not low.startswith("notice of"):
            proposed_lines.append(line)
        elif low.startswith("notice of"):
            in_proposal = False
        elif (section or "").lower() == "council decision":
            add_status("council_decision", line)
        elif (section or "").lower() == "staff planning reports":
            add_status("staff_report", line)
    for d in documents:
        key = {"staff_report": "staff_report", "council_decision": "council_decision"}.get(d["category"])
        if key:
            add_status(key, d["label"])

    last_mod = main.select_one(".node__last-modified")
    last_mod_text = _text(last_mod).replace("Last modified:", "").strip() if last_mod else ""

    app_type = _sidebar_field(sidebar, "field-planning-application-type")
    received = _sidebar_field(sidebar, "field-date")
    return {
        "url": url,
        "slug": url.rstrip("/").rsplit("/", 1)[-1],
        "title": _none_if_empty(_text(h1)),
        "file_number": _sidebar_field(sidebar, "field-file-number"),
        "application_type": app_type,
        "applicant": _sidebar_field(sidebar, "field-applicant"),
        "date_received": parse_printed_date(received),
        "date_received_printed": received,
        "last_modified": parse_printed_date(last_mod_text),
        "proposed": _none_if_empty(" ".join(proposed_lines)),
        "contacts": _parse_contacts(sidebar),
        "status": status or None,
        "documents": documents,
        "fetch": "ok",
    }


# ---------------------------------------------------------------- scrape


def scrape(fetcher, max_pages=None, limit=None, log=print):
    """Crawl the listing, then each application page. Returns a snapshot dict."""
    blocked, urls, listing_pages = [], [], 0
    page, last_page = 0, None
    cap = max_pages or MAX_LISTING_PAGES
    while page < cap and (last_page is None or page <= last_page):
        page_url = LISTING_URL if page == 0 else f"{LISTING_URL}?page={page}"
        try:
            html = fetcher.get(page_url)
        except Blocked as exc:
            blocked.append({"url": page_url, "kind": "listing", "reason": exc.reason})
            log(f"  blocked listing page {page}: {exc.reason}")
            break
        found, pager_last = parse_listing(html)
        listing_pages += 1
        if page == 0:
            last_page = pager_last if pager_last is not None else 0
        urls.extend(u for u in found if u not in urls)
        page += 1
    if limit:
        urls = urls[:limit]

    apps = []
    for url in urls:
        try:
            apps.append(parse_application(fetcher.get(url), url))
        except Blocked as exc:
            blocked.append({"url": url, "kind": "application", "reason": exc.reason})
            apps.append({"url": url, "slug": url.rstrip("/").rsplit("/", 1)[-1], "fetch": f"blocked: {exc.reason}"})
            log(f"  blocked {url}: {exc.reason}")
    return {
        "schema": SCHEMA_VERSION,
        "scraped_at": datetime.now().replace(microsecond=0).isoformat(),
        "source": LISTING_URL,
        "listing_pages": listing_pages,
        "applications_listed": len(urls),
        "applications": apps,
        "blocked": blocked,
        "network_requests": fetcher.network_requests,
        "cache_hits": fetcher.cache_hits,
    }


FIELDS = (
    "file_number", "application_type", "applicant", "date_received", "last_modified",
    "proposed", "contacts", "status",
)


def null_counts(snapshot):
    """How many parsed applications have each field null/empty (blocked pages excluded)."""
    ok = [a for a in snapshot["applications"] if a.get("fetch") == "ok"]
    counts = {f: sum(1 for a in ok if not a.get(f)) for f in FIELDS}
    counts["title"] = sum(1 for a in ok if not a.get("title"))
    return len(ok), counts


# ---------------------------------------------------------------- diff


def _key(app):
    return app["url"]


def _label(app):
    return {"url": app["url"], "title": app.get("title"), "file_number": app.get("file_number")}


def diff_snapshots(old, new):
    """Compare two snapshots. Blocked pages carry no data, so they are never 'removed' or 'changed'."""
    old_by = {_key(a): a for a in old["applications"]}
    new_by = {_key(a): a for a in new["applications"]}
    blocked_now = {b["url"] for b in new.get("blocked", [])} | {b["url"] for b in old.get("blocked", [])}
    out = {"old": old.get("scraped_at"), "new": new.get("scraped_at"),
           "new_files": [], "removed_files": [], "status_changes": [], "new_documents": [],
           "field_changes": [], "skipped_blocked": sorted(blocked_now)}
    for url, app in new_by.items():
        if url not in old_by and app.get("fetch") == "ok":
            out["new_files"].append(_label(app))
    for url, app in old_by.items():
        if url not in new_by and url not in blocked_now:
            out["removed_files"].append(_label(app))
    for url, app in new_by.items():
        before = old_by.get(url)
        if not before or before.get("fetch") != "ok" or app.get("fetch") != "ok":
            continue
        if (before.get("status") or None) != (app.get("status") or None):
            out["status_changes"].append({**_label(app), "from": before.get("status"), "to": app.get("status")})
        seen = {d["url"] for d in before.get("documents", [])}
        for d in app.get("documents", []):
            if d["url"] not in seen:
                out["new_documents"].append({**_label(app), "document": d})
        for f in ("file_number", "application_type", "applicant", "contacts"):
            if before.get(f) != app.get(f):
                out["field_changes"].append({**_label(app), "field": f, "from": before.get(f), "to": app.get(f)})
    return out


def format_diff(d):
    lines = [f"diff {d['old']} -> {d['new']}"]
    lines.append(f"new files: {len(d['new_files'])}")
    lines += [f"  + {x['title']} ({x['file_number'] or 'no file number'}) {x['url']}" for x in d["new_files"]]
    lines.append(f"removed files: {len(d['removed_files'])}")
    lines += [f"  - {x['title']} ({x['file_number'] or 'no file number'}) {x['url']}" for x in d["removed_files"]]
    lines.append(f"status changes: {len(d['status_changes'])}")
    lines += [f"  ~ {x['title']}: {json.dumps(x['from'])} -> {json.dumps(x['to'])}" for x in d["status_changes"]]
    lines.append(f"new documents: {len(d['new_documents'])}")
    lines += [f"  + {x['title']}: {x['document']['label']} {x['document']['url']}" for x in d["new_documents"]]
    lines.append(f"other field changes: {len(d['field_changes'])}")
    lines += [f"  ~ {x['title']}: {x['field']} {json.dumps(x['from'])} -> {json.dumps(x['to'])}" for x in d["field_changes"]]
    if d["skipped_blocked"]:
        lines.append(f"skipped (blocked in either snapshot): {len(d['skipped_blocked'])}")
    return "\n".join(lines)


# ---------------------------------------------------------------- cli


def cmd_scrape(args):
    fetcher = PoliteFetcher(max_age_hours=args.cache_max_age_hours)
    snap = scrape(fetcher, max_pages=args.max_pages, limit=args.limit)
    ok, nulls = null_counts(snap)
    print(f"listing pages: {snap['listing_pages']} | applications listed: {snap['applications_listed']} | parsed: {ok} | "
          f"blocked: {len(snap['blocked'])} | network requests: {fetcher.network_requests} | "
          f"cache hits: {fetcher.cache_hits} | cache expired: {fetcher.cache_expired}")
    print("null fields (of parsed): " + ", ".join(f"{k}={v}" for k, v in nulls.items()))
    for a in snap["applications"]:
        if a.get("fetch") == "ok":
            print(f"- {a['file_number'] or 'NO FILE NO.'} | {a['title']} | {a['application_type'] or 'no type'} | "
                  f"docs: {len(a['documents'])}")
        else:
            print(f"- {a['slug']} | {a['fetch']}")
    if args.dry_run:
        print("dry run: nothing written")
        return 0
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / f"{date.today().isoformat()}.json"
    path.write_text(json.dumps(snap, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {path}")
    return 0


def cmd_diff(args):
    old = json.loads(Path(args.old).read_text(encoding="utf-8"))
    new = json.loads(Path(args.new).read_text(encoding="utf-8"))
    d = diff_snapshots(old, new)
    print(json.dumps(d, indent=2, ensure_ascii=False) if args.json else format_diff(d))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scrape", help="crawl the listing and write a dated snapshot")
    s.add_argument("--dry-run", action="store_true", help="print what it found, write nothing")
    s.add_argument("--max-pages", type=int, help="listing pages to read (default: all the pager shows)")
    s.add_argument("--limit", type=int, help="only the first N applications")
    s.add_argument("--cache-max-age-hours", type=float, default=DEFAULT_CACHE_MAX_AGE_HOURS)
    s.set_defaults(func=cmd_scrape)
    d = sub.add_parser("diff", help="compare two snapshots")
    d.add_argument("old")
    d.add_argument("new")
    d.add_argument("--json", action="store_true")
    d.set_defaults(func=cmd_diff)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
