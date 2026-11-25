"""Offline tests for upcoming_agenda.py. They read saved fixtures and never touch the network."""

import json
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

    def post(self, url, json=None, timeout=None):
        self.calls.append(("POST", url))
        return mock.Mock(text=self.calendar, raise_for_status=lambda: None)

    def get(self, url, timeout=None):
        self.calls.append(("GET", url))
        return mock.Mock(text="<html></html>", raise_for_status=lambda: None)


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


class PoliteFetching(unittest.TestCase):
    def test_cache_user_agent_and_rate_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = FakeSession(read("calendar-2026-11-25.json"))
            f = ua.PoliteFetcher(cache_dir=tmp, min_interval=0.2, session=session)
            self.assertIn("OpenCouncil", session.headers["User-Agent"])
            first = f.get("https://example.test/a")
            second = f.get("https://example.test/a")
            self.assertEqual(first, second)
            self.assertEqual(f.network_requests, 1)
            self.assertEqual(f.cache_hits, 1)
            with mock.patch.object(ua.time, "sleep") as sleep:
                f.get("https://example.test/b")
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
