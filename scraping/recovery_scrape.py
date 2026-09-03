"""
Recovery scrape driver for issue #199 / pre2018-ingestion.

Re-scrapes the ~150 pre-2018 (2011-2017) Council meetings enumerated in
recovery_checkpoint/manifest.json against the FIXED WordMeeting.py parser
(d2/d5 fixes + guardrail a: scrape-time YEAS-count coverage assertion).

Resume-safe: manifest status is checkpointed to disk after every meeting, so
a killed/interrupted run can just be re-invoked and will skip anything
already marked "done" or "failed" (failures are terminal for this run - if
you want to retry a failed meeting, reset its status to "pending" by hand).

Sequential, ~1 request/sec against eSCRIBE (see RATE_LIMIT_SECONDS).

Usage:
  uv run recovery_scrape.py            # process all pending
  uv run recovery_scrape.py --limit 5  # process at most 5 (smoke test)
"""

import io
import re
import sys
import json
import time
import argparse
import traceback
import contextlib
from pathlib import Path
from datetime import datetime

sys.path.insert(0, ".")
from process_meeting import process_meeting

MANIFEST_PATH = Path("recovery_checkpoint/manifest.json")
RATE_LIMIT_SECONDS = 1.0
REPO_ROOT = Path("..")


def cleanup_stale_pair(old_local_path: str, new_result_path: str):
    """
    process_meeting names its output files from the freshly-parsed
    meeting.format_title(), which can legitimately differ from whatever
    filename an earlier scrape produced for the same (date, meeting_type)
    - e.g. a stale scrape that stored a mangled title (observed: an
    unnormalized embedded newline from Word's line-wrapped export landing
    straight in a filename, "...13TH\\n  MEETING.json"). Left in place,
    that orphaned old file plus the new correctly-named one would double
    the meeting in every data/*.json scan (generate-votes.ts included).

    Deletes the old data/ and content/months/ files whenever the new
    result path differs from the old one.

    The content/months/*.md counterpart is located by globbing on the
    yyyy-mm-dd date prefix and then matching on the WHITESPACE-NORMALIZED
    title, not just the date prefix: observed pairs from old scraper runs
    can have DIFFERENT mangled whitespace between the .json and .md titles
    for the same meeting (e.g. a literal embedded newline in the json
    filename vs a collapsed double space in the md filename), so a naive
    .json -> .md path swap can miss the actual stale md file on disk - but
    matching on date prefix ALONE is unsafe: other meeting types held on
    the same calendar date (e.g. a same-day committee meeting) share that
    prefix and must NOT be touched. Confirmed by an incident during the
    issue #199 recovery scrape: an early version of this function matched
    on date-prefix alone and deleted 11 unrelated sibling committee .md
    files across 8 dates (their data/*.json was untouched, so they were
    recovered with a plain `git checkout --`, but the bug is fixed here so
    it can't happen again on a future rerun).
    """
    new_json_rel = f"data/{new_result_path}.json"
    if old_local_path == new_json_rel:
        return None  # same filename, process_meeting already overwrote it in place

    removed = []

    old_json = REPO_ROOT / old_local_path
    if old_json.exists():
        old_json.unlink()
        removed.append(str(old_json))

    def normalized_title(filename: str) -> str:
        # strip extension, collapse all whitespace runs (incl. embedded
        # newlines) to a single space, for comparing mangled titles
        stem = re.sub(r"\.(json|md)$", "", filename)
        return re.sub(r"\s+", " ", stem).strip()

    yyyy_mm = Path(old_local_path).parent.name  # data/2014-05 -> 2014-05
    old_json_title = normalized_title(Path(old_local_path).name)
    new_md_name = f"{new_result_path.split('/', 1)[1]}.md"
    md_dir = REPO_ROOT / "content" / "months" / yyyy_mm
    if md_dir.exists():
        for p in md_dir.iterdir():
            if p.name == new_md_name:
                continue
            if normalized_title(p.name) == old_json_title:
                p.unlink()
                removed.append(str(p))

    return {"old_path": old_local_path, "new_path": new_json_rel, "removed": removed}


def load_manifest():
    return json.loads(MANIFEST_PATH.read_text())


def save_manifest(manifest):
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--date", type=str, default=None,
                         help="process only this single YYYY-MM-DD date, "
                              "regardless of its current status (for smoke "
                              "tests / manual retries)")
    args = parser.parse_args()

    manifest = load_manifest()
    if args.date:
        pending = [m for m in manifest if m["date"] == args.date]
    else:
        pending = [m for m in manifest if m["status"] == "pending"]
    if args.limit:
        pending = pending[: args.limit]

    print(f"{len(pending)} pending meeting(s) to (re)scrape "
          f"(of {len(manifest)} total in manifest)")

    done_count = sum(1 for m in manifest if m["status"] == "done")
    failed_count = sum(1 for m in manifest if m["status"] == "failed")
    print(f"Already done: {done_count}, already failed: {failed_count}")

    for i, entry in enumerate(pending):
        date_str = entry["date"]
        meeting_type = entry["meeting_type"]
        print(f"\n[{i+1}/{len(pending)}] {meeting_type} {date_str} ...")

        target_date = datetime.strptime(date_str, "%Y-%m-%d")

        # process_meeting swallows exceptions internally (including the
        # guardrail-a ValueError) and just prints them - capture stdout so
        # we can pull the real reason into the manifest/report instead of
        # just "returned None".
        captured = io.StringIO()
        try:
            with contextlib.redirect_stdout(captured):
                result_path = process_meeting(meeting_type, target_date)
        except Exception as e:  # belt and braces - process_meeting already
            # catches internally, but don't let a driver-level bug abort
            # the whole resumable run
            result_path = None
            entry["error"] = f"driver-level exception: {e}"
            traceback.print_exc()
        output_text = captured.getvalue()
        print(output_text, end="")

        if result_path:
            cleanup = cleanup_stale_pair(entry["local_path"], result_path)
            entry["status"] = "done"
            entry["result_path"] = result_path
            entry["local_path"] = f"data/{result_path}.json"
            entry.pop("error", None)
            if cleanup:
                entry["renamed_from"] = cleanup
                print(f"  -> renamed on rescrape: {cleanup['old_path']} -> "
                      f"{cleanup['new_path']} (removed stale: {cleanup['removed']})")
            print(f"  -> OK: {result_path}")
        else:
            entry["status"] = "failed"
            if "error" not in entry:
                # pull the "Error processing meeting ..." line out of the
                # captured output for a concise reason
                reason_lines = [l for l in output_text.splitlines() if "Error processing meeting" in l]
                entry["error"] = reason_lines[-1] if reason_lines else "process_meeting returned None"
            print(f"  -> FAILED: {entry.get('error')}")

        save_manifest(manifest)

        if i < len(pending) - 1:
            time.sleep(RATE_LIMIT_SECONDS)

    done_count = sum(1 for m in manifest if m["status"] == "done")
    failed_count = sum(1 for m in manifest if m["status"] == "failed")
    pending_count = sum(1 for m in manifest if m["status"] == "pending")
    print(f"\n=== Recovery scrape summary ===")
    print(f"done: {done_count}, failed: {failed_count}, still pending: {pending_count}")
    if failed_count:
        print("\nFailed meetings:")
        for m in manifest:
            if m["status"] == "failed":
                print(f"  - {m['meeting_type']} {m['date']}: {m.get('error')}")


if __name__ == "__main__":
    main()
