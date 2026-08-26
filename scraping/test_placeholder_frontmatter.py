#!/usr/bin/env python3
"""
Regression test for Bug 2 (duplicate placeholder pages).

create_basic_markdown() must tag genuine placeholder pages (meetings whose
official minutes aren't published yet) with `placeholder: true` in the
markdown frontmatter, so scripts/generate-pages.ts can reliably dedupe a
stale placeholder against its real, minutes-published sibling once the
minutes come out - without relying solely on matching page-body text.

Transcript-only pages (real content, just not yet backed by official
minutes) must NOT be tagged as placeholders - they are legitimate content,
not stubs to be superseded/dropped.

Run: cd scraping && uv run python3 test_placeholder_frontmatter.py
"""

import sys
import shutil
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import process_meeting
from process_meeting import create_basic_markdown


def main() -> bool:
    ok = True

    # create_basic_markdown resolves its output directory as
    # Path(__file__).parent.parent / 'content' / 'months' / ..., where
    # __file__ is process_meeting.py's own module-global. Point that at a
    # throwaway directory for the duration of this test so we never touch
    # the real repo's content/ or data/ directories.
    tmp_repo = Path(tempfile.mkdtemp())
    real_file = process_meeting.__file__
    process_meeting.__file__ = str(tmp_repo / "scraping" / "process_meeting.py")

    try:
        data_dir = tmp_repo / "data" / "2026-07"
        data_dir.mkdir(parents=True)

        # Case 1: genuine placeholder (mirrors create_placeholder_meeting's dict shape)
        placeholder_data = {
            "meeting_type": "Council",
            "datetime": "2026-07-21",
            "title": "2026-07-21 - Council",
            "url": "https://pub-london.escribemeetings.com/example",
            "present": [],
            "absent": [],
            "items": [],
            "placeholder": True,
            "note": "Minutes not yet published - placeholder created for transcript sync",
        }
        json_path = data_dir / "2026-07-21 - Council.json"
        create_basic_markdown(placeholder_data, json_path)
        md_path = tmp_repo / "content" / "months" / "2026-07" / "2026-07-21 - Council.md"
        md = md_path.read_text()

        if "placeholder: true" in md:
            print("PASS: genuine placeholder page is tagged `placeholder: true` in frontmatter")
        else:
            print("FAIL: genuine placeholder page is missing `placeholder: true` frontmatter")
            print(md)
            ok = False

        if "Official minutes have not been published yet" in md:
            print("PASS: placeholder page still carries the body marker text (retroactive-detection fallback stays valid)")
        else:
            print("FAIL: placeholder page lost its body marker text")
            ok = False

        # Case 2: transcript-only page (real content) must NOT be tagged as a placeholder
        transcript_data = {
            "meeting_type": "Council",
            "datetime": "2026-07-22",
            "title": "2026-07-22 - Council",
            "url": "https://pub-london.escribemeetings.com/example2",
            "items": [],
            "transcript": "Some transcript text about the meeting.",
            "transcript_duration": "45 min",
        }
        json_path2 = data_dir / "2026-07-22 - Council.json"
        create_basic_markdown(transcript_data, json_path2)
        md_path2 = tmp_repo / "content" / "months" / "2026-07" / "2026-07-22 - Council.md"
        md2 = md_path2.read_text()

        if "placeholder: true" not in md2:
            print("PASS: transcript-only (real content) page is NOT tagged as a placeholder")
        else:
            print("FAIL: transcript-only page was incorrectly tagged `placeholder: true`")
            ok = False

        return ok
    finally:
        process_meeting.__file__ = real_file
        shutil.rmtree(tmp_repo, ignore_errors=True)


if __name__ == "__main__":
    passed = main()
    if passed:
        print("\n✅ All placeholder-frontmatter tests passed")
        sys.exit(0)
    else:
        print("\n❌ Some placeholder-frontmatter tests FAILED")
        sys.exit(1)
