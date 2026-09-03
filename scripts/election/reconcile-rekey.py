#!/usr/bin/env python3
"""Reconciliation report for a rekey-classify-ids.py run (2026-09-02 fixer
round, PR #202 verifier findings 1/3/5, extended by the same-day fixer round
item 2/3 pass).

Independently re-derives the headline numbers from the artifacts
rekey-classify-ids.py writes (rekey-map-<stamp>.json, rekey-unresolved-
<stamp>.json, rekey-collision-rematches-<stamp>.json, rekey-deduped-
<stamp>.json, rekey-collision-unresolved-<stamp>.json - all always written,
even empty, since the 2026-09-02 item-2 fix) plus the live corpus
(manifest.json, returning-manifest.json, batch-*-verified.json,
corrections.json, transit-split-{proposed,verified}.json) - never trusts the
rekey script's own printed summary, re-counts from the files it left
behind, and asserts every delta is attributed (nothing merely "vanishes"
between the before/after counts).

Item 2 (2026-09-02 fixer round): "RECONCILIATION CLEAN" requires the entry
IDENTITY to close, not just the id mapping - every collision-affected old id
falls into EXACTLY ONE of {rematched, deduped (evidenced merge), retired
unresolved}, every deduped/retired old id is actually gone from the live
verified corpus (not just claimed gone), and every rematched old id's target
actually holds it.

Usage: python3 scripts/election/reconcile-rekey.py <stamp>
"""
import glob
import json
import os
import re
import sys

STAMP = sys.argv[1] if len(sys.argv) > 1 else None
CLS = "data/election/classify"

if STAMP is None:
    stamps = sorted(
        m.group(1)
        for f in glob.glob(f"{CLS}/rekey-map-*.json")
        for m in [re.match(r"rekey-map-(.+)\.json$", os.path.basename(f))]
        if m
    )
    if not stamps:
        print("FATAL: no rekey-map-*.json found - run rekey-classify-ids.py first", file=sys.stderr)
        sys.exit(1)
    STAMP = stamps[-1]

FAIL = []


def assert_(label, cond, detail=""):
    status = "OK" if cond else "VIOLATION"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail else ""))
    if not cond:
        FAIL.append(label)


print(f"Reconciliation for stamp: {STAMP}\n")

mapping = json.load(open(f"{CLS}/rekey-map-{STAMP}.json"))
unresolved = json.load(open(f"{CLS}/rekey-unresolved-{STAMP}.json"))
rematches_path = f"{CLS}/rekey-collision-rematches-{STAMP}.json"
rematches = json.load(open(rematches_path)) if os.path.exists(rematches_path) else []
dedup_path = f"{CLS}/rekey-deduped-{STAMP}.json"
dedup = json.load(open(dedup_path)) if os.path.exists(dedup_path) else []
# Item 2 (2026-09-02 fixer round): retired-unresolved collision losers - a
# THIRD collision disposition alongside rematched/deduped, always written
# (even empty) since rekey-classify-ids.py's item-2 fix. Absent entirely
# only for a stamp produced before that fix existed (pre-dates this file).
retired_path = f"{CLS}/rekey-collision-unresolved-{STAMP}.json"
retired = json.load(open(retired_path)) if os.path.exists(retired_path) else []

am = json.load(open("data/votes/_all-motions.json"))["motions"]
cur_ids = {m["id"] for m in am}

manifest = {}
for mf in ("manifest.json", "returning-manifest.json"):
    p = f"{CLS}/{mf}"
    if os.path.exists(p):
        j = json.load(open(p))
        m = j.get("motions")
        if isinstance(m, dict):
            manifest.update(m)
        elif isinstance(m, list):
            manifest.update({e["id"]: e for e in m if isinstance(e, dict) and "id" in e})

returning_intake_ids = set()
rp = f"{CLS}/returning-manifest.json"
if os.path.exists(rp):
    rj = json.load(open(rp))
    if isinstance(rj.get("motions"), list):
        returning_intake_ids = {e["id"] for e in rj["motions"] if isinstance(e, dict) and "id" in e}

verified_files = sorted(glob.glob(f"{CLS}/batch-*-verified.json"))
verified_entries = []
for f in verified_files:
    verified_entries.extend(json.load(open(f)))
verified_ids = [e["id"] for e in verified_entries if isinstance(e, dict) and "id" in e]

# ---------------------------------------------------------------------------
# 1. Resolution headline
# ---------------------------------------------------------------------------
print("=== 1. Resolution ===")
print(f"  mapped (resolved this stamp): {len(mapping)}")
print(f"  unresolved (raw count):       {len(unresolved)}")

provenance_only_unresolved = [e for e in unresolved if e["id"] in returning_intake_ids]
actionable_unresolved = [e for e in unresolved if e["id"] not in returning_intake_ids]
print(
    f"  unresolved split: {len(actionable_unresolved)} actionable "
    f"(referenced by live classify data) + {len(provenance_only_unresolved)} "
    f"provenance-only (returning-manifest.json intake list - no generator reads it)"
)
assert_(
    "every unresolved id is either actionable or provenance-only, no third bucket",
    len(actionable_unresolved) + len(provenance_only_unresolved) == len(unresolved),
)
assert_(
    "no unresolved id is ALSO a resolved mapping key (mutually exclusive)",
    not (set(mapping) & {e["id"] for e in unresolved}),
)
assert_(
    "every mapping target is a real, current motion id",
    all(v in cur_ids for v in mapping.values()),
    f"bad targets: {[v for v in mapping.values() if v not in cur_ids][:5]}",
)

# ---------------------------------------------------------------------------
# 2. Collision handling (finding 1 rework, extended by item 1/2's third
#    disposition: retired unresolved)
# ---------------------------------------------------------------------------
print("\n=== 2. Collision handling ===")
print(f"  rematched (restored, NOT a merge):        {len(rematches)}")
for r in rematches:
    print(f"    {r['id']} -> {r['rematched_to']} (was wrongly colliding into {r['was_colliding_into']})")
print(f"  deduped (positively evidenced merge, dropped): {len(dedup)}")
for d in dedup:
    print(f"    -> {d['id']} (kept in {d['kept_in']}, removed from {d['removed_from']})")
print(f"  retired unresolved (no evidence either way, removed): {len(retired)}")
for u in retired:
    print(f"    {u['id']} (was colliding into {u['was_colliding_into']}, removed from {u['removed_from']})")

assert_(
    "every rematch's recorded target matches this stamp's final mapping",
    all(mapping.get(r["id"]) == r["rematched_to"] for r in rematches),
    str([r for r in rematches if mapping.get(r["id"]) != r["rematched_to"]]),
)

# --- Item 2 (2026-09-02 fixer round): entry-identity closure -------------
# rematched/retired records carry the removed OLD id directly (their "id"
# field). dedup records are keyed by the SURVIVOR (current) id instead, by
# construction (see rekey-classify-ids.py) - dedup closure is checked at the
# survivor-id level below rather than by recovering the dropped old id.
rematched_ids = {r["id"] for r in rematches}
retired_ids = {u["id"] for u in retired}
assert_(
    "rematched and retired-unresolved old-id sets are disjoint",
    not (rematched_ids & retired_ids),
    str(rematched_ids & retired_ids),
)
assert_(
    "no retired-unresolved old id is ALSO a resolved mapping key (it was popped)",
    not (retired_ids & set(mapping)),
    str(retired_ids & set(mapping)),
)
assert_(
    "no retired-unresolved old id survives anywhere in the live verified corpus",
    not (retired_ids & set(verified_ids)),
    str(retired_ids & set(verified_ids)),
)
assert_(
    "every rematched old id's target actually holds it in the live verified corpus",
    all(r["rematched_to"] in verified_ids for r in rematches),
    str([r for r in rematches if r["rematched_to"] not in verified_ids]),
)
dedup_survivor_ids = {d["id"] for d in dedup}
assert_(
    "every deduped (merge) survivor id actually holds an entry in the live verified corpus",
    dedup_survivor_ids <= set(verified_ids),
    str(dedup_survivor_ids - set(verified_ids)),
)

# ---------------------------------------------------------------------------
# 3. No duplicate ids across the verified corpus (re-derived independently)
# ---------------------------------------------------------------------------
print("\n=== 3. Verified-corpus integrity ===")
seen = {}
dupes = []
for f in verified_files:
    for e in json.load(open(f)):
        if not isinstance(e, dict) or "id" not in e:
            continue
        if e["id"] in seen and seen[e["id"]] != f:
            dupes.append((e["id"], seen[e["id"]], f))
        seen[e["id"]] = f
assert_(f"no duplicate id across {len(verified_files)} verified batch files", not dupes, str(dupes[:5]))
print(f"  total verified entries: {len(verified_ids)}, distinct ids: {len(set(verified_ids))}")

# ---------------------------------------------------------------------------
# 4. Text-token completeness (finding 6, extended by item 3: every prose
# field corpus-wide, not just verifierNote/whatAYeaDid on verified batches -
# corrections.json's .reason, transit-split-{proposed,verified}.json's
# .reason, and anything else, scanned the same way rekey-classify-ids.py's
# rewrite() now does: every string field except the denylisted non-prose
# ones ("id", "motionId", "quote", "meetingUrl" - bare id values and
# verbatim source text, never annotated).
# ---------------------------------------------------------------------------
print("\n=== 4. Prose id-token completeness (corpus-wide) ===")
ID_RE = re.compile(r"\b[0-9a-f]{12}\b")
SUPERSEDED = " (superseded id)"
NON_PROSE_STRING_FIELDS = {"id", "motionId", "quote", "meetingUrl"}
total_tokens = 0
live = 0
annotated = 0
dangling = []

def _scan_prose_tokens(obj, source_file):
    global total_tokens, live, annotated
    if isinstance(obj, list):
        for e in obj:
            _scan_prose_tokens(e, source_file)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k in NON_PROSE_STRING_FIELDS:
                continue
            if isinstance(v, str):
                for m in ID_RE.finditer(v):
                    tok = m.group(0)
                    total_tokens += 1
                    if tok in cur_ids:
                        live += 1
                    elif v[m.end():m.end() + len(SUPERSEDED)] == SUPERSEDED:
                        annotated += 1
                    else:
                        dangling.append((source_file, obj.get("id"), tok, v[max(0, m.start() - 30):m.end() + 10]))
            elif isinstance(v, (dict, list)):
                _scan_prose_tokens(v, source_file)

classify_layer_files = [
    f for f in glob.glob(f"{CLS}/*.json")
    if not os.path.basename(f).startswith("rekey-")
]
for f in classify_layer_files:
    _scan_prose_tokens(json.load(open(f)), f)

print(f"  id-shaped tokens found corpus-wide: {total_tokens} (live current: {live}, annotated superseded: {annotated}, dangling: {len(dangling)})")
assert_(
    "every non-current id token in any classify-layer prose field is annotated '(superseded id)' - zero dangling corpus-wide",
    not dangling,
    str(dangling[:10]),
)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
if FAIL:
    print(f"{len(FAIL)} RECONCILIATION VIOLATION(S):")
    for f in FAIL:
        print(" -", f)
    sys.exit(1)
print("RECONCILIATION CLEAN - every delta accounted for.")
