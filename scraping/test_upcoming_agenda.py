"""Offline tests for upcoming_agenda.py. They read saved fixtures and never touch the network."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import upcoming_agenda as ua

FIX = Path(__file__).parent / "test_samples" / "upcoming"


def read(name):
    return (FIX / name).read_text(encoding="utf-8")


class FakeSession:
    def __init__(self, calendar):
        self.headers = {}
        self.calls = []
        self.calendar = calendar
        self.pages = []  # scripted (text, status) answers for GET, used in order

    def post(self, url, json=None, timeout=None):
        self.calls.append(("POST", url))
        return mock.Mock(text=self.calendar, status_code=200, raise_for_status=lambda: None)

    def get(self, url, timeout=None):
        self.calls.append(("GET", url))
        text, status = self.pages.pop(0) if self.pages else ("<html></html>", 200)
        return mock.Mock(text=text, status_code=status, raise_for_status=lambda: None)


class AgendaParsing(unittest.TestCase):
    def test_cacp_items_dates_and_documents(self):
        p = ua.parse_agenda(read("cacp-2026-11-19-merged.html"), "https://x/agenda")
        self.assertEqual(p["meeting"]["start"], "2026-11-19T12:00:00")
        self.assertIn("Community Advisory Committee on Planning", p["meeting"]["heading"])
        by_number = {i["item_number"]: i for i in p["items"]}
        item = by_number["3.4"]
        self.assertIn("1579-1589 Fanshawe Park Road East", item["addresses"])
        self.assertEqual(len(item["documents"]), 2)
        self.assertTrue(all(d["is_pdf"] and d["read"] is False for d in item["documents"]))
        self.assertTrue(item["documents"][0]["url"].startswith(ua.BASE_URL))

    def test_conservative_extraction_leaves_nulls_empty(self):
        p = ua.parse_agenda(read("council-2026-11-24-agenda.html"))
        self.assertGreater(len(p["items"]), 3)
        for item in p["items"]:
            self.assertIsInstance(item["addresses"], list)
            self.assertIsInstance(item["file_numbers"], list)

    def test_every_fixture_parses_with_items(self):
        for name in ("cacp-2026-11-19-merged.html", "council-2026-11-24-agenda.html", "esacac-2026-11-26-agenda.html"):
            with self.subTest(name=name):
                p = ua.parse_agenda(read(name))
                self.assertTrue(p["items"])
                self.assertIsNotNone(p["meeting"]["start"])

    def test_missing_pieces_are_null_not_invented(self):
        p = ua.parse_agenda("<html><body><p>nothing here</p></body></html>")
        self.assertEqual(p["items"], [])
        self.assertIsNone(p["meeting"]["start"])
        self.assertIsNone(p["meeting"]["heading"])
        self.assertIn("no agenda items found", p["parse_failures"])

    def test_item_without_number_is_flagged_with_null(self):
        html = '<div class="AgendaItemContainer"><div class="AgendaItem"><div class="AgendaItemTitle">Hello</div></div></div>'
        p = ua.parse_agenda(html)
        self.assertIsNone(p["items"][0]["item_number"])
        self.assertTrue(any("no item number" in f for f in p["parse_failures"]))


class Regexes(unittest.TestCase):
    def test_addresses(self):
        self.assertEqual(ua.find_addresses("Notice - 465 Callaway Road"), ["465 Callaway Road"])
        self.assertEqual(ua.find_addresses("at 183 King Street today"), ["183 King Street"])
        self.assertEqual(ua.find_addresses("Boler Road and Sanitorium Road Widening"), [])
        self.assertEqual(ua.find_addresses("Item 5.3 for 2026"), [])

    def test_review_repro_false_positives(self):
        self.assertEqual(ua.find_addresses("Phase 2 Wonderland Road Widening"), [])
        self.assertEqual(ua.find_addresses("4.2 Richmond Row Patio Program"), [])
        self.assertEqual(ua.find_addresses("2024 Thames Valley Parkway Extension"), [])
        self.assertEqual(ua.find_addresses("Report of the 2026 Budget Committee Place Holder"), [])

    def test_address_lists_give_every_number(self):
        self.assertEqual(ua.find_addresses("123, 125 and 127 Main Street"),
                         ["123 Main Street", "125 Main Street", "127 Main Street"])
        self.assertEqual(ua.find_addresses("3680 and 3700 Colonel Talbot Road"),
                         ["3680 Colonel Talbot Road", "3700 Colonel Talbot Road"])
        self.assertEqual(ua.find_addresses("1 and 3 Front Street"), ["1 Front Street", "3 Front Street"])

    def test_adversarial_addresses(self):
        cases = {
            "Item 3 Dundas Street Patio Program": [],
            "Part 4 Queens Avenue Study": [],
            "Bill 23 Wonderland Road Review": [],
            "Schedule 3 Adelaide Street Changes": [],
            "$1,200 Oxford Street Fund": [],
            "1,200 Oxford Street Closures": [],
            "2026-11-19 Notice - 465 Callaway Road": ["465 Callaway Road"],
            "Zoning 15-20 Wellington Road": ["15-20 Wellington Road"],
            "1 Richmond Row and 2 Dundas Street": ["1 Richmond Row", "2 Dundas Street"],
            "1950 Hyde Park Road Notice": ["1950 Hyde Park Road"],
            "365 St James Street / 365 St. James Street": ["365 St James Street"],
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(ua.find_addresses(text), expected)

    def test_file_numbers(self):
        self.assertEqual(ua.find_file_numbers("draft plan 39T-23505 and OZ-9123"), ["39T-23505", "OZ-9123"])
        self.assertEqual(ua.find_file_numbers("2026-11-19 Notice"), [])


class CalendarParsing(unittest.TestCase):
    def test_calendar_fixture(self):
        meetings = ua.parse_calendar(json.loads(read("calendar-2026-11-25.json"))["d"])
        self.assertEqual(len(meetings), 1)
        m = meetings[0]
        self.assertEqual(m["start"], "2026-11-26T16:00:00")
        self.assertTrue(m["agenda_url"].startswith(ua.BASE_URL + "Meeting.aspx?Id="))
        self.assertTrue(m["agenda_pdf_url"].startswith(ua.BASE_URL + "FileStream.ashx"))


    def test_merged_agenda_link_is_used(self):
        raw = [{"ID": "x", "MeetingName": "Council", "StartDate": "2026/11/17 18:00:00", "HasAgenda": True,
                "MeetingDocumentLink": [
                    {"Type": "Merged", "Format": "HTML", "Url": "/Meeting.aspx?Id=x&Agenda=Merged&lang=English"},
                    {"Type": "PostMinutes", "Format": "HTML", "Url": "/Meeting.aspx?Id=x&Agenda=PostMinutes"}]}]
        m = ua.parse_calendar(raw)[0]
        self.assertIn("Agenda=Merged", m["agenda_url"])
        self.assertNotIn("PostMinutes", m["agenda_url"])


AGENDA_OK = read("esacac-2026-11-26-agenda.html")
BROWSER_CHECK = "<html><body>" + "Checking your browser before accessing the site. " * 20 + "</body></html>"


def make_fetcher(tmp, session, **kw):
    return ua.PoliteFetcher(cache_dir=tmp, min_interval=0, session=session, **kw)


class CacheRules(unittest.TestCase):
    URL = ua.BASE_URL + "Meeting.aspx?Id=1"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.addCleanup(self._tmp.cleanup)
        self.session = FakeSession("{}")

    def _age(self, seconds):
        for p in Path(self.tmp).iterdir():
            old = p.stat().st_mtime - seconds
            os.utime(p, (old, old))

    def test_second_run_refetches_after_expiry(self):
        self.session.pages = [(AGENDA_OK, 200), (AGENDA_OK, 200)]
        make_fetcher(self.tmp, self.session, ttl_seconds=3600).get(self.URL, cache_ok=ua.looks_like_agenda)
        fresh = make_fetcher(self.tmp, self.session, ttl_seconds=3600)
        fresh.get(self.URL, cache_ok=ua.looks_like_agenda)
        self.assertEqual((fresh.network_requests, fresh.cache_hits), (0, 1))
        self._age(7200)
        later = make_fetcher(self.tmp, self.session, ttl_seconds=3600)
        later.get(self.URL, cache_ok=ua.looks_like_agenda)
        self.assertEqual((later.network_requests, later.cache_hits), (1, 0))
        self.assertEqual(len(self.session.calls), 2)

    def test_bad_pages_are_never_cached(self):
        bad = [("", 200), ("<html>hi</html>", 200), (BROWSER_CHECK, 200), (AGENDA_OK, 202)]
        for text, status in bad:
            with self.subTest(status=status, size=len(text)):
                self.session.pages = [(text, status), (AGENDA_OK, 200)]
                f1 = make_fetcher(self.tmp, self.session)
                f1.get(self.URL, cache_ok=ua.looks_like_agenda)
                f2 = make_fetcher(self.tmp, self.session)
                got = f2.get(self.URL, cache_ok=ua.looks_like_agenda)
                self.assertEqual(f2.network_requests, 1, "second run must refetch after a bad page")
                self.assertEqual(got, AGENDA_OK)
                for p in Path(self.tmp).iterdir():
                    p.unlink()

    def test_error_status_raises_and_leaves_no_cache(self):
        self.session.pages = [("Service down" * 50, 503)]
        resp_bad = mock.Mock(text="x", status_code=503)
        resp_bad.raise_for_status.side_effect = ua.requests.HTTPError("503")
        with mock.patch.object(self.session, "get", return_value=resp_bad):
            with self.assertRaises(ua.requests.RequestException):
                make_fetcher(self.tmp, self.session).get(self.URL)
        self.assertEqual(list(Path(self.tmp).iterdir()), [])

    def test_dry_run_writes_no_cache(self):
        self.session.pages = [(AGENDA_OK, 200)]
        make_fetcher(self.tmp, self.session, write_cache=False).get(self.URL, cache_ok=ua.looks_like_agenda)
        self.assertEqual(list(Path(self.tmp).iterdir()), [])


class HostAllowlist(unittest.TestCase):
    def test_offsite_link_is_skipped_and_logged(self):
        raw = [{"ID": "x", "MeetingName": "Council", "StartDate": "2026/11/17 18:00:00", "HasAgenda": True,
                "MeetingDocumentLink": [{"Type": "Agenda", "Format": "HTML", "Url": "https://evil.example/agenda"}]}]
        calendar = json.dumps({"d": raw})
        with tempfile.TemporaryDirectory() as tmp:
            session = FakeSession(calendar)
            f = make_fetcher(tmp, session)
            with self.assertLogs("upcoming_agenda", level="WARNING") as logs:
                results = ua.scrape(f, ua.date(2026, 11, 17), ua.date(2026, 11, 18))
        self.assertEqual(results[0]["status"], "agenda_link_offsite")
        self.assertEqual([c[0] for c in session.calls], ["POST"], "no GET to the off-list host")
        self.assertTrue(any("evil.example" in line for line in logs.output))

    def test_fetcher_refuses_offsite_host_directly(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = FakeSession("{}")
            with self.assertRaises(ua.OffsiteURLError):
                make_fetcher(tmp, session).get("https://evil.example/agenda")
            self.assertEqual(session.calls, [])

    def test_onsite_link_still_works(self):
        raw = [{"ID": "x", "MeetingName": "Council", "StartDate": "2026/11/17 18:00:00", "HasAgenda": True,
                "MeetingDocumentLink": [{"Type": "Agenda", "Format": "HTML", "Url": "/Meeting.aspx?Id=x"}]}]
        self.assertTrue(ua.parse_calendar(raw)[0]["agenda_url"].startswith(ua.BASE_URL))


class FixturePrivacy(unittest.TestCase):
    def test_no_real_delegate_names_left(self):
        real = ["Roth", "Fremeth", "Filer", "Rowland", "Rishchynski", "Rybak", "Greguol", "Gorodzinsky", "Hannam", "Bilmes"]
        for f in FIX.iterdir():
            text = f.read_text(encoding="utf-8")
            for name in real:
                self.assertNotIn(name, text, f"{name} still in {f.name}")


class PoliteFetching(unittest.TestCase):
    def test_cache_user_agent_and_rate_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = FakeSession(read("calendar-2026-11-25.json"))
            f = ua.PoliteFetcher(cache_dir=tmp, min_interval=0.2, session=session)
            self.assertIn("OpenCouncil", session.headers["User-Agent"])
            session.pages = [(AGENDA_OK, 200), (AGENDA_OK, 200)]
            first = f.get(ua.BASE_URL + "a")
            second = f.get(ua.BASE_URL + "a")
            self.assertEqual(first, second)
            self.assertEqual(f.network_requests, 1)
            self.assertEqual(f.cache_hits, 1)
            with mock.patch.object(ua.time, "sleep") as sleep:
                f.get(ua.BASE_URL + "b")
                self.assertTrue(sleep.called)

    def test_scrape_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            calendar = json.loads(read("calendar-2026-11-25.json"))
            session = FakeSession(json.dumps(calendar))
            f = ua.PoliteFetcher(cache_dir=tmp, min_interval=0, session=session)
            agenda_url = ua.parse_calendar(calendar["d"])[0]["agenda_url"]
            # pre-seed the cache with the saved agenda page so no agenda request is made
            path = Path(tmp) / f._key("GET", agenda_url, None)
            path.write_text(read("esacac-2026-11-26-agenda.html"), encoding="utf-8")
            results = ua.scrape(f, ua.date(2026, 11, 25), ua.date(2026, 12, 25))
            self.assertEqual(results[0]["status"], "parsed")
            self.assertEqual([c[0] for c in session.calls], ["POST"])


if __name__ == "__main__":
    unittest.main()
