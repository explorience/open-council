"""Offline tests for planning_applications.py. They read saved fixtures and never touch the network."""

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import planning_applications as pa

FIX = Path(__file__).parent / "test_samples" / "planning"


def read(name):
    return (FIX / name).read_text(encoding="utf-8")


def response(text="", status=200):
    return mock.Mock(text=text, status_code=status)


class FakeSession:
    """Serves fixtures by URL. Any URL not in `pages` answers 404."""

    def __init__(self, pages):
        self.headers = {}
        self.pages = pages
        self.calls = []

    def get(self, url, timeout=None):
        self.calls.append(url)
        if url in self.pages:
            page = self.pages[url]
            return page if isinstance(page, mock.Mock) else response(page)
        return response("", 404)


class Parsing(unittest.TestCase):
    def test_listing_urls_and_pager(self):
        urls, last = pa.parse_listing(read("listing-page-2.html"))
        self.assertEqual(len(urls), 10)
        self.assertTrue(all(u.startswith("https://london.ca/business-development/") for u in urls))
        self.assertIn(
            "https://london.ca/business-development/planning-development-applications/planning-applications/447-commissioners-road",
            urls,
        )
        self.assertEqual(last, 7)

    def test_callaway_fields(self):
        a = pa.parse_application(read("callaway-465.html"), "https://london.ca/x/465-callaway-road")
        self.assertEqual(a["title"], "465 Callaway Road")
        self.assertEqual(a["file_number"], "MZ-26126 and H-26127")
        self.assertEqual(a["applicant"], "Zelinka Priamo Ltd.")
        self.assertEqual(a["application_type"], "Minor Zoning By-Law Amendment & Intent to Remove Holding Provision")
        self.assertEqual(a["date_received"], "2026-11-05")
        self.assertEqual(a["last_modified"], "2026-11-11")
        planner = [c for c in a["contacts"] if c["role"] == "Planner"][0]
        self.assertEqual(planner["name"], "Besim Begovic")
        self.assertEqual(planner["email"], "bbegovic@london.ca")
        self.assertEqual(planner["phone"], "519-661-2489 x6854")
        self.assertIn("balconies projecting", a["proposed"])
        self.assertNotIn("Notice of", a["proposed"])

    def test_documents_are_linked_and_unread(self):
        a = pa.parse_application(read("callaway-465.html"), "https://london.ca/x/465-callaway-road")
        self.assertEqual(len(a["documents"]), 3)
        notice = a["documents"][0]
        self.assertEqual(notice["category"], "notice")
        self.assertEqual(notice["label_date"], "2026-11-12")
        self.assertEqual(notice["kind"], "pdf")
        self.assertTrue(notice["url"].startswith("https://london.ca/sites/default/files/"))
        self.assertTrue(all(d["read"] is False for d in a["documents"]))

    def test_status_is_the_printed_lines_only(self):
        a = pa.parse_application(read("colonel-talbot-3680.html"), "https://london.ca/x/colonel")
        self.assertEqual(a["file_number"], "OZ-26096")
        self.assertEqual(a["status"]["council_decision"], ["Council Resolution – not available at this time"])
        self.assertEqual(a["status"]["staff_report"], ["Report to Planning and Environment Committee – September 29, 2026"])
        self.assertEqual([d["label_date"] for d in a["documents"] if d["category"] == "notice"], ["2026-09-29", "2027-01-26"])
        escribe = [d for d in a["documents"] if d["kind"] == "escribe"]
        self.assertEqual(len(escribe), 1)

    def test_missing_fields_are_null_not_invented(self):
        a = pa.parse_application("<html><body><main><h2>What is proposed?</h2></main></body></html>", "https://london.ca/x/empty")
        self.assertIsNone(a["title"])
        for f in ("file_number", "application_type", "applicant", "date_received", "last_modified", "proposed", "status"):
            self.assertIsNone(a[f], f)
        self.assertEqual(a["contacts"], [])
        self.assertEqual(a["documents"], [])

    def test_printed_date(self):
        self.assertEqual(pa.parse_printed_date("Notice - January 26, 2027"), "2027-01-26")
        self.assertIsNone(pa.parse_printed_date("not available at this time"))
        self.assertIsNone(pa.parse_printed_date("February 30, 2027"))


class Fetching(unittest.TestCase):
    def fetcher(self, session, tmp, **kw):
        return pa.PoliteFetcher(cache_dir=tmp, min_interval=0, session=session, **kw)

    def test_user_agent_set_and_cache_hit(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = FakeSession({"https://london.ca/a": "<html>a</html>"})
            f = self.fetcher(s, tmp)
            self.assertEqual(f.get("https://london.ca/a"), "<html>a</html>")
            self.assertEqual(f.get("https://london.ca/a"), "<html>a</html>")
            self.assertEqual(len(s.calls), 1)
            self.assertEqual((f.network_requests, f.cache_hits), (1, 1))
            self.assertIn("OpenCouncil", s.headers["User-Agent"])

    def test_cache_expires(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = FakeSession({"https://london.ca/a": "<html>a</html>"})
            f = self.fetcher(s, tmp, max_age_hours=24)
            f.get("https://london.ca/a")
            path = f._path("https://london.ca/a")
            old = path.stat().st_mtime - 25 * 3600
            os.utime(path, (old, old))
            f.get("https://london.ca/a")
            self.assertEqual(len(s.calls), 2)
            self.assertEqual(f.cache_expired, 1)

    def test_zero_max_age_always_refetches(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = FakeSession({"https://london.ca/a": "<html>a</html>"})
            f = self.fetcher(s, tmp, max_age_hours=0)
            f.get("https://london.ca/a")
            f.get("https://london.ca/a")
            self.assertEqual(len(s.calls), 2)

    def test_min_interval_is_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = FakeSession({"https://london.ca/a": "a", "https://london.ca/b": "b"})
            f = pa.PoliteFetcher(cache_dir=tmp, min_interval=1.0, session=s)
            with mock.patch.object(pa.time, "sleep") as sleep:
                f.get("https://london.ca/a")
                f.get("https://london.ca/b")
            self.assertTrue(sleep.called)
            self.assertLessEqual(sleep.call_args[0][0], 1.0)

    def test_403_and_challenge_pages_are_blocked_not_retried_or_cached(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = FakeSession(
                {
                    "https://london.ca/forbidden": response("no", 403),
                    "https://london.ca/challenge": response("<html><title>Just a moment...</title></html>"),
                }
            )
            f = self.fetcher(s, tmp)
            with self.assertRaises(pa.Blocked) as ctx:
                f.get("https://london.ca/forbidden")
            self.assertEqual(ctx.exception.reason, "HTTP 403")
            with self.assertRaises(pa.Blocked) as ctx:
                f.get("https://london.ca/challenge")
            self.assertEqual(ctx.exception.reason, "browser check page")
            self.assertEqual(len(s.calls), 2)
            self.assertFalse(list(Path(tmp).iterdir()))


class Scrape(unittest.TestCase):
    L = pa.LISTING_URL

    def pages(self):
        listing = read("listing-page-2.html")
        urls, _ = pa.parse_listing(listing)
        pages = {self.L: listing, self.L + "?page=1": "<html><main></main></html>"}
        pages[urls[0]] = read("callaway-465.html")
        pages[urls[1]] = read("colonel-talbot-3680.html")
        pages[urls[2]] = response("blocked", 403)
        return pages, urls

    def test_scrape_records_blocked_and_continues(self):
        pages, urls = self.pages()
        with tempfile.TemporaryDirectory() as tmp:
            s = FakeSession(pages)
            f = pa.PoliteFetcher(cache_dir=tmp, min_interval=0, session=s)
            snap = pa.scrape(f, max_pages=2, limit=4, log=lambda *_: None)
        self.assertEqual(snap["applications_listed"], 4)
        ok, nulls = pa.null_counts(snap)
        self.assertEqual(ok, 2)  # two parsed, one blocked, one 404 -> 'blocked'
        self.assertEqual(len(snap["blocked"]), 2)
        self.assertEqual(snap["blocked"][0]["reason"], "HTTP 403")
        self.assertEqual(nulls["file_number"], 0)
        self.assertTrue(all(a["fetch"].startswith("blocked") for a in snap["applications"][2:]))

    def test_dry_run_writes_nothing(self):
        pages, _ = self.pages()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out"
            real = pa.PoliteFetcher
            with mock.patch.object(pa, "OUTPUT_DIR", out), \
                    mock.patch.object(pa, "PoliteFetcher", lambda **kw: real(cache_dir=tmp, min_interval=0, session=FakeSession(pages), **kw)):
                rc = pa.main(["scrape", "--dry-run", "--max-pages", "1", "--limit", "2"])
                self.assertEqual(rc, 0)
                self.assertFalse(out.exists())
                pa.main(["scrape", "--max-pages", "1", "--limit", "2"])
                self.assertEqual(len(list(out.glob("*.json"))), 1)


class Diff(unittest.TestCase):
    """The diff is proved on fixture snapshots: only one real snapshot exists so far."""

    def snapshot_a(self):
        apps = [
            pa.parse_application(read("callaway-465.html"), "https://london.ca/x/465-callaway-road"),
            pa.parse_application(read("colonel-talbot-3680.html"), "https://london.ca/x/3680-colonel"),
            {"url": "https://london.ca/x/gone-1", "slug": "gone-1", "title": "1 Gone Street", "file_number": "Z-1", "fetch": "ok",
             "documents": [], "status": None},
        ]
        return {"scraped_at": "2026-11-25T08:00:00", "applications": apps, "blocked": []}

    def snapshot_b(self):
        b = copy.deepcopy(self.snapshot_a())
        b["scraped_at"] = "2026-12-02T08:00:00"
        callaway = b["applications"][0]
        callaway["status"]["staff_report"] = ["Report to Planning and Environment Committee – December 15, 2026"]
        callaway["documents"].append(
            {"section": "Staff Planning Reports", "category": "staff_report", "label": "Report to Planning and Environment Committee – December 15, 2026",
             "url": "https://pub-london.escribemeetings.com/Meeting.aspx?Id=fixture", "kind": "escribe", "label_date": "2026-12-15", "read": False}
        )
        b["applications"].pop(2)  # removed
        b["applications"].append(
            {"url": "https://london.ca/x/new-1", "slug": "new-1", "title": "2 New Street", "file_number": "OZ-9", "fetch": "ok",
             "documents": [], "status": None}
        )
        return b

    def test_new_removed_status_and_documents(self):
        d = pa.diff_snapshots(self.snapshot_a(), self.snapshot_b())
        self.assertEqual([x["title"] for x in d["new_files"]], ["2 New Street"])
        self.assertEqual([x["title"] for x in d["removed_files"]], ["1 Gone Street"])
        self.assertEqual([x["title"] for x in d["status_changes"]], ["465 Callaway Road"])
        self.assertIn("December 15, 2026", d["status_changes"][0]["to"]["staff_report"][0])
        self.assertEqual(len(d["new_documents"]), 1)
        self.assertEqual(d["new_documents"][0]["document"]["kind"], "escribe")
        self.assertEqual(d["field_changes"], [])

    def test_identical_snapshots_have_no_changes(self):
        d = pa.diff_snapshots(self.snapshot_a(), self.snapshot_a())
        for k in ("new_files", "removed_files", "status_changes", "new_documents", "field_changes"):
            self.assertEqual(d[k], [], k)

    def test_blocked_page_is_not_reported_as_removed_or_changed(self):
        a, b = self.snapshot_a(), self.snapshot_b()
        a["applications"].append({"url": "https://london.ca/x/flaky", "slug": "flaky", "title": "9 Flaky Road", "file_number": "Z-9",
                                  "fetch": "ok", "documents": [], "status": None})
        b["applications"].append({"url": "https://london.ca/x/flaky", "slug": "flaky", "fetch": "blocked: HTTP 403"})
        b["blocked"] = [{"url": "https://london.ca/x/flaky", "kind": "application", "reason": "HTTP 403"}]
        d = pa.diff_snapshots(a, b)
        self.assertNotIn("9 Flaky Road", [x["title"] for x in d["removed_files"] + d["status_changes"]])
        self.assertEqual(d["skipped_blocked"], ["https://london.ca/x/flaky"])

    def test_cli_diff_text_and_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            pa_, pb_ = Path(tmp) / "a.json", Path(tmp) / "b.json"
            pa_.write_text(json.dumps(self.snapshot_a()))
            pb_.write_text(json.dumps(self.snapshot_b()))
            with mock.patch("builtins.print") as p:
                pa.main(["diff", str(pa_), str(pb_)])
            text = p.call_args[0][0]
            self.assertIn("new files: 1", text)
            self.assertIn("removed files: 1", text)
            with mock.patch("builtins.print") as p:
                pa.main(["diff", str(pa_), str(pb_), "--json"])
            self.assertEqual(json.loads(p.call_args[0][0])["new_files"][0]["file_number"], "OZ-9")


if __name__ == "__main__":
    unittest.main()
