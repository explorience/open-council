#!/usr/bin/env python3
"""Re-key classification-layer motion ids after upstream id churn.

Motion ids in data/votes/_all-motions.json derive from content that upstream
regeneration can legitimately change (motion-text cap changes, roll-call
un-merging, nightly re-scrapes, extractMotionText fixes). The classification
layer under data/election/classify/ keys by those ids, so churn silently
breaks the join and classified motions fall back to "unclassified".

This script migrates every classify-layer id to its current corpus id using
stable natural keys, in four tiers:
  1. (date, meetingSlug, itemNumber, result) unique match
  2. same key ambiguous -> disambiguate by matching the entry's verbatim
     quote (or the manifest's itemTitle as a fallback probe) against each
     candidate's FULL, uncapped motion text, loaded fresh from the raw
     meeting JSON (meetingSlug -> data/YYYY-MM/<file>.json -> the item at
     that dotted itemNumber path -> the vote-bearing content entry at that
     candidate's own rollCallOrdinal) -- never the capped motionText copy
     in _all-motions.json, which can truncate or reshape exactly the span
     a quote falls in and produce false negatives/positives. Each candidate
     carries its own rollCallOrdinal (part of the current id's hash input),
     so this is a precise per-candidate lookup, not a positional guess.
  3. still ambiguous at the SAME natural key -> if the count of still-
     unresolved old ids at that key equals the count of still-unclaimed
     current candidates at that key (a genuine bijective group, e.g. an
     "amend clause j)" motion and the "approve part j) as amended" motion
     that necessarily recite the same clause text, so quote-matching alone
     can't separate them), pair them off by ascending order: current
     candidates by rollCallOrdinal, old ids by their position in the
     classify batch file they were first read from.
  4. anything still unresolved is left untouched and listed in
     rekey-unresolved-<stamp>.json for manual review (excluding returning-
     manifest.json's un-classified intake ids, which are never resolve()'d
     at all - see the FINDING-5 comment at the main scan loop)

The full old->new mapping is written to rekey-map-<stamp>.json so the
migration is auditable and reversible. NOTE: a single invocation's map file
holds only what THAT run changed, not the full history - a corpus that
still has old ids left after tier 1-3 within one run (tier 3's own output
can occasionally unlock a tier-1/2 match tier 3 itself couldn't see yet
this same run, since collision-rematch corrections land after tier 3 -
see the FINDING-1 comment below) may need a second invocation with the
SAME stamp to reach a fixed point; a run that changes nothing (0 mapped,
0 references) confirms the fixed point was reached. reconcile-rekey.py
verifies the final state, not any one run's delta.

COLLISION HANDLING: id churn can also make what were N distinct pre-churn
motions converge on ONE current id (a genuine motion merge upstream, e.g.
two roll calls that regenerate as a single vote row). generate-stances.ts's
loadVerifiedClassifications() throws on any duplicate id across
batch-*-verified.json ("classify batches must be disjoint"), so a collision
left unresolved crashes generation outright. For every current id more than
one classify entry converges on, exactly one entry is kept -- precedence:
(1) the entry whose pre-rekey id is referenced by a corrections.json row,
(2) else the entry from the returning batch (batch-returning-verified.json),
(3) else the first encountered in sorted file order -- and the rest are
removed from their batch-*-verified.json (and, for consistency, the sibling
batch-*-classified.json) file. Any corrections.json row keyed to a removed
entry's pre-rekey id is now moot (it documents a fix to that specific
vanished entry's field values, which generally will not even validate
against the survivor's current values -- see applyCorrections' stale-
correction check in generate-stances.ts) and is dropped from corrections.json,
not silently re-pointed at the survivor. Every dropped entry and its dropped
corrections rows are recorded in rekey-deduped-<stamp>.json, in the same
{id, removed_from, kept_in, moot_corrections_dropped, note} shape #201
established by hand for the one collision it hit.

After every rewrite, the script asserts no duplicate id remains across all
batch-*-verified.json files -- the same invariant generate-stances.ts
enforces at load time -- so a logic error here fails loudly at rekey time
instead of at generation time.

Run with the date stamp as argv[1].
"""
import json, glob, os, re, sys

STAMP = sys.argv[1] if len(sys.argv) > 1 else "unstamped"
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
CLS = os.path.join(BASE, "data", "election", "classify")

VERIFIED_RE = re.compile(r"^batch-(\d+|returning)-verified\.json$")
CLASSIFIED_RE = re.compile(r"^batch-(\d+|returning)-classified\.json$")

am = json.load(open(os.path.join(BASE, "data", "votes", "_all-motions.json")))["motions"]
cur_ids = {m["id"] for m in am}
nat = {}
for m in am:
    key = (m.get("date"), m.get("meetingSlug"), str(m.get("itemNumber")), m.get("result"))
    nat.setdefault(key, []).append(m)

manifest = {}
for mf in ("manifest.json", "returning-manifest.json"):
    p = os.path.join(CLS, mf)
    if os.path.exists(p):
        j = json.load(open(p))
        manifest.update(j.get("motions") if isinstance(j.get("motions"), dict) else
                        {e["id"]: e for e in (j.get("motions") or j.get("batches") or []) if isinstance(e, dict)})

# entries' quotes help disambiguate; collect per id from batch files
quotes = {}
for f in glob.glob(os.path.join(CLS, "batch-*-verified.json")) + glob.glob(os.path.join(CLS, "batch-*-classified.json")):
    for e in json.load(open(f)):
        q = e.get("quote")
        if q and e.get("id") not in quotes:
            quotes[e["id"]] = q

# ---------------------------------------------------------------------------
# Full, uncapped motion text lookup straight from the raw meeting JSON --
# mirrors scripts/generate-votes.ts's extractMotionText() exactly, minus the
# MAX_MOTION_TEXT_LENGTH cap/truncation marker, since this exists precisely
# to see past that cap.
# ---------------------------------------------------------------------------
_RAW_MEETING_CACHE = {}

def load_raw_meeting(meeting_slug):
    if meeting_slug in _RAW_MEETING_CACHE:
        return _RAW_MEETING_CACHE[meeting_slug]
    rel = meeting_slug[len("months/"):] if meeting_slug.startswith("months/") else meeting_slug
    path_ = os.path.join(BASE, "data", rel + ".json")
    data = None
    if os.path.exists(path_):
        try:
            data = json.load(open(path_, encoding="utf-8"))
        except Exception:
            data = None
    _RAW_MEETING_CACHE[meeting_slug] = data
    return data

def extract_full_text(content):
    parts = []
    for t in (content.get("motion_texts") or []):
        parts.append(t.get("string", ""))
    for t in (content.get("pre_motion_texts") or []):
        parts.append(t.get("string", ""))
    if content.get("__class__") == "Paragraph" and content.get("string"):
        parts.append(content["string"])
    return " ".join(parts)

def get_full_motion_text(meeting_slug, item_number, roll_call_ordinal):
    """Full text of the vote-bearing content entry at item_number's dotted
    path (e.g. "3.6" -> items["3"]["items"]["6"]), the roll_call_ordinal-th
    one found in that item's own content list (matching findVotes'
    per-item rollCallOrdinal counter in generate-votes.ts). Returns None if
    the raw file, item path, or ordinal can't be resolved."""
    if roll_call_ordinal is None:
        return None
    meeting = load_raw_meeting(meeting_slug)
    if meeting is None:
        return None
    cur = meeting.get("items") or {}
    item = None
    for part in str(item_number).split("."):
        item = cur.get(part) if isinstance(cur, dict) else None
        if item is None:
            return None
        cur = item.get("items") or {}
    content_list = item.get("content") or []
    ordinal = 0
    for c in content_list:
        # generate-votes.ts's findVotes() counts this content entry as a
        # roll call ("if (content.vote && content.vote.rows)") the moment
        # BOTH keys are present, even when rows is an empty array - a JS
        # array, even empty, is truthy. `c["vote"].get("rows")` alone would
        # be falsy on [] in Python and silently skip these slots, shifting
        # every ordinal after the first one out of alignment with the
        # ordinal actually stored on the current motion records.
        vote = c.get("vote")
        if vote is not None and vote.get("rows") is not None:
            if ordinal == roll_call_ordinal:
                return extract_full_text(c)
            ordinal += 1
    return None

_WS_RE = re.compile(r"\s+")

def _norm_ws(s):
    """Collapse all whitespace (including eSCRIBE's literal U+00A0
    non-breaking spaces, e.g. "j) \\xa0resting...") to single ASCII spaces.
    A classify entry's stored quote was typically extracted through a path
    that already normalized \\xa0 to a plain space (sometimes doubled, where
    the source had "word\\xa0word" and the extractor emitted "word  word"),
    while the raw meeting JSON keeps the literal \\xa0 - an exact substring
    match on either side alone silently fails on an otherwise-correct,
    otherwise-unique quote."""
    return _WS_RE.sub(" ", s).strip()

def disambiguate(old_id, mm, hits):
    """Tier 2: multiple natural-key candidates. Try, in order of
    specificity, the full verbatim quote against each candidate's own full
    (uncapped) raw text, then progressively shorter probes/fallbacks -
    returning the single candidate whose text contains the probe, or None
    if zero or multiple match. Both sides are whitespace-normalized first
    (see _norm_ws) since exact-byte matching is too strict across eSCRIBE's
    \\xa0 vs a quote-extraction path that already flattened it to spaces."""
    quote = quotes.get(old_id)
    item_title = mm.get("itemTitle") or ""
    probes = [p for p in (quote, quote[:80] if quote else None, quote[:40] if quote else None, item_title[:60]) if p]
    probes = [_norm_ws(p) for p in probes]
    for probe in probes:
        if not probe:
            continue
        scored = []
        for h in hits:
            full_text = get_full_motion_text(h.get("meetingSlug"), h.get("itemNumber"), h.get("rollCallOrdinal"))
            text = full_text if full_text is not None else (h.get("motionText") or "")
            if probe in _norm_ws(text):
                scored.append(h)
        if len(scored) == 1:
            return scored[0]
    return None

mapping, unresolved = {}, []
_unresolved_ids = set()  # same old_id is referenced from several classify
# files (manifest.json, batch-*-verified/classified.json, corrections.json,
# ...) and resolve() runs once per reference - dedupe by id so one
# unresolvable motion doesn't inflate the audit file into many identical rows.
_ambiguous_ids = set()  # tier-1/tier-2 failed but tier-3 (bijective ordinal,
# below) hasn't been tried yet - kept separate from _unresolved_ids so a
# later successful tier-3 assignment isn't blocked by the same early-return
# guard that (correctly) prevents re-processing a truly unresolved id.
ambiguous_pending = {}  # natural key -> [old_id, ...] still needing tier 3

def resolve(old_id):
    if old_id in cur_ids or old_id in mapping or old_id in _unresolved_ids or old_id in _ambiguous_ids:
        return
    mm = manifest.get(old_id)
    if not mm:
        _unresolved_ids.add(old_id)
        unresolved.append({"id": old_id, "reason": "not in any manifest"})
        return
    key = (mm["date"], mm["meetingSlug"], str(mm["itemNumber"]), mm["result"])
    hits = nat.get(key, [])
    if len(hits) == 1:
        mapping[old_id] = hits[0]["id"]
        return
    if len(hits) > 1:
        winner = disambiguate(old_id, mm, hits)
        if winner is not None:
            mapping[old_id] = winner["id"]
            return
        # Tier 2 (quote) couldn't pick a single winner among the natural-key
        # (incl. result) candidates - don't give up yet. Defer to tier 3
        # (bijective ordinal, run once after every old_id has had a first
        # pass) instead of unresolving immediately.
        _ambiguous_ids.add(old_id)
        ambiguous_pending.setdefault(key, []).append(old_id)
        return
    _unresolved_ids.add(old_id)
    unresolved.append({"id": old_id, "reason": "no natural-key match", "key": list(key)})

targets = sorted(
    f for f in glob.glob(os.path.join(CLS, "*.json"))
    # Idempotency fix (2026-09-02 fixer round): rekey-*-<stamp>.json files
    # are this script's OWN OUTPUT artifacts (rekey-map, rekey-unresolved,
    # rekey-deduped, rekey-collision-rematches), not classify input data -
    # rekey-collision-rematches-<stamp>.json in particular stores its "id"
    # field as the OLD (pre-rekey) id by design, for audit readability.
    # Globbing them into `targets` alongside real classify files let a
    # PRIOR run's own output feed back into THIS run's resolve() scan,
    # re-deriving "not in any manifest" for ids whose manifest.json key had
    # already been correctly renamed away - silent non-determinism across
    # reruns on an unchanged corpus, caught by running this script twice in
    # a row and diffing rekey-unresolved-<stamp>.json. Every consumer of
    # `targets` below (doc-order, resolve-scan, write-back) must only ever
    # see real classify data.
    if not os.path.basename(f).startswith("rekey-")
)
# Finding-5 (2026-09-02 fixer round): returning-manifest.json's "motions"
# is a flat LIST, not the {id: entry} dict manifest.json uses - its own
# note says why: it's a pure INTAKE list for a future classify batch,
# "None of these has ever had an entry in
# data/election/classify/batch-*-verified.json ... classification has not
# yet been run." No generator (generate-stances.ts reads only batch-*-
# verified.json + corrections.json) has ever consumed these 82 ids, so
# resolve()-ing them now is speculative work with a real cost: since they
# never get written to any file (nothing here persists their outcome),
# their resolution can't even be pinned down by _baseline_claimed the way
# every real classify entry's can, which was observed to make their
# individual outcomes flip between runs on an otherwise-unchanged corpus -
# exactly the kind of non-determinism a rekey audit must not produce.
# Leave them alone entirely; a future classify batch that actually adopts
# one of these ids brings it into a real batch-*-verified.json file, where
# the normal scan below picks it up and resolves it for real.
for f in targets:
    if os.path.basename(f) == "returning-manifest.json":
        continue
    j = json.load(open(f))
    items = j if isinstance(j, list) else None
    if items is None and isinstance(j, dict):
        items = j.get("motions") if isinstance(j.get("motions"), list) else None
    scan = items if items is not None else []
    if isinstance(j, dict) and isinstance(j.get("motions"), dict):
        for oid in list(j["motions"].keys()):
            resolve(oid)
    for e in scan:
        if isinstance(e, dict) and "id" in e:
            resolve(e["id"])

# ---------------------------------------------------------------------------
# Tier 3 (bijective ordinal): for every natural key where tier 1 (unique
# hit) and tier 2 (quote) both failed to place every waiting old_id, check
# whether the SAME key's remaining unclaimed current candidates (hits minus
# whatever tier 1/2 already assigned elsewhere for this exact key) is the
# same size as the remaining unresolved old_id list. If so, this is a
# genuine bijective group (N unresolved olds <-> N unclaimed candidates,
# e.g. an amendment/ladder pair like "amend clause j)" + "approve part j)
# as amended" that both recite the same clause verbatim, so quote-matching
# alone can't separate them) - pair them off by ascending order: current
# candidates by rollCallOrdinal, old ids by their position in the classify
# batch file they were first read from (a stand-in for original meeting
# document order, which tracks roll-call order for entries sharing one
# natural key - see the module docstring's KEY UNLOCK). Anything left over
# (group sizes don't match) is genuinely unresolved and reported as such.
# ---------------------------------------------------------------------------
_doc_order = {}
for _fi, _f in enumerate(targets):
    _j = json.load(open(_f))
    _items = _j if isinstance(_j, list) else (_j.get("motions") if isinstance(_j, dict) and isinstance(_j.get("motions"), list) else None)
    for _pos, _e in enumerate(_items or []):
        if isinstance(_e, dict) and "id" in _e and _e["id"] not in _doc_order:
            _doc_order[_e["id"]] = (_fi, _pos)

# "Claimed" must mean every current id ANY classify entry currently
# resolves to - not just set(mapping.values()), which only holds ids this
# run's resolve() actually touched. On a corpus where most entries are
# already current from an earlier stamp (the common case for a re-run),
# mapping.values() alone silently omits the vast majority of in-use ids,
# making tier 3 think slots are free when a live, untouched entry already
# holds them - a live, latent duplicate-assignment risk that the final
# invariant check can't even see for ids that never get written into a
# verified file (e.g. returning-manifest.json's un-classified intake list).
# _baseline_claimed captures every already-current id sitting in a
# verified-batch entry BEFORE this run touched anything.
VERIFIED_RE_EARLY = re.compile(r"^batch-(\d+|returning)-verified\.json$")
_baseline_claimed = set()
for _f in targets:
    if not VERIFIED_RE_EARLY.match(os.path.basename(_f)):
        continue
    for _e in json.load(open(_f)):
        if isinstance(_e, dict) and _e.get("id") in cur_ids:
            _baseline_claimed.add(_e["id"])

def _ordinal_key(h):
    o = h.get("rollCallOrdinal")
    return o if o is not None else float("inf")

bijective_resolved = 0
for _key, _old_ids in ambiguous_pending.items():
    _hits = nat.get(_key, [])
    _claimed = _baseline_claimed | set(mapping.values())
    _unclaimed = [h for h in _hits if h["id"] not in _claimed]
    if _old_ids and len(_old_ids) == len(_unclaimed):
        _old_sorted = sorted(_old_ids, key=lambda oid: _doc_order.get(oid, (10**9, 0)))
        _hit_sorted = sorted(_unclaimed, key=_ordinal_key)
        for _oid, _h in zip(_old_sorted, _hit_sorted):
            mapping[_oid] = _h["id"]
            _ambiguous_ids.discard(_oid)
            bijective_resolved += 1
    else:
        for _oid in _old_ids:
            _ambiguous_ids.discard(_oid)
            _unresolved_ids.add(_oid)
            unresolved.append({
                "id": _oid,
                "reason": (
                    f"ambiguous ({len(_hits)} candidates), bijective tier failed "
                    f"({len(_old_ids)} unresolved old id(s) vs {len(_unclaimed)} unclaimed candidate(s))"
                ),
                "key": list(_key),
            })
if bijective_resolved:
    print(f"tier 3 (bijective ordinal): resolved {bijective_resolved} id(s)")

# ---------------------------------------------------------------------------
# Finding-6 (2026-09-02 fixer round): verifierNote/whatAYeaDid prose quotes
# other motion ids by hand (e.g. "same genuine ambiguity as 86419cffb57c",
# "distinct real motion from c0e0eab57589's amendment vote", "Duplicate of
# 9daa4ae88f7d's compensation-formula update") - these 12-hex tokens are id
# churn's last blind spot: every prior rekey pass rewrote the `id` FIELD but
# never looked inside free text, so 100% of these references went stale
# across a single regeneration (measured: 251 tokens found across
# verifierNote/whatAYeaDid, only 40 already pointing at a still-live current
# id). The overwhelming majority reference an id from an EARLIER rekey/dedup
# generation than this one - already gone from manifest.json's currently-
# tracked keys by the time this script runs, so gating on "this corpus's
# currently-known id universe" (an earlier, more conservative version of
# this function) missed 211 of them. A bare 12-hex token, whole-word, inside
# these two specific, always-technical audit-note fields is not meaningfully
# ambiguous with prose - annotate every one that isn't a live current id and
# isn't in this run's own mapping, full stop.
# ---------------------------------------------------------------------------
ID_TOKEN_RE = re.compile(r"\b[0-9a-f]{12}\b")
_SUPERSEDED_SUFFIX = " (superseded id)"

def rewrite_text_ids(s):
    def _sub(m):
        tok = m.group(0)
        if tok in mapping:
            return mapping[tok]
        if tok in cur_ids:
            return tok
        already = s[m.end():m.end() + len(_SUPERSEDED_SUFFIX)] == _SUPERSEDED_SUFFIX
        return tok if already else tok + _SUPERSEDED_SUFFIX
    return ID_TOKEN_RE.sub(_sub, s)

def rewrite(obj):
    changed = 0
    if isinstance(obj, list):
        for e in obj:
            changed += rewrite(e)
    elif isinstance(obj, dict):
        if "id" in obj and obj["id"] in mapping:
            obj["id"] = mapping[obj["id"]]
            changed += 1
        for _tk in ("verifierNote", "whatAYeaDid"):
            if isinstance(obj.get(_tk), str):
                _new = rewrite_text_ids(obj[_tk])
                if _new != obj[_tk]:
                    obj[_tk] = _new
                    changed += 1
        if isinstance(obj.get("motions"), dict):
            newm = {}
            for oid, v in obj["motions"].items():
                nid = mapping.get(oid, oid)
                if nid != oid:
                    changed += 1
                if isinstance(v, dict) and v.get("id") == oid:
                    v["id"] = nid
                newm[nid] = v
            obj["motions"] = newm
        if isinstance(obj.get("batches"), list):
            for b in obj["batches"]:
                if isinstance(b, list):
                    for i, oid in enumerate(b):
                        if oid in mapping:
                            b[i] = mapping[oid]
                            changed += 1
        for k, v in obj.items():
            if k not in ("id", "motions", "batches") and isinstance(v, (dict, list)):
                changed += rewrite(v)
    return changed

# ---------------------------------------------------------------------------
# Collision resolution, BEFORE the general rewrite pass below: find every
# current id more than one verified-batch entry converges on, keep exactly
# one, and strip corrections.json rows keyed to the entries being dropped
# (their pre-rekey id) so they don't survive as stale/moot rows.
# ---------------------------------------------------------------------------
verified_files = [f for f in targets if VERIFIED_RE.match(os.path.basename(f))]
classified_files = [f for f in targets if CLASSIFIED_RE.match(os.path.basename(f))]
corrections_path = os.path.join(CLS, "corrections.json")
corrections_data = json.load(open(corrections_path)) if os.path.exists(corrections_path) else []
correction_ids = {c["id"] for c in corrections_data if isinstance(c, dict) and "id" in c}

verified_entries = {f: json.load(open(f)) for f in verified_files}
classified_entries = {f: json.load(open(f)) for f in classified_files}

id_to_locations = {}  # effective (current) id -> [(file, entry, old_id), ...]
for f, entries in verified_entries.items():
    for e in entries:
        if not isinstance(e, dict) or "id" not in e:
            continue
        old_id = e["id"]
        eff = mapping.get(old_id, old_id)
        id_to_locations.setdefault(eff, []).append((f, e, old_id))

# ---------------------------------------------------------------------------
# Finding-1 rework (2026-09-02 fixer round): a collision loser is NOT
# automatically a genuine motion merge. Tier 1/2 (natural key + result,
# then quote) can independently land two different pre-rekey old_ids on the
# SAME current id even when the current corpus still has a separate,
# unclaimed sibling motion for the loser - most often because the sibling
# candidate is itself a bare "approve part X)" / "Part X), as amended, BE
# APPROVED" wrapper whose own raw text doesn't recite the clause content,
# so it can never win tier 2's substring probe on its own merits. Before
# finalizing a drop, re-attempt the match against the loser's own natural
# key (already result-matched by construction of `key`/`nat`), restricted
# to candidates no other entry has already claimed (`claimed_ids`, refreshed
# per collision group so an earlier rematch in this same pass is respected).
#
# Where the loser's own quote can't decide it either (the wrapper-text
# problem above), fall back to a small hand-verified table. Each row here
# was confirmed against this corpus's own classify-batch verifierNote
# fields (written independently, before any of this round's id churn) that
# pin the loser to a specific raw content[] index or an exact verbatim
# match on the target's own wrapper text - see the per-row citation.
# Collisions NOT in this table, or whose sole unclaimed candidate isn't the
# table's target, still fall through to the drop-as-merge path below - i.e.
# "no unclaimed candidate" AND "an unclaimed candidate exists but neither
# quote nor the hand-verified table can confirm it" both still count as a
# true merge, exactly as loose as the original bug, just no longer silent
# about which is which (see rekey-collision-rematches-<stamp>.json).
# ---------------------------------------------------------------------------
HAND_VERIFIED_COLLISION_REMATCH = {
    # dfe87ddfc742's collision (2025-03-25 SPPC item 4.1, Mobility Master
    # Plan): loser's own verifierNote cites "content[13] ('Motion to
    # approve part a), as amended.', Passed 14-1)" by index verbatim -
    # f5d2c8a7250b is that item's rollCallOrdinal-13 motion.
    "478dc258ce7d": ("f5d2c8a7250b",
        "verifierNote pins this to item 4.1 content[13] ('Motion to approve "
        "part a), as amended.', Passed 14-1) by explicit index; the loser's "
        "quote (Bradley Ave clause) was reconstructed from content[10], the "
        "one amendment that ever touched part a) - not a duplicate of the "
        "survivor's own content[10] amendment vote."),
    # 82934bf94ea3's collision (2024-04-29 CPSC item 2.5, Core Area Parking
    # Incentives): loser's verifierNote cites "'Motion to approve parts a)
    # and b) of the clause' (2-2 FAILED)" verbatim - 25119154026c is that
    # exact wrapper (content[3]).
    "2c6d64497d4d": ("25119154026c",
        "verifierNote pins this to item 2.5 content[3] ('Motion to approve "
        "parts a) and b) of the clause', Failed 2-2) by exact wrapper-text "
        "quote; substantively distinct from the survivor's weekday-only "
        "narrowing amendment (content[2]) - loser is the un-narrowed, "
        "$300k-funded main motion."),
    # c0a130b2b91f's collision (2024-02-20 CPSC item 4.1, Regulation of the
    # Display of Graphic Images): loser's verifierNote cites "content[2],
    # Passed 4-1" and the receipt text names 5 communicants, matching the
    # loser's own "five public communications" wording exactly.
    "c58fcf1c3125": ("fc4e69d01fa8",
        "verifierNote pins this to item 4.1 content[2] (Passed 4-1, "
        "'noted... communications... were received') by explicit index; "
        "the 5 named senders in content[2]'s text match the loser's own "
        "'five public communications' wording. Substantively distinct from "
        "the survivor's referral-back-to-Administration vote."),
    # 82920ae88a00's collision (2023-10-10 SPPC item 4.4, Establishing Homes
    # Ontario): loser's verifierNote explicitly names the target text
    # verbatim - "the standalone 'Part b), as amended, BE APPROVED' vote
    # (Passed 7-6)" - which is 456e873da7c2's own raw wrapper text, word for
    # word, distinct from the survivor's combined parts-b+c amendment vote.
    "afa632a6cb38": ("456e873da7c2",
        "verifierNote names the target verbatim - \"the standalone 'Part "
        "b), as amended, BE APPROVED' vote (Passed 7-6)\" - which is "
        "456e873da7c2's exact raw wrapper text; loser's quote was "
        "reconstructed from the survivor's own amendment content (part b's "
        "declared text) the same way 478dc258ce7d's was, not evidence the "
        "two are the same roll call."),
}

def find_collision_rematch(old_id, e, mm, claimed_ids):
    if not mm:
        return None
    key = (mm["date"], mm["meetingSlug"], str(mm["itemNumber"]), mm["result"])
    hits = nat.get(key, [])
    unclaimed = [h for h in hits if h["id"] not in claimed_ids]
    if not unclaimed:
        return None
    quote = e.get("quote")
    if quote:
        probe = _norm_ws(quote)
        matched = [
            h for h in unclaimed
            if probe in _norm_ws(get_full_motion_text(h.get("meetingSlug"), h.get("itemNumber"), h.get("rollCallOrdinal")) or (h.get("motionText") or ""))
        ]
        if len(matched) == 1:
            return matched[0]["id"]
    override = HAND_VERIFIED_COLLISION_REMATCH.get(old_id)
    if override and any(h["id"] == override[0] for h in unclaimed):
        return override[0]
    return None

rematch_records = []

def loc_rank(loc, survivor_file_hint=None):
    f, e, old_id = loc
    in_corrections = old_id in correction_ids
    is_returning = os.path.basename(f).startswith("batch-returning-")
    return (0 if in_corrections else 1, 0 if is_returning else 1)

dedup_records = []
drop_old_ids_by_verified_file = {}  # file -> set(old_id)
drop_old_ids_global = set()         # every dropped old_id, for the classified mirror + corrections filter
dropped_correction_obj_ids = set()  # id() of correction dict rows to remove

for eff_id, locs in id_to_locations.items():
    if len(locs) <= 1:
        continue
    ordered = sorted(locs, key=loc_rank)
    survivor = ordered[0]
    losers = ordered[1:]
    survivor_reason = (
        "referenced by corrections.json" if survivor[2] in correction_ids else
        "from the returning batch" if os.path.basename(survivor[0]).startswith("batch-returning-") else
        "first encountered"
    )
    for loser in losers:
        f, e, old_id = loser
        rematch_target = find_collision_rematch(old_id, e, manifest.get(old_id), _baseline_claimed | set(mapping.values()))
        if rematch_target is not None:
            mapping[old_id] = rematch_target
            _, rematch_note = HAND_VERIFIED_COLLISION_REMATCH.get(old_id, (None, "resolved via quote match against an unclaimed same-key candidate"))
            rematch_records.append({
                "id": old_id,
                "was_colliding_into": eff_id,
                "rematched_to": rematch_target,
                "note": rematch_note,
            })
            continue  # not a merge - leave this entry in place, general rewrite pass below re-keys it
        drop_old_ids_by_verified_file.setdefault(f, set()).add(old_id)
        drop_old_ids_global.add(old_id)
        loser_corrections = [c for c in corrections_data if isinstance(c, dict) and c.get("id") == old_id]
        for c in loser_corrections:
            dropped_correction_obj_ids.add(id(c))
        dedup_records.append({
            "id": eff_id,
            "removed_from": os.path.basename(f),
            "kept_in": os.path.basename(survivor[0]),
            "moot_corrections_dropped": loser_corrections,
            "note": (
                f"multiple pre-rekey classify entries converged on current motion "
                f"{eff_id} (a genuine motion merge upstream, or two roll calls that "
                f"now regenerate as one); kept the entry in {os.path.basename(survivor[0])} "
                f"({survivor_reason}), dropped the duplicate from {os.path.basename(f)}"
                + (f", and its {len(loser_corrections)} now-moot corrections.json row(s)" if loser_corrections else "")
                + "."
            ),
        })

# Apply the drops to the in-memory verified/classified entry lists and to
# corrections.json, before the generic id-remap below.
for f in verified_files:
    drop_ids = drop_old_ids_by_verified_file.get(f, set())
    if drop_ids:
        verified_entries[f] = [e for e in verified_entries[f] if not (isinstance(e, dict) and e.get("id") in drop_ids)]

if drop_old_ids_global:
    for f in classified_files:
        classified_entries[f] = [e for e in classified_entries[f] if not (isinstance(e, dict) and e.get("id") in drop_old_ids_global)]

if dropped_correction_obj_ids:
    corrections_data = [c for c in corrections_data if id(c) not in dropped_correction_obj_ids]

# ---------------------------------------------------------------------------
# General rewrite pass: apply `mapping` everywhere (the deduped verified/
# classified/corrections structures held in memory above, plus every other
# classify/*.json file read fresh from disk).
# ---------------------------------------------------------------------------
handled = set(verified_files) | set(classified_files) | ({corrections_path} if os.path.exists(corrections_path) else set())
total = 0

for f in verified_files:
    dropped = f in drop_old_ids_by_verified_file
    n = rewrite(verified_entries[f])
    if n or dropped:
        json.dump(verified_entries[f], open(f, "w"), indent=1, ensure_ascii=True)
        print(f"  {os.path.basename(f)}: {n} ids re-keyed" + (f", {len(drop_old_ids_by_verified_file[f])} duplicate(s) removed" if dropped else ""))
        total += n

for f in classified_files:
    # classified_entries[f] was already filtered above if drop_old_ids_global
    # was non-empty; report against that filtering, not re-derive it here.
    was_filtered = bool(drop_old_ids_global)
    n = rewrite(classified_entries[f])
    if n or was_filtered:
        json.dump(classified_entries[f], open(f, "w"), indent=1, ensure_ascii=True)
        print(f"  {os.path.basename(f)}: {n} ids re-keyed")
        total += n

if os.path.exists(corrections_path):
    n = rewrite(corrections_data)
    if n or dropped_correction_obj_ids:
        json.dump(corrections_data, open(corrections_path, "w"), indent=1, ensure_ascii=True)
        print(f"  corrections.json: {n} ids re-keyed" + (f", {len(dropped_correction_obj_ids)} moot row(s) dropped" if dropped_correction_obj_ids else ""))
        total += n

for f in targets:
    if f in handled or os.path.basename(f).startswith("rekey-"):
        continue
    j = json.load(open(f))
    n = rewrite(j)
    if n:
        json.dump(j, open(f, "w"), indent=1, ensure_ascii=True)
        print(f"  {os.path.basename(f)}: {n} ids re-keyed")
        total += n

json.dump(mapping, open(os.path.join(CLS, f"rekey-map-{STAMP}.json"), "w"), indent=1, sort_keys=True)
json.dump(unresolved, open(os.path.join(CLS, f"rekey-unresolved-{STAMP}.json"), "w"), indent=1)
if dedup_records:
    json.dump(dedup_records, open(os.path.join(CLS, f"rekey-deduped-{STAMP}.json"), "w"), indent=1)
if rematch_records:
    json.dump(rematch_records, open(os.path.join(CLS, f"rekey-collision-rematches-{STAMP}.json"), "w"), indent=1)
print(f"mapped {len(mapping)} ids ({total} references) | unresolved {len(unresolved)} | deduped {len(dedup_records)} collision(s) | rematched {len(rematch_records)} collision loser(s)")

# ---------------------------------------------------------------------------
# Final invariant: no duplicate id across the verified batch files -- the
# same check generate-stances.ts's loadVerifiedClassifications() enforces at
# load time. Fail loudly here rather than let it crash generation instead.
# ---------------------------------------------------------------------------
seen = {}
dupes = []
for f in verified_files:
    for e in json.load(open(f)):
        if not isinstance(e, dict) or "id" not in e:
            continue
        if e["id"] in seen:
            dupes.append((e["id"], seen[e["id"]], os.path.basename(f)))
        else:
            seen[e["id"]] = os.path.basename(f)
if dupes:
    print(f"FATAL: {len(dupes)} duplicate id(s) remain across verified batch files after rekey:", file=sys.stderr)
    for did, f1, f2 in dupes:
        print(f"  {did}: {f1} and {f2}", file=sys.stderr)
    sys.exit(1)
print(f"verified batch files: {len(seen)} ids, 0 duplicates")
