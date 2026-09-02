#!/usr/bin/env python3
"""Re-key classification-layer motion ids after upstream id churn.

Motion ids in data/votes/_all-motions.json derive from content that upstream
regeneration can legitimately change (motion-text cap changes, roll-call
un-merging, nightly re-scrapes, extractMotionText fixes). The classification
layer under data/election/classify/ keys by those ids, so churn silently
breaks the join and classified motions fall back to "unclassified".

This script migrates every classify-layer id to its current corpus id using
stable natural keys, in three tiers:
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
  3. anything still unresolved is left untouched and listed in
     rekey-unresolved-<stamp>.json for manual review

The full old->new mapping is written to rekey-map-<stamp>.json so the
migration is auditable and reversible.

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
def resolve(old_id):
    if old_id in cur_ids or old_id in mapping or old_id in _unresolved_ids:
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
        _unresolved_ids.add(old_id)
        unresolved.append({"id": old_id, "reason": f"ambiguous ({len(hits)} candidates)", "key": list(key)})
        return
    _unresolved_ids.add(old_id)
    unresolved.append({"id": old_id, "reason": "no natural-key match", "key": list(key)})

targets = sorted(glob.glob(os.path.join(CLS, "*.json")))
for f in targets:
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

def rewrite(obj):
    changed = 0
    if isinstance(obj, list):
        for e in obj:
            changed += rewrite(e)
    elif isinstance(obj, dict):
        if "id" in obj and obj["id"] in mapping:
            obj["id"] = mapping[obj["id"]]
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
print(f"mapped {len(mapping)} ids ({total} references) | unresolved {len(unresolved)} | deduped {len(dedup_records)} collision(s)")

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
