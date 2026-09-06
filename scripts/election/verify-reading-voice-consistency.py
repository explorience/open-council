#!/usr/bin/env python3
"""
Gate round 5 nit (3): voice-consistency check for batch-26's reading-stage
whatAYeaDid rows (post corrections.json merge — see lib_corrections.
load_merged), scoped exactly to the nit as specified. The established
corpus voice is "Gave {first|second} reading to the by-law ..." / "Gave
third reading and enacted the by-law ..." (capital-G lead verb); batch-26
had six rows in the outlier lowercase voice "supported the
{second|third} reading (and enactment) of ..." before this round's
corrections.json fix. This is a DIFFERENT defect class than
scripts/election/sweep-reading-stage-labels.py (which checks whether the
STAGE WORD itself is correct — enact-before-third-reading, doubled
"Reading", stage-less prose, etc.) — this script checks only the
lead-in verb/capitalization voice.

SCOPE NOTE (found, not fixed, this round): the same "Supported the third
reading and enactment of Bill No. N" outlier shape (capital S — a distinct
string from batch-26's lowercase "supported the ... reading of ...") also
appears on 19 rows in batch-27 and batch-31, an omnibus-bill-reading
convention that spans MANY ids across those batches. The round-5 nit (3)
mandate is explicitly "normalize batch-26's reading rows" — fixing those
19 rows would be a different, much larger, unrequested cleanup (likely its
own batch-27/batch-31 voice-convention question, not obviously a defect at
all — it may be deliberate for omnibus multi-bill readings). Left
untouched; this check is scoped to batch-26 only so it does not silently
expand its own mandate. Flagged for a future round's disposition.

Usage: python3 scripts/election/verify-reading-voice-consistency.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

OUTLIER_RE = re.compile(r"^supported the (second|third) reading\b", re.IGNORECASE)
ESTABLISHED_RE = re.compile(
    r"^Gave (first|second) reading to\b|^Gave third reading and enacted\b"
)
BATCH_26_PATH = lc.CLASSIFY_DIR / "batch-26-verified.json"


def main() -> int:
    entries, _ = lc.load_merged()
    batch_26_ids = {e["id"] for e in json.loads(BATCH_26_PATH.read_text())}

    outliers = []
    established = 0
    for mid in batch_26_ids:
        e = entries.get(mid)
        if e is None:
            continue
        text = e.get("whatAYeaDid", "")
        if OUTLIER_RE.search(text):
            outliers.append((mid, text))
        elif ESTABLISHED_RE.search(text):
            established += 1

    print(f"batch-26 rows in the established 'Gave ... reading' voice: {established}")
    print(f"batch-26 rows in the outlier 'supported the ... reading' voice: {len(outliers)}")
    if outliers:
        print("\nFAILED — outlier voice rows found in batch-26:")
        for mid, text in outliers:
            print(f" - {mid}: {text}")
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
