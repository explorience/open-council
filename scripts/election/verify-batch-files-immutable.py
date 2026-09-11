#!/usr/bin/env python3
"""
Permanent guard against the tranche-2 verify-agent-restart incident: a
session restart re-ran the verify agents, which silently overwrote
committed data/election/classify/batch-*-{classified,verified}.json files
with a second, independent pass -- breaking corrections.json's was/now
overlay (keyed on the committed values) and crashing every downstream
script that loads the merged view.

RULE: classification records are append-only history. For every tracked
data/election/classify/batch-*-{classified,verified}.json, the working
tree must match the last commit (HEAD, or --ref) in:
  - entry count and entry order (by id)
  - every CLASSIFICATION field: id, issue, axis, polarity, whatAYeaDid,
    confidence, quote, flags, verdict
Legitimate fixes go through corrections.json, not the batch file itself.

CLASSES REPORTED (a file can have more than one):
  structural  -- entry count changed, order changed, or an id was
                 added/removed within a tracked file.
  field       -- a classification field changed on an id that still
                 exists in both versions. This is the defect the incident
                 caused.
  note_only   -- verifierNote changed but no classification field did.
                 Not a false-statement risk, but it silently destroys the
                 audit trail of what the original verifier actually said,
                 so it is reported as its own class rather than ignored.

A file untracked by git (a brand-new batch being written for the first
time) is skipped entirely, as is a tracked file with no HEAD copy yet
(staged but never committed -- same "not written to history yet" case).

Usage: python3 scripts/election/verify-batch-files-immutable.py
       [--repo-root PATH] [--ref REF]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

CLASS_FIELDS = (
    "id",
    "issue",
    "axis",
    "polarity",
    "whatAYeaDid",
    "confidence",
    "quote",
    "flags",
    "verdict",
)
GLOBS = (
    "data/election/classify/batch-*-classified.json",
    "data/election/classify/batch-*-verified.json",
)
TRUNCATE_AT = 150


def truncate(value: object) -> str:
    s = json.dumps(value, ensure_ascii=False)
    return s if len(s) <= TRUNCATE_AT else s[: TRUNCATE_AT - 3] + "..."


def git(repo_root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=str(repo_root), capture_output=True, text=True
    )


def tracked_batch_files(repo_root: Path) -> list[str]:
    result = git(repo_root, "ls-files", "--", *GLOBS)
    if result.returncode != 0:
        print("FAIL: git ls-files errored:")
        print(result.stderr)
        sys.exit(2)
    return sorted(p for p in result.stdout.splitlines() if p)


def committed_content(repo_root: Path, ref: str, path: str) -> str | None:
    """Return the file's content at `ref`, or None if it doesn't exist there
    (a tracked-but-never-committed new file -- same "not history yet" case
    as an untracked file)."""
    result = git(repo_root, "show", f"{ref}:{path}")
    if result.returncode != 0:
        return None
    return result.stdout


def load_entries(raw: str, label: str) -> list[dict] | None:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"FAIL: {label} is not valid JSON ({exc})")
        return None
    if not isinstance(data, list):
        print(f"FAIL: {label} top level is not a list")
        return None
    return data


def check_file(repo_root: Path, ref: str, path: str) -> list[dict]:
    """Return a list of violation dicts for one file."""
    committed_raw = committed_content(repo_root, ref, path)
    if committed_raw is None:
        return []  # tracked but not yet in `ref` -- treat like a new file

    working_path = repo_root / path
    if not working_path.exists():
        return [
            {
                "class": "structural",
                "file": path,
                "id": "__all__",
                "field": "__deleted__",
                "committed": f"<{len(committed_raw)} bytes>",
                "working": "<file deleted>",
            }
        ]
    working_raw = working_path.read_text()

    committed = load_entries(committed_raw, f"{path} @ {ref}")
    working = load_entries(working_raw, f"{path} (working tree)")
    if committed is None or working is None:
        return [
            {
                "class": "structural",
                "file": path,
                "id": "__all__",
                "field": "__unparseable__",
                "committed": truncate(committed_raw[:TRUNCATE_AT]),
                "working": truncate(working_raw[:TRUNCATE_AT]),
            }
        ]

    violations: list[dict] = []
    committed_ids = [e.get("id") for e in committed]
    working_ids = [e.get("id") for e in working]

    if committed_ids != working_ids:
        if len(committed_ids) != len(working_ids):
            violations.append(
                {
                    "class": "structural",
                    "file": path,
                    "id": "__all__",
                    "field": "__entry_count__",
                    "committed": len(committed_ids),
                    "working": len(working_ids),
                }
            )
        for i, (c_id, w_id) in enumerate(zip(committed_ids, working_ids)):
            if c_id != w_id:
                violations.append(
                    {
                        "class": "structural",
                        "file": path,
                        "id": f"position {i}",
                        "field": "__order__",
                        "committed": c_id,
                        "working": w_id,
                    }
                )
        removed = [i for i in committed_ids if i not in working_ids]
        added = [i for i in working_ids if i not in committed_ids]
        for i in removed:
            violations.append(
                {
                    "class": "structural",
                    "file": path,
                    "id": i,
                    "field": "__removed__",
                    "committed": i,
                    "working": "<absent>",
                }
            )
        for i in added:
            violations.append(
                {
                    "class": "structural",
                    "file": path,
                    "id": i,
                    "field": "__added__",
                    "committed": "<absent>",
                    "working": i,
                }
            )

    committed_by_id = {e.get("id"): e for e in committed}
    working_by_id = {e.get("id"): e for e in working}
    for entry_id in committed_by_id:
        if entry_id not in working_by_id:
            continue  # already reported as __removed__ above
        c, w = committed_by_id[entry_id], working_by_id[entry_id]
        changed = [f for f in CLASS_FIELDS if c.get(f) != w.get(f)]
        if changed:
            for f in changed:
                violations.append(
                    {
                        "class": "field",
                        "file": path,
                        "id": entry_id,
                        "field": f,
                        "committed": truncate(c.get(f)),
                        "working": truncate(w.get(f)),
                    }
                )
        elif c.get("verifierNote") != w.get("verifierNote"):
            violations.append(
                {
                    "class": "note_only",
                    "file": path,
                    "id": entry_id,
                    "field": "verifierNote",
                    "committed": truncate(c.get("verifierNote")),
                    "working": truncate(w.get("verifierNote")),
                }
            )

    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repo root to check (default: the repo containing this script).",
    )
    parser.add_argument(
        "--ref",
        default="HEAD",
        help="Git ref treated as 'committed' (default: HEAD).",
    )
    args = parser.parse_args()

    if args.repo_root is not None:
        repo_root = args.repo_root.resolve()
    else:
        script_dir = Path(__file__).resolve().parent
        result = git(script_dir, "rev-parse", "--show-toplevel")
        if result.returncode != 0:
            print("FAIL: could not resolve repo root via git rev-parse:")
            print(result.stderr)
            return 1
        repo_root = Path(result.stdout.strip())

    files = tracked_batch_files(repo_root)
    print(f"Checking {len(files)} tracked batch-*-{{classified,verified}}.json "
          f"files against {args.ref}...\n")

    all_violations: list[dict] = []
    for path in files:
        all_violations.extend(check_file(repo_root, args.ref, path))

    if not all_violations:
        print("PASS: no batch file differs from its committed content.")
        return 0

    counts: dict[str, int] = {}
    for v in all_violations:
        counts[v["class"]] = counts.get(v["class"], 0) + 1

    print(f"FAIL: {len(all_violations)} violation(s) across "
          f"{len({v['file'] for v in all_violations})} file(s):\n")
    for v in all_violations:
        print(
            f"  [{v['class']}] {v['file']}  id={v['id']}  field={v['field']}\n"
            f"      committed: {v['committed']}\n"
            f"      working:   {v['working']}"
        )
    print("\nPer-class counts:")
    for cls in sorted(counts):
        print(f"  {cls}: {counts[cls]}")

    return 1


if __name__ == "__main__":
    sys.exit(main())
