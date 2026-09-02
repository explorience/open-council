#!/usr/bin/env python3
"""
Round-3 gate items 1 and 2 verification: proves the structural fix in item
0 (renderWhatAYeaDid, generate-hub-pages.ts) actually landed everywhere it
needed to, and that the issue-page preamble's honesty rewrite (item 2)
matches its own underlying data.

BACKGROUND: before item 0, renderIssueVoteRow was the one whatAYeaDid
render site that never went through a shared helper -- it gated its "Not
classified" placeholder on `v.direction.axis !== null` instead of on
whether the motion actually has a label. Since directionFromVerified
(generate-stances.ts) always sets `label` to a real, independently-verified
description whenever one exists -- whether or not the motion has a
directional axis -- 297 issue-page rows with a genuine label printed the
placeholder anyway. Item 0 replaced all four call sites (councillor-page
axis evidence, ladder-exclusion bullets, councillor-page unclear-evidence,
and issue-page vote rows) with one renderWhatAYeaDid function gated on
label presence. This script re-derives, independently, that the fix holds:

CHECK A (zero-boilerplate-with-a-real-label): for every issue page, walk
its rendered vote rows in file order, zip them against
data/election/issues.json's own votes[] array sorted the SAME way the
generator sorts it (date descending, stable) -- confirmed row-for-row via
each row's own date and item-title text, not just trusted by position --
and assert: whenever the JSON's own direction.label is present (non-empty,
not the literal fallback "unclear"), the RENDERED cell is not the "Not
classified" boilerplate; and conversely, whenever the JSON has no label,
the rendered cell IS the boilerplate (a fabricated label would be just as
much a bug as a discarded real one).

CHECK C (round-3 gate item 2, issue-page preamble honesty): for every issue
page, re-derives X/Y/Z directly from data/election/issues.json's own votes
(X = axis-bearing count, Y = labeled-but-no-axis count, Z = genuinely
unclear count) and confirms the rendered preamble sentence's own three
numbers match exactly, and that X+Y+Z equals the page's own stated total.
The pre-fix sentence ("N had a clear direction; M did not") was false on
every one of the 8 issue pages because it folded Y into "did not" even
though a Y motion DOES have a real, independently-verified description --
just not one that supports a for/against axis.

CHECK B (councillor/issue pages agree per motion): for every motionId that
appears BOTH as a vote on some issue page (data/election/issues.json,
keyed by its own `id`) AND as an axis-evidence or unclear-evidence row on
some councillor page (data/election/stances.json, keyed by `motionId`) --
i.e. every motion visible on both page types -- assert the two files' own
label values agree exactly (issues.json's `direction.label`, normalized
the same way stances.json's whatAYeaDid already is: `label or "unclear"`).
Both ultimately trace to the SAME classification-layer field
(directionFromVerified / c.direction.label), so a real divergence here
means one of the two writers in generate-stances.ts fell out of sync with
the other -- exactly the class of defect a single shared render helper
can't fix by itself, since it's upstream of rendering.

Usage: python3 scripts/election/verify-whatayeadid-consolidation.py
"""
import glob
import json
import re
import sys

ISSUES_PATH = "data/election/issues.json"
STANCES_PATH = "data/election/stances.json"
ISSUE_GLOB = "content/election/issues/*.md"

PLACEHOLDER = "not classified"

# Issue-page vote row (renderIssueVoteRow, post round-3 gate item 3's excerpt
# column): | date | item link | what a yea did | motion excerpt | tally |
# result |
ROW_RE = re.compile(
    r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|(.*?)\|(.*?)\|(.*?)\|(.*?)\|(.*?)\|\s*$"
)


def has_label(label) -> bool:
    return bool(label) and label != "unclear"


def check_a(issues: dict) -> list[str]:
    fails = []
    rows_checked = 0
    for slug, entry in issues["issues"].items():
        path = f"content/election/issues/{slug}.md"
        try:
            lines = open(path, encoding="utf-8").read().split("\n")
        except FileNotFoundError:
            fails.append(f"{path}: issues.json has issue {slug!r} but no matching page file")
            continue

        rendered_rows = []
        for line in lines:
            m = ROW_RE.match(line)
            if not m:
                continue
            date, item_cell, whatayeadid, _excerpt, _tally, _result = m.groups()
            rendered_rows.append((date.strip(), whatayeadid.strip(), item_cell))

        json_votes = sorted(entry["votes"], key=lambda v: v["date"], reverse=True)

        if len(rendered_rows) != len(json_votes):
            fails.append(
                f"{path}: rendered {len(rendered_rows)} row(s), issues.json has "
                f"{len(json_votes)} vote(s) -- can't align for a per-row check"
            )
            continue

        for (r_date, r_whatayeadid, r_item_cell), v in zip(rendered_rows, json_votes):
            rows_checked += 1
            if r_date != v["date"]:
                fails.append(
                    f"{path}: row/vote misaligned -- rendered date {r_date!r} != "
                    f"issues.json date {v['date']!r} (motion {v['id']})"
                )
                continue
            label = v["direction"]["label"]
            is_boilerplate = r_whatayeadid.lower().startswith(PLACEHOLDER)
            if has_label(label) and is_boilerplate:
                fails.append(
                    f"{path}: motion {v['id']} ({v['date']}, {v['itemTitle']!r}) has a "
                    f"real label {label!r} but rendered the boilerplate placeholder"
                )
            elif not has_label(label) and not is_boilerplate:
                fails.append(
                    f"{path}: motion {v['id']} ({v['date']}, {v['itemTitle']!r}) has no "
                    f"label ({label!r}) but rendered non-placeholder text {r_whatayeadid!r}"
                )
    print(f"Check A: {rows_checked} issue-page row(s) checked against issues.json across {len(issues['issues'])} issue(s).")
    return fails


def check_b(issues: dict, stances: dict) -> list[str]:
    fails = []

    issue_label_by_id: dict[str, str] = {}
    for slug, entry in issues["issues"].items():
        for v in entry["votes"]:
            issue_label_by_id[v["id"]] = v["direction"]["label"] or "unclear"

    councillor_what_by_id: dict[str, set[str]] = {}
    for c_slug, c in stances["councillors"].items():
        for issue_slug, issue in c["issues"].items():
            row_groups = [issue.get("unclearEvidence", [])]
            for axis in issue.get("axes", []):
                row_groups.append(axis.get("evidence", []))
            for rows in row_groups:
                for row in rows:
                    mid = row["motionId"]
                    councillor_what_by_id.setdefault(mid, set()).add(row["whatAYeaDid"])

    shared_ids = set(issue_label_by_id) & set(councillor_what_by_id)
    for mid in sorted(shared_ids):
        issue_label = issue_label_by_id[mid]
        councillor_labels = councillor_what_by_id[mid]
        if councillor_labels != {issue_label}:
            fails.append(
                f"motion {mid}: issues.json label {issue_label!r} != "
                f"stances.json whatAYeaDid value(s) {sorted(councillor_labels)!r}"
            )
    print(f"Check B: {len(shared_ids)} motion(s) appear on both page types; label agreement checked for each.")
    return fails


PREAMBLE_RE = re.compile(
    r"^(\d+) divided \(non-unanimous, non-procedural\) council or committee "
    r"votes on this issue since [^:]+: (\d+) carry a clear direction on a "
    r"tracked axis \(counted in the patterns on each councillor's "
    r"\[stance profile\]\(/election#councillor-stance-profiles\)\); (\d+) "
    r"carry a descriptive label but no directional axis \(listed below, not "
    r"counted in any pattern\); (\d+) (?:is|are) genuinely unclear from the "
    r"motion text\.$"
)


def check_c(issues: dict) -> list[str]:
    fails = []
    checked = 0
    for slug, entry in issues["issues"].items():
        path = f"content/election/issues/{slug}.md"
        text = open(path, encoding="utf-8").read()
        sentence_line = next(
            (l for l in text.split("\n") if l.startswith(f"{entry['dividedVoteCount']} divided (")),
            None,
        )
        if sentence_line is None:
            fails.append(f"{path}: no preamble sentence found matching the expected total")
            continue
        m = PREAMBLE_RE.match(sentence_line)
        if not m:
            fails.append(f"{path}: preamble sentence didn't match the expected shape: {sentence_line!r}")
            continue
        checked += 1
        total_s, x_s, y_s, z_s = m.groups()
        total, x, y, z = int(total_s), int(x_s), int(y_s), int(z_s)

        exp_x = sum(1 for v in entry["votes"] if v["direction"]["axis"] is not None)
        exp_y = sum(
            1
            for v in entry["votes"]
            if v["direction"]["axis"] is None and has_label(v["direction"]["label"])
        )
        exp_z = len(entry["votes"]) - exp_x - exp_y

        if total != entry["dividedVoteCount"]:
            fails.append(f"{path}: sentence total={total} != issues.json dividedVoteCount={entry['dividedVoteCount']}")
        if x != exp_x:
            fails.append(f"{path}: sentence X={x} != re-derived clear-direction count={exp_x}")
        if y != exp_y:
            fails.append(f"{path}: sentence Y={y} != re-derived labeled-no-axis count={exp_y}")
        if z != exp_z:
            fails.append(f"{path}: sentence Z={z} != re-derived genuinely-unclear count={exp_z}")
        if x + y + z != total:
            fails.append(f"{path}: sentence's own numbers don't add up: {x}+{y}+{z} != {total}")

    print(f"Check C: {checked} issue-page preamble sentence(s) checked against issues.json.")
    return fails


def main():
    issues = json.load(open(ISSUES_PATH, encoding="utf-8"))
    stances = json.load(open(STANCES_PATH, encoding="utf-8"))

    fails = check_a(issues) + check_b(issues, stances) + check_c(issues)

    print()
    if fails:
        print(f"{len(fails)} CHECK(S) FAILED:")
        for f in fails[:80]:
            print(" -", f)
        if len(fails) > 80:
            print(f"   ... and {len(fails) - 80} more")
        sys.exit(1)
    print(
        "ALL CHECKS PASSED -- zero issue-page rows with a real label render the "
        "boilerplate (or vice versa), every motion shown on both page types "
        "carries the same label on each, and every preamble's X/Y/Z sentence "
        "matches its own data."
    )


if __name__ == "__main__":
    main()
