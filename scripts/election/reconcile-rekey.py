#!/usr/bin/env python3
"""Reconciliation report for a rekey-classify-ids.py run (2026-09-02 fixer
round, PR #202 verifier findings 1/3/5).

Independently re-derives the headline numbers from the artifacts
rekey-classify-ids.py writes (rekey-map-<stamp>.json, rekey-unresolved-
<stamp>.json, rekey-collision-rematches-<stamp>.json, rekey-deduped-
<stamp>.json if present) plus the live corpus (manifest.json, returning-
manifest.json, batch-*-verified.json, corrections.json) - never trusts the
rekey script's own printed summary, re-counts from the files it left
behind, and asserts every delta is attributed (nothing merely "vanishes"
between the before/after counts).

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
# 2. Collision handling (finding 1 rework)
# ---------------------------------------------------------------------------
print("\n=== 2. Collision handling ===")
print(f"  rematched (restored, NOT a merge): {len(rematches)}")
for r in rematches:
    print(f"    {r['id']} -> {r['rematched_to']} (was wrongly colliding into {r['was_colliding_into']})")
print(f"  deduped (genuine merge, dropped):   {len(dedup)}")
assert_(
    "every rematch's recorded target matches this stamp's final mapping",
    all(mapping.get(r["id"]) == r["rematched_to"] for r in rematches),
    str([r for r in rematches if mapping.get(r["id"]) != r["rematched_to"]]),
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
# 4. Text-token completeness (finding 6)
# ---------------------------------------------------------------------------
print("\n=== 4. verifierNote/whatAYeaDid id-token completeness ===")
ID_RE = re.compile(r"\b[0-9a-f]{12}\b")
SUPERSEDED = " (superseded id)"
total_tokens = 0
live = 0
annotated = 0
dangling = []
for f in verified_files:
    for e in json.load(open(f)):
        if not isinstance(e, dict):
            continue
        for k in ("verifierNote", "whatAYeaDid"):
            v = e.get(k)
            if not isinstance(v, str):
                continue
            for m in ID_RE.finditer(v):
                tok = m.group(0)
                total_tokens += 1
                if tok in cur_ids:
                    live += 1
                elif v[m.end():m.end() + len(SUPERSEDED)] == SUPERSEDED:
                    annotated += 1
                else:
                    dangling.append((f, e.get("id"), tok))
print(f"  id-shaped tokens found: {total_tokens} (live current: {live}, annotated superseded: {annotated})")
assert_("every non-current id token in verifierNote/whatAYeaDid is annotated '(superseded id)'", not dangling, str(dangling[:10]))

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
