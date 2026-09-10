#!/usr/bin/env python3
"""Election Hub — per-motion evidence-anchor precision guard.

Every published hub claim has to tap through to the EXACT motion it rests
on. This is the permanent guard on that: it proves each hub evidence link
targets an anchor that (a) exists in the built page, (b) sits on the row's
own roll call rather than a sibling under the same agenda item, (c) is
unique, and (d) does not move when the generators are re-run or when the
volatile parts of the source data change.

Ten checks, all with a negative direction (`--negative <name>` injects the
defect the check exists to catch and requires the check to FAIL):

  uniqueness          every emitted anchor id unique within its page, and
                      (meetingSlug, itemNumber, rollCallOrdinal) unique
                      corpus-wide
  idempotence         anchor ids are invariant under a motionText change —
                      the direct guard on the 100%-id-churn finding
  churn-replay        the natural key survives a five-week re-scrape; the
                      sha256 motion id does not
  resolution          every hub evidence fragment exists verbatim as an id
                      in the built HTML under public/
  position-oracle     the motion sitting at each anchor is the motion the
                      row cites, matched by ROLL CALL, never by result text
  non-disruption      not one auto-generated heading id changed
  fallback-conserv    the honest fallback population only ever shrinks, and
                      every row that left it is position-oracle clean
  verifier-mutation   flipping a published anchor to a sibling's makes the
                      suite exit non-zero
  manifest-diff       the committed anchor manifest still matches the pages
  no-text-derivation  no anchor id is computed from heading text, itemTitle,
                      motionText, or a tally

Usage:
  python3 scripts/election/verify-evidence-anchor-precision.py
  python3 scripts/election/verify-evidence-anchor-precision.py --only resolution
  python3 scripts/election/verify-evidence-anchor-precision.py --negative uniqueness

Run after the full generation order and `npm run build` (checks that need
public/ say so and fail, never skip, if it is missing).
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MOTIONS = os.path.join(REPO, "data", "votes", "_all-motions.json")
MANIFEST = os.path.join(REPO, "data", "votes", "_motion-anchors.json")
HEADING_BASELINE = os.path.join(REPO, "data", "votes", "_heading-id-baseline.json")
ISSUES = os.path.join(REPO, "data", "election", "issues.json")
STANCES = os.path.join(REPO, "data", "election", "stances.json")
CONTENT = os.path.join(REPO, "content")
PUBLIC = os.path.join(REPO, "public")

# The fallback population this change inherited (audited 2026-09-09 against
# the rendered hub pages, issues.json/stances.json, and a live re-run of
# anchors.motionAnchor: 1773 rendered rows over 115 distinct motions). The
# fallback may shrink; it must never grow without a deliberate, explained
# baseline change.
FALLBACK_BASELINE_MOTIONS = 115
FALLBACK_BASELINE_ROWS = 1773

# The snapshot used by the churn replay: data/votes/_all-motions.json as it
# stood five weeks before this change.
CHURN_SNAPSHOT_SHA = "50a1d7234e169d9252998f127228a91fdf82c929"

# Committee-to-council cross-reference fragments written by the UPSTREAM
# scraper that were already broken before per-motion anchors existed —
# each one verified absent from the pre-change build's heading ids too, so
# none of them is link rot this change caused. Listed rather than tolerated
# in bulk: any cross-reference that breaks from here on is a new defect and
# fails the check.
KNOWN_BROKEN_CROSS_REFS = {
    "31public-participation-meeting--swimming-pool-fence-by-law-amendments---city-initiated",
    "32application---584-and-588-wonderland-road-north-oz-9114",
    "241284-and-1388-sunningdale-road-west-39t-045105",
    "243095-and-3105-bostwick-road---talbot-village-subdivision-phase-7---special-provisions-39t-215027",
}

# Both tags are accepted: <div> is what is emitted today (a raw HTML
# block, so no stray paragraph wrapper), <a> is what the first cut emitted.
# Anchors are append-only, so a page carrying either must keep resolving.
ANCHOR_IN_MD = re.compile(r'<(?:div|a) id="(motion-[a-z0-9-]+)"')
HEADING_ID = re.compile(rb'<(h[1-6])\b[^>]*\bid="([^"]*)"', re.IGNORECASE)


# ---------------------------------------------------------------------------
# The anchor key — kept in lockstep with scripts/motion-anchor.ts
# ---------------------------------------------------------------------------
def normalize_item_number(item_number: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", item_number.lower()).strip("-")
    return normalized or "item"


def motion_anchor_id(item_number: str, roll_call_ordinal) -> str:
    return f"motion-{normalize_item_number(item_number)}-{roll_call_ordinal}"


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------
_cache: dict = {}


def motions() -> list:
    if "motions" not in _cache:
        with open(MOTIONS, encoding="utf-8") as fh:
            _cache["motions"] = json.load(fh)["motions"]
    return _cache["motions"]


def motions_by_id() -> dict:
    if "by_id" not in _cache:
        _cache["by_id"] = {m["id"]: m for m in motions()}
    return _cache["by_id"]


def manifest() -> dict:
    if "manifest" not in _cache:
        with open(MANIFEST, encoding="utf-8") as fh:
            _cache["manifest"] = json.load(fh)
    return _cache["manifest"]


def hub_rows() -> list:
    """Every hub evidence row that carries an anchor, from both hub data
    files. issues.json rows carry the full roll call; stances.json rows are
    the same motions re-shown per councillor."""
    if "rows" in _cache:
        return _cache["rows"]
    rows = []
    with open(ISSUES, encoding="utf-8") as fh:
        issues = json.load(fh)
    for slug, issue in issues["issues"].items():
        for v in issue["votes"]:
            rows.append(
                {
                    "source": f"issue:{slug}",
                    "motionId": v["id"],
                    "meetingSlug": v["meetingSlug"],
                    "itemNumber": v["itemNumber"],
                    "rollCallOrdinal": v.get("rollCallOrdinal"),
                    "anchor": v.get("anchor"),
                    "anchorAmbiguous": bool(v.get("anchorAmbiguous")),
                    "anchorPrecise": bool(v.get("anchorPrecise")),
                    "result": v.get("result", ""),
                }
            )
    with open(STANCES, encoding="utf-8") as fh:
        stances = json.load(fh)
    for slug, c in stances["councillors"].items():
        for issue in c["issues"].values():
            for axis in issue["axes"]:
                for ev in axis["evidence"]:
                    rows.append(
                        {
                            "source": f"councillor:{slug}",
                            "motionId": ev["motionId"],
                            "meetingSlug": ev["meetingSlug"],
                            "itemNumber": ev["itemNumber"],
                            "rollCallOrdinal": ev.get("rollCallOrdinal"),
                            "anchor": ev.get("anchor"),
                            "anchorAmbiguous": bool(ev.get("anchorAmbiguous")),
                            "anchorPrecise": bool(ev.get("anchorPrecise")),
                            "result": ev.get("result", ""),
                        }
                    )
    _cache["rows"] = rows
    return rows


def slugify_segment(segment: str) -> str:
    return segment.replace(" ", "-").replace("%20", "-").replace("&", "-")


_html_cache: dict = {}


def built_html(url_path: str):
    """The built page for a hub link's path, resolved the way Quartz
    slugifies output paths (see verify-evidence-links.ts)."""
    if url_path in _html_cache:
        return _html_cache[url_path]
    decoded = url_path.lstrip("/")
    parts = [slugify_segment(p) for p in decoded.split("/")]
    path = os.path.join(PUBLIC, *parts) + ".html"
    html = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            html = fh.read()
    _html_cache[url_path] = html
    return html


def section_after_anchor(html: str, anchor_id: str):
    """HTML from just after the element carrying this id up to the next
    heading — i.e. the anchored motion's own body."""
    marker = f'id="{anchor_id}"'
    idx = html.find(marker)
    if idx == -1:
        return None
    start = idx + len(marker)
    nxt = re.search(r"<h[1-6]\b", html[start:], re.IGNORECASE)
    return html[start : start + nxt.start()] if nxt else html[start:]


def markdown_files() -> list:
    if "mds" not in _cache:
        out = []
        for root, _dirs, files in os.walk(os.path.join(CONTENT, "months")):
            for name in files:
                if name.endswith(".md"):
                    out.append(os.path.join(root, name))
        _cache["mds"] = sorted(out)
    return _cache["mds"]


# ---------------------------------------------------------------------------
# Checks. Each returns (ok, [lines of detail]).
# ---------------------------------------------------------------------------
def check_uniqueness(negative=False):
    detail = []
    corpus = motions()
    if negative:
        # Inject the defect: a second motion sharing one item AND ordinal.
        victim = next(m for m in corpus if not m["procedural"])
        clone = copy.deepcopy(victim)
        clone["id"] = "injected00000"
        clone["motionText"] = "INJECTED DUPLICATE"
        corpus = corpus + [clone]

    seen = {}
    key_dupes = []
    for m in corpus:
        key = (m["meetingSlug"], normalize_item_number(m["itemNumber"]), m["rollCallOrdinal"])
        if key in seen and seen[key] != m["id"]:
            key_dupes.append((key, seen[key], m["id"]))
        seen[key] = m["id"]
    detail.append(
        f"natural key (meetingSlug, itemNumber, rollCallOrdinal): {len(corpus)} motions, "
        f"{len(seen)} distinct keys, {len(key_dupes)} collision(s)"
    )

    # Uniqueness of the ids actually written onto the pages.
    page_dupes = []
    total_ids = 0
    for path in markdown_files():
        with open(path, encoding="utf-8") as fh:
            ids = ANCHOR_IN_MD.findall(fh.read())
        total_ids += len(ids)
        if len(ids) != len(set(ids)):
            dup = [i for i in set(ids) if ids.count(i) > 1]
            page_dupes.append((os.path.relpath(path, REPO), dup))
    detail.append(
        f"emitted anchors on disk: {total_ids} ids across {len(markdown_files())} meeting pages, "
        f"{len(page_dupes)} page(s) with a duplicate id"
    )
    for key, a, b in key_dupes[:5]:
        detail.append(f"  COLLISION {key}: motions {a} and {b}")
    for page, dup in page_dupes[:5]:
        detail.append(f"  DUPLICATE ID on {page}: {dup}")
    return (not key_dupes and not page_dupes), detail


def check_idempotence(negative=False):
    """Anchor ids must depend ONLY on the natural key. Mutate motionText —
    the field that churned 100% of sha256 motion ids in five weeks — for a
    large sample and require every anchor id to be unchanged. The negative
    direction mutates the ORDINAL instead, which must change the id."""
    detail = []
    sample = [m for m in motions() if not m["procedural"]][:2000]
    before = [motion_anchor_id(m["itemNumber"], m["rollCallOrdinal"]) for m in sample]

    mutated = copy.deepcopy(sample)
    for m in mutated:
        m["motionText"] = "REWORDED BY A RE-SCRAPE — " + m["motionText"][::-1]
        m["result"] = m["result"] + " (reworded)"
        m["itemTitle"] = m["itemTitle"].upper()
        m["id"] = hashlib.sha256(m["motionText"].encode()).hexdigest()[:12]
        if negative:
            m["rollCallOrdinal"] = m["rollCallOrdinal"] + 1
    after = [motion_anchor_id(m["itemNumber"], m["rollCallOrdinal"]) for m in mutated]

    changed = sum(1 for a, b in zip(before, after) if a != b)
    ids_changed = sum(1 for a, b in zip(sample, mutated) if a["id"] != b["id"])
    detail.append(
        f"mutated motionText/result/itemTitle on {len(sample)} motions: "
        f"{ids_changed}/{len(sample)} sha256 motion ids changed, {changed}/{len(sample)} anchor ids changed"
    )

    # Second half: the pages on disk must already agree with the manifest,
    # i.e. re-running the generator produced exactly what is committed.
    emitted = set()
    for path in markdown_files():
        with open(path, encoding="utf-8") as fh:
            emitted.update(ANCHOR_IN_MD.findall(fh.read()))
    declared = {a["anchorId"] for a in manifest()["anchors"]}
    detail.append(
        f"anchor ids on disk vs manifest: {len(emitted)} distinct on pages, "
        f"{len(declared)} distinct in manifest, {len(declared - emitted)} manifest-only"
    )
    return (changed == 0 and not (declared - emitted)), detail


def check_churn_replay(negative=False):
    """Replay the derivation against the five-week-old snapshot.

    Honest limitation, stated rather than hidden: that snapshot predates
    rollCallOrdinal being persisted in _all-motions.json, so the ordinal
    cannot be read back from it. What IS replayable is the rest of the key
    — (meetingSlug, itemNumber) plus each motion's RANK among that item's
    roll calls, which is the ordinal's ordering — alongside the id-survival
    figure the natural key exists to beat."""
    detail = []
    try:
        old_raw = subprocess.run(
            ["git", "show", f"{CHURN_SNAPSHOT_SHA}:data/votes/_all-motions.json"],
            cwd=REPO,
            capture_output=True,
            check=True,
        ).stdout
    except subprocess.CalledProcessError as exc:
        return False, [f"could not read snapshot {CHURN_SNAPSHOT_SHA}: {exc}"]
    old = json.loads(old_raw)["motions"]
    new = motions()

    old_meetings = {m["meetingSlug"] for m in old}
    new_meetings = {m["meetingSlug"] for m in new}
    shared = old_meetings & new_meetings

    old_shared = [m for m in old if m["meetingSlug"] in shared]
    new_ids = {m["id"] for m in new}
    id_survivors = sum(1 for m in old_shared if m["id"] in new_ids)

    def ranked(rows):
        out = {}
        for m in rows:
            key = (m["meetingSlug"], normalize_item_number(m["itemNumber"]))
            out.setdefault(key, 0)
            out[key] += 1
        return out

    old_counts = ranked(old_shared)
    new_counts = ranked([m for m in new if m["meetingSlug"] in shared])
    key_present = sum(1 for k in old_counts if k in new_counts)
    rank_stable = sum(1 for k, n in old_counts.items() if new_counts.get(k) == n)

    detail.append(
        f"snapshot {CHURN_SNAPSHOT_SHA[:8]}: {len(old)} motions, HEAD: {len(new)}; "
        f"{len(shared)} meetings in both, {len(old_shared)} snapshot motions in them"
    )
    detail.append(
        f"  sha256 motion ids surviving: {id_survivors}/{len(old_shared)} "
        f"({100.0 * id_survivors / max(1, len(old_shared)):.1f}%) — this is why the anchor is NOT id-derived"
    )
    detail.append(
        f"  natural-key (meeting, itemNumber) still present: {key_present}/{len(old_counts)} "
        f"({100.0 * key_present / max(1, len(old_counts)):.1f}%)"
    )
    detail.append(
        f"  same roll-call count under that key (ordinals map 1:1): {rank_stable}/{len(old_counts)} "
        f"({100.0 * rank_stable / max(1, len(old_counts)):.1f}%)"
    )
    detail.append(
        "  NOTE: the snapshot predates rollCallOrdinal being stored, so the ordinal itself "
        "is replayed as a rank, not read back verbatim."
    )

    threshold = 0.85
    ratio = key_present / max(1, len(old_counts))
    if negative:
        # Negative direction: demand the id-derived scheme clear the same
        # bar the natural key does. It cannot — that is the whole finding.
        ratio = id_survivors / max(1, len(old_shared))
        detail.append(
            f"  NEGATIVE: scoring an id-derived scheme against the same {threshold:.0%} bar"
        )
    return ratio >= threshold, detail


def check_resolution(negative=False):
    """Every hub evidence fragment must exist verbatim as an id in the
    built HTML. Catches slug-prediction drift and any Quartz change."""
    detail = []
    if not os.path.isdir(PUBLIC):
        return False, ["public/ missing — run npm run build before this check"]
    rows = hub_rows()
    checked = missing_page = missing_id = 0
    misses = []
    for i, r in enumerate(rows):
        anchor = r["anchor"]
        if not anchor:
            continue
        url, _, fragment = anchor.partition("#")
        if negative and i == 0:
            fragment = fragment + "-does-not-exist"
        html = built_html(url)
        if html is None:
            missing_page += 1
            misses.append(f"  no built page for {url}")
            continue
        if not fragment:
            continue
        checked += 1
        if f'id="{fragment}"' not in html:
            missing_id += 1
            if len(misses) < 6:
                misses.append(f"  motion {r['motionId']}: id \"{fragment}\" absent from {url}")
    detail.append(
        f"{checked} hub evidence fragments checked against built HTML; "
        f"{missing_page} missing page(s), {missing_id} missing id(s)"
    )
    detail.extend(misses[:6])

    # Non-hub consumers of the SAME pages: the upstream scraper writes
    # committee-to-council cross-reference links into the raw agenda
    # headings (e.g. "#21argyle-business-improvement-association-..."),
    # built from github-slugger heading slugs. This change is additive, so
    # those must still resolve — checked, not assumed.
    cross_checked = cross_missing = cross_unresolvable = cross_known = 0
    for path in markdown_files():
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        for m in re.finditer(r"\]\(</?([^>()#]*?)#([a-z0-9][a-z0-9-]*)>\)", body):
            page, frag = m.group(1), m.group(2)
            if frag.startswith("motion-") or not page.strip():
                continue
            page = page.strip("/")
            html = built_html("/" + page)
            if html is None and not page.startswith("months/"):
                html = built_html("/months/" + page)
            if html is None:
                # Pre-existing: the upstream scraper writes some of these
                # with paths from before meetings moved under months/, so
                # the PAGE never resolved. Counted and reported, never
                # silently swallowed, but not this change's to fix.
                cross_unresolvable += 1
                continue
            cross_checked += 1
            if f'id="{frag}"' not in html:
                if frag in KNOWN_BROKEN_CROSS_REFS:
                    cross_known += 1
                    continue
                cross_missing += 1
                if len(misses) < 12:
                    misses.append(f"  NEW broken cross-reference {frag} absent from {page}")
    detail.append(
        f"in-corpus cross-reference heading fragments: {cross_checked} resolvable, "
        f"{cross_missing} newly broken, {cross_known} already broken before this change; "
        f"{cross_unresolvable} point at a page path that never existed"
    )

    # The RENDERED hub pages, not just the data behind them: every
    # per-motion fragment written into content/election/**.md must resolve.
    # This is the population a reader actually taps.
    rendered_checked = rendered_missing = 0
    election_dir = os.path.join(CONTENT, "election")
    for root, _dirs, files in os.walk(election_dir):
        for name in files:
            if not name.endswith(".md"):
                continue
            with open(os.path.join(root, name), encoding="utf-8") as fh:
                body = fh.read()
            for m in re.finditer(r"\]\(<(/[^>#]*)#(motion-[a-z0-9-]+)>\)", body):
                page, frag = m.group(1), m.group(2)
                html = built_html(page)
                rendered_checked += 1
                if html is None or f'id="{frag}"' not in html:
                    rendered_missing += 1
                    if len(misses) < 12:
                        misses.append(f"  rendered hub link {frag} unresolved on {page}")
    detail.append(
        f"rendered hub evidence links in content/election: {rendered_checked} checked, "
        f"{rendered_missing} unresolved"
    )
    detail.extend(misses[6:12])
    return (
        missing_page == 0
        and missing_id == 0
        and cross_missing == 0
        and rendered_missing == 0
    ), detail


def check_position_oracle(negative=False):
    """THE important one. Prove the motion sitting at each anchor is the
    motion the row cites — by the ROLL CALL (who voted which way) and the
    natural key, never by the result string, which 40.1% of substantive
    motions share with a same-item sibling."""
    detail = []
    if not os.path.isdir(PUBLIC):
        return False, ["public/ missing — run npm run build before this check"]
    by_id = motions_by_id()
    rows = hub_rows()

    key_mismatch = roster_mismatch = checked = unresolved = 0
    indistinguishable = 0
    problems = []

    swap_target = None
    if negative:
        swap_target = _find_sibling_swap(rows, by_id)
        if not swap_target:
            return False, ["negative test could not find a same-item sibling pair to swap"]
        detail.append(
            f"NEGATIVE: motion {swap_target['motionId']} re-pointed at sibling anchor "
            f"{swap_target['sibling_anchor']} (same item, result strings "
            f"{'IDENTICAL' if swap_target['same_result'] else 'different'})"
        )

    for r in rows:
        anchor = r["anchor"]
        if not anchor or "#" not in anchor:
            continue
        url, _, fragment = anchor.partition("#")
        if not fragment.startswith("motion-"):
            continue
        if negative and r["motionId"] == swap_target["motionId"]:
            fragment = swap_target["sibling_anchor"]

        checked += 1
        motion = by_id.get(r["motionId"])
        if motion is None:
            unresolved += 1
            continue

        # (a) ORDINAL POSITION: the fragment must be the id this row's own
        # natural key implies — the ordinal is what distinguishes siblings.
        expected = motion_anchor_id(motion["itemNumber"], motion["rollCallOrdinal"])
        if fragment != expected:
            key_mismatch += 1
            if len(problems) < 6:
                problems.append(
                    f"  motion {r['motionId']}: anchored at {fragment}, natural key says {expected}"
                )
            continue

        # (b) ROLL CALL: the anchored section's own yea/nay name lists must
        # be this motion's.
        html = built_html(url)
        if html is None:
            unresolved += 1
            continue
        section = section_after_anchor(html, fragment)
        if section is None:
            unresolved += 1
            continue
        ok, why = _roster_matches(section, motion)
        if not ok:
            roster_mismatch += 1
            if len(problems) < 6:
                problems.append(f"  motion {r['motionId']} at {fragment}: {why}")

    # How much of the corpus the roster oracle can and cannot separate.
    indistinguishable = _indistinguishable_sibling_count(by_id)

    detail.append(
        f"{checked} per-motion anchors checked: {key_mismatch} wrong-ordinal, "
        f"{roster_mismatch} roll-call mismatch, {unresolved} unresolvable"
    )
    detail.append(
        f"  sibling pairs the ROSTER oracle alone could not separate (identical item, "
        f"result AND roll call): {indistinguishable} — separated by the ordinal instead"
    )
    detail.extend(problems[:6])
    return (key_mismatch == 0 and roster_mismatch == 0 and unresolved == 0), detail


def _find_sibling_swap(rows, by_id):
    """Pick a published row whose motion has a same-item sibling, preferring
    one that shares an identical result string — the blind set a
    result-text oracle provably cannot see."""
    by_item = {}
    for m in by_id.values():
        if m["procedural"]:
            continue
        by_item.setdefault((m["meetingSlug"], normalize_item_number(m["itemNumber"])), []).append(m)
    published = {r["motionId"] for r in rows if r["anchor"] and "#motion-" in r["anchor"]}
    best = None
    for r in rows:
        m = by_id.get(r["motionId"])
        if m is None or r["motionId"] not in published:
            continue
        siblings = [
            s
            for s in by_item.get((m["meetingSlug"], normalize_item_number(m["itemNumber"])), [])
            if s["id"] != m["id"]
        ]
        for s in siblings:
            cand = {
                "motionId": m["id"],
                "sibling_anchor": motion_anchor_id(s["itemNumber"], s["rollCallOrdinal"]),
                "same_result": s["result"] == m["result"],
            }
            if cand["same_result"]:
                return cand
            best = best or cand
    return best


NAME_IN_LINK = re.compile(r'<a[^>]*href="[^"]*/councillors/[^"]*"[^>]*>([^<]+)</a>')


def _roster_matches(section_html: str, motion: dict):
    """Compare the anchored section's rendered roll call to the motion's own
    yea/nay arrays. Unanimous motions render a count, not names."""
    if motion["unanimous"]:
        expected = f"({len(motion['yeas'])}-0)"
        return (expected in section_html), f"unanimous marker {expected} absent"
    yea_block = re.search(r"Yea \((\d+)\):(.*?)(?:Nay \(|Absent \(|</details>)", section_html, re.S)
    nay_block = re.search(r"Nay \((\d+)\):(.*?)(?:Absent \(|Yea \(|</details>)", section_html, re.S)
    if motion["yeas"]:
        if not yea_block:
            return False, "no Yea roll call in the anchored section"
        names = set(NAME_IN_LINK.findall(yea_block.group(2))) or set()
        raw = yea_block.group(2)
        missing = [n for n in motion["yeas"] if n not in names and n not in raw]
        if int(yea_block.group(1)) != len(motion["yeas"]) or missing:
            return (
                False,
                f"Yea list is {yea_block.group(1)} name(s) and misses {missing[:3]}, "
                f"motion has {len(motion['yeas'])}",
            )
    if motion["nays"]:
        if not nay_block:
            return False, "no Nay roll call in the anchored section"
        names = set(NAME_IN_LINK.findall(nay_block.group(2))) or set()
        raw = nay_block.group(2)
        missing = [n for n in motion["nays"] if n not in names and n not in raw]
        if int(nay_block.group(1)) != len(motion["nays"]) or missing:
            return (
                False,
                f"Nay list is {nay_block.group(1)} name(s) and misses {missing[:3]}, "
                f"motion has {len(motion['nays'])}",
            )
    return True, ""


def _indistinguishable_sibling_count(by_id):
    by_item = {}
    for m in by_id.values():
        if m["procedural"]:
            continue
        by_item.setdefault((m["meetingSlug"], normalize_item_number(m["itemNumber"])), []).append(m)
    count = 0
    for group in by_item.values():
        if len(group) < 2:
            continue
        seen = {}
        for m in group:
            sig = (m["result"], tuple(sorted(m["yeas"])), tuple(sorted(m["nays"])))
            if sig in seen:
                count += 1
            seen[sig] = m["id"]
    return count


def check_non_disruption(negative=False):
    """Not one auto-generated heading id may change: those are what already
    published links point at, and github-slugger's -1/-2 suffixes shift with
    document order."""
    detail = []
    if not os.path.isdir(os.path.join(PUBLIC, "months")):
        return False, ["public/months missing — run npm run build before this check"]
    with open(HEADING_BASELINE, encoding="utf-8") as fh:
        baseline = json.load(fh)["digests"]

    current = {}
    for root, _dirs, files in os.walk(os.path.join(PUBLIC, "months")):
        for name in files:
            if not name.endswith(".html"):
                continue
            path = os.path.join(root, name)
            with open(path, "rb") as fh:
                html = fh.read()
            ids = [m.group(2).decode("utf-8") for m in HEADING_ID.finditer(html)]
            if negative:
                # The hazard this guards: an anchor written ONTO a heading
                # instead of beside it, which rewrites that heading's id and
                # shifts every later duplicate suffix.
                ids = [i if not i.startswith("8") else "motion-injected" for i in ids]
            current[os.path.relpath(path, PUBLIC)] = hashlib.sha256(
                "\n".join(ids).encode()
            ).hexdigest()[:16]

    changed = [p for p in baseline if p in current and current[p] != baseline[p]]
    vanished = [p for p in baseline if p not in current]
    detail.append(
        f"{len(baseline)} baseline pages, {len(current)} built now: "
        f"{len(changed)} page(s) with a changed heading-id stream, {len(vanished)} vanished"
    )
    for p in changed[:5]:
        detail.append(f"  CHANGED {p}")
    for p in vanished[:5]:
        detail.append(f"  VANISHED {p}")
    return (not changed and not vanished), detail


def check_fallback_conservation(negative=False):
    """The honest fallback may only shrink, and no row may move out of it
    onto an anchor that has not been position-oracle verified."""
    detail = []
    rows = hub_rows()
    ambiguous_rows = [r for r in rows if r["anchorAmbiguous"]]
    ambiguous_motions = {r["motionId"] for r in ambiguous_rows}
    unverified = [r for r in rows if r["anchor"] and "#" in r["anchor"] and not r["anchorPrecise"]]
    if negative:
        ambiguous_motions = set(range(FALLBACK_BASELINE_MOTIONS + 1))
        detail.append("NEGATIVE: pretending the fallback population grew past its baseline")
    detail.append(
        f"fallback: {len(ambiguous_motions)} distinct motions (baseline {FALLBACK_BASELINE_MOTIONS}), "
        f"{len(ambiguous_rows)} rows (baseline {FALLBACK_BASELINE_ROWS})"
    )
    detail.append(
        f"rows carrying a fragment that is NOT a verified per-motion anchor: {len(unverified)}"
    )

    # The fallback is dormant on today's corpus, not retired. Assert the
    # code path and its disclosure are still present, so a future tidy-up
    # cannot delete the only honest outcome for a motion that genuinely has
    # no anchor (pre-2018 minutes carry no Votes section at all).
    with open(os.path.join(REPO, "scripts", "election", "generate-hub-pages.ts"), encoding="utf-8") as fh:
        hub_src = fh.read()
    with open(os.path.join(REPO, "scripts", "election", "anchors.ts"), encoding="utf-8") as fh:
        anchors_src = fh.read()
    disclosure_present = "links to the meeting page" in hub_src
    resolver_present = "ambiguous: true" in anchors_src
    test_present = os.path.exists(
        os.path.join(REPO, "scripts", "election", "anchors-fallback.test.ts")
    )
    detail.append(
        f"fallback path intact: disclosure in hub renderer={disclosure_present}, "
        f"ambiguous branch in anchors.ts={resolver_present}, unit test present={test_present}"
    )

    grew = len(ambiguous_motions) > FALLBACK_BASELINE_MOTIONS
    return (
        not grew
        and not unverified
        and disclosure_present
        and resolver_present
        and test_present
    ), detail


def check_verifier_mutation(negative=False):
    """Per the repo's standing rule, verify the mutation: flip one published
    anchor to a sibling's fragment and require the position oracle to catch
    it. A suite that still passes is not evidence.

    `--negative verifier-mutation` inverts it: run the same swap and demand
    the oracle NOT notice, which must fail."""
    ok, detail = check_position_oracle(negative=True)
    caught = not ok
    lines = ["mutation: one published anchor swapped to a same-item sibling"]
    lines.extend(detail)
    lines.append(f"position oracle {'CAUGHT it' if caught else 'MISSED it'}")
    return (caught if not negative else not caught), lines


def check_manifest_diff(negative=False):
    """The committed manifest is the bookmark-rot tripwire: every anchor it
    lists must still be on the page it names, and nothing may have silently
    changed target. Retirements are allowed but must be declared."""
    detail = []
    man = manifest()
    live = man["anchors"]
    retired = man.get("retired", [])

    on_disk = {}
    for path in markdown_files():
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        on_disk[path] = set(ANCHOR_IN_MD.findall(body))

    # Re-derive from the motion data, which is what the emitter does.
    derived = set()
    for m in motions():
        if m["procedural"]:
            continue
        derived.add((m["meetingSlug"], motion_anchor_id(m["itemNumber"], m["rollCallOrdinal"])))
    declared = {(a["meetingSlug"], a["anchorId"]) for a in live}
    if negative:
        declared = {(s, a + "-tampered") for s, a in declared}
        detail.append("NEGATIVE: every manifest entry re-pointed at a fabricated id")

    lost = declared - derived
    added = derived - declared
    detail.append(
        f"manifest: {len(live)} live anchors, {len(retired)} retired; "
        f"re-derived {len(derived)} from motion data"
    )
    detail.append(
        f"  in manifest but no longer derivable (would be bookmark rot): {len(lost)}; "
        f"derivable but not in manifest (unrecorded): {len(added)}"
    )
    for s, a in list(lost)[:4]:
        detail.append(f"  LOST {a} on {s}")
    for s, a in list(added)[:4]:
        detail.append(f"  UNRECORDED {a} on {s}")

    all_ids = set()
    for ids in on_disk.values():
        all_ids |= ids
    missing_on_page = {a["anchorId"] for a in live} - all_ids
    detail.append(f"  manifest anchors not found on any meeting page: {len(missing_on_page)}")
    return (not lost and not added and not missing_on_page), detail


FORBIDDEN_INPUTS = ["itemTitle", "motionText", "headingText", "resultText", "tally", "motion.id"]


def check_no_text_derivation(negative=False):
    """A future edit must not be able to quietly feed a volatile input back
    into the anchor. The key is defined in exactly one file; assert that
    file mentions none of the churn-prone fields inside its code."""
    detail = []
    target = os.path.join(REPO, "scripts", "motion-anchor.ts")
    with open(target, encoding="utf-8") as fh:
        source = fh.read()
    # Strip block comments: the module doc EXPLAINS why these fields are
    # excluded, so naming them there is the point, not a violation.
    code = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    code = re.sub(r"//.*", "", code)
    if negative:
        code += "\nconst bad = motionText + itemTitle;\n"
        detail.append("NEGATIVE: a volatile input spliced back into the key's source file")
    hits = [f for f in FORBIDDEN_INPUTS if f in code]
    detail.append(f"scripts/motion-anchor.ts code (comments stripped): forbidden inputs found: {hits or 'none'}")

    # And the emitter must build the id only through the shared helper.
    emitter = os.path.join(REPO, "scripts", "add-votes-to-pages.ts")
    with open(emitter, encoding="utf-8") as fh:
        emitter_src = fh.read()
    calls = re.findall(r"motionAnchorId\(([^)]*)\)", emitter_src)
    bad_calls = [c for c in calls if "motionText" in c or "itemTitle" in c or "result" in c]
    detail.append(
        f"emitter calls motionAnchorId({', '.join(c.strip() for c in calls) or 'never'}); "
        f"{len(bad_calls)} call(s) pass a volatile field"
    )
    return (not hits and not bad_calls and len(calls) == 1), detail


CHECKS = [
    ("uniqueness", check_uniqueness),
    ("idempotence", check_idempotence),
    ("churn-replay", check_churn_replay),
    ("resolution", check_resolution),
    ("position-oracle", check_position_oracle),
    ("non-disruption", check_non_disruption),
    ("fallback-conservation", check_fallback_conservation),
    ("verifier-mutation", check_verifier_mutation),
    ("manifest-diff", check_manifest_diff),
    ("no-text-derivation", check_no_text_derivation),
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", help="run one check by name")
    ap.add_argument("--negative", help="run one check in its negative direction (must FAIL)")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for name, _ in CHECKS:
            print(name)
        return 0

    if args.negative:
        chosen = dict(CHECKS).get(args.negative)
        if not chosen:
            print(f"unknown check: {args.negative}")
            return 2
        ok, detail = chosen(negative=True)
        for line in detail:
            print(line)
        if ok:
            print(f"NEGATIVE TEST FAILED: {args.negative} passed with the defect injected — it is vacuous")
            return 1
        print(f"NEGATIVE TEST OK: {args.negative} correctly rejected the injected defect")
        return 0

    to_run = CHECKS if not args.only else [(n, f) for n, f in CHECKS if n == args.only]
    if not to_run:
        print(f"unknown check: {args.only}")
        return 2

    failed = []
    for name, fn in to_run:
        ok, detail = fn()
        print(f"[{'PASS' if ok else 'FAIL'}] {name}")
        for line in detail:
            print(f"    {line}")
        if not ok:
            failed.append(name)

    print()
    if failed:
        print(f"{len(failed)} check(s) FAILED: {', '.join(failed)}")
        return 1
    print(f"All {len(to_run)} evidence-anchor precision check(s) passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
