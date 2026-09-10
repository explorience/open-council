#!/usr/bin/env python3
"""PR #204 -> main merge (2026-09-10): proves nothing from the classify
layer was lost.

Checks, against data/election/classify/premerge-baseline-20260910.json
(the pre-merge snapshot of THIS branch: verified_ids, corrections count,
manifest_motions count, batches count):

  1. Every id in verified_ids still exists in some post-merge
     batch-*-verified.json, OR is reachable from a baseline id via the
     transitive closure of every committed rekey-map-*.json (old id ->
     new id) to an id that does exist post-merge.
  2. corrections.json row count, manifest.json motions count, and
     manifest.json batches[] slot count are each >= the baseline figure
     (append-only: a merge may only add, never shrink).

Usage: python3 scripts/election/verify-premerge-conservation-20260910.py
Exit 0 if both checks pass; exit 1 otherwise, printing exactly what's
missing or what shrank.
"""
import glob
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CLASSIFY_DIR = REPO_ROOT / "data/election/classify"
BASELINE_PATH = CLASSIFY_DIR / "premerge-baseline-20260910.json"


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def collect_current_verified_ids():
    ids = set()
    per_file = 0
    for path in sorted(glob.glob(str(CLASSIFY_DIR / "batch-*-verified.json"))):
        rows = load_json(path)
        for row in rows:
            ids.add(row["id"])
        per_file += 1
    return ids, per_file


def collect_rekey_maps():
    """old_id -> new_id, unioned across every rekey-map-*.json (each maps
    disjoint slices of history; a chain across multiple stamps is legal --
    an id rekeyed once, then rekeyed again later, another day)."""
    mapping = {}
    for path in sorted(glob.glob(str(CLASSIFY_DIR / "rekey-map-*.json"))):
        m = load_json(path)
        for old, new in m.items():
            mapping[old] = new
    return mapping


def resolve(old_id, current_ids, rekey_map, max_hops=20):
    """Follow the rekey chain from old_id; return the terminal id if it
    lands in current_ids, else None. Guards against a cycle/self-map."""
    seen = {old_id}
    cur = old_id
    for _ in range(max_hops):
        if cur in current_ids:
            return cur
        nxt = rekey_map.get(cur)
        if nxt is None or nxt in seen:
            return None
        seen.add(nxt)
        cur = nxt
    return None


def main() -> int:
    if not BASELINE_PATH.exists():
        print(f"FAIL: baseline file not found: {BASELINE_PATH}")
        return 1
    baseline = load_json(BASELINE_PATH)
    baseline_ids = baseline["verified_ids"]

    current_ids, batch_files_scanned = collect_current_verified_ids()
    rekey_map = collect_rekey_maps()

    missing = []
    rekeyed_ok = 0
    for old_id in baseline_ids:
        if old_id in current_ids:
            continue
        resolved = resolve(old_id, current_ids, rekey_map)
        if resolved is not None:
            rekeyed_ok += 1
            continue
        missing.append(old_id)

    corrections = load_json(CLASSIFY_DIR / "corrections.json")
    manifest = load_json(CLASSIFY_DIR / "manifest.json")

    corrections_n = len(corrections)
    manifest_motions_n = len(manifest["motions"])
    batches_n = len(manifest["batches"])

    ok = True
    print(f"Scanned {batch_files_scanned} batch-*-verified.json files, {len(current_ids)} current verified ids.")
    print(f"Baseline verified_ids: {len(baseline_ids)}")
    print(f"  found directly:  {len(baseline_ids) - len(missing) - rekeyed_ok}")
    print(f"  found via rekey: {rekeyed_ok}")
    print(f"  MISSING:         {len(missing)}")
    if missing:
        ok = False
        print("  missing ids (first 50):")
        for mid in missing[:50]:
            print(f"    {mid}")

    def check_count(label, current, baseline_val):
        nonlocal ok
        status = "OK" if current >= baseline_val else "SHRUNK"
        if current < baseline_val:
            ok = False
        print(f"{label}: baseline={baseline_val} current={current} [{status}]")

    check_count("corrections.json rows", corrections_n, baseline["corrections"])
    check_count("manifest.json motions", manifest_motions_n, baseline["manifest_motions"])
    check_count("manifest.json batches", batches_n, baseline["batches"])

    print(f"\n{'=' * 60}")
    if ok:
        print("PASS: conservation holds -- every baseline verified id survives (direct or rekeyed), no count shrank.")
        return 0
    print("FAIL: conservation violated -- see MISSING ids and/or SHRUNK counts above.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
