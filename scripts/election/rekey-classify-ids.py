#!/usr/bin/env python3
"""Re-key classification-layer motion ids after upstream id churn.

Motion ids in data/votes/_all-motions.json derive from content that upstream
regeneration can legitimately change (motion-text cap changes, roll-call
un-merging, nightly re-scrapes). The classification layer under
data/election/classify/ keys by those ids, so churn silently breaks the join
and classified motions fall back to "unclassified".

This script migrates every classify-layer id to its current corpus id using
stable natural keys, in three tiers:
  1. (date, meetingSlug, itemNumber, result) unique match
  2. same key ambiguous -> disambiguate by the entry's verbatim quote (or the
     manifest's itemTitle) against each candidate's motionText
  3. anything still unresolved is left untouched and listed in
     rekey-unresolved-<stamp>.json for manual review

The full old->new mapping is written to rekey-map-<stamp>.json so the
migration is auditable and reversible. Run with the date stamp as argv[1].
"""
import json, glob, os, sys

STAMP = sys.argv[1] if len(sys.argv) > 1 else "unstamped"
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
CLS = os.path.join(BASE, "data", "election", "classify")

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
        manifest.update(j.get("motions", {}) if isinstance(j.get("motions"), dict) else
                        {e["id"]: e for e in (j.get("motions") or j.get("batches") or []) if isinstance(e, dict)})

# entries' quotes help disambiguate; collect per id from batch files
quotes = {}
for f in glob.glob(os.path.join(CLS, "batch-*-verified.json")) + glob.glob(os.path.join(CLS, "batch-*-classified.json")):
    for e in json.load(open(f)):
        q = e.get("quote")
        if q and e.get("id") not in quotes:
            quotes[e["id"]] = q

mapping, unresolved = {}, []
def resolve(old_id):
    if old_id in cur_ids or old_id in mapping:
        return
    mm = manifest.get(old_id)
    if not mm:
        unresolved.append({"id": old_id, "reason": "not in any manifest"})
        return
    key = (mm["date"], mm["meetingSlug"], str(mm["itemNumber"]), mm["result"])
    hits = nat.get(key, [])
    if len(hits) == 1:
        mapping[old_id] = hits[0]["id"]
        return
    if len(hits) > 1:
        probe = (quotes.get(old_id) or mm.get("itemTitle") or "")[:60]
        scored = [h for h in hits if probe and probe[:40] and probe[:40] in (h.get("motionText") or "")]
        if len(scored) == 1:
            mapping[old_id] = scored[0]["id"]
            return
        unresolved.append({"id": old_id, "reason": f"ambiguous ({len(hits)} candidates)", "key": list(key)})
        return
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

total = 0
for f in targets:
    if os.path.basename(f).startswith("rekey-"):
        continue
    j = json.load(open(f))
    n = rewrite(j)
    if n:
        json.dump(j, open(f, "w"), indent=1, ensure_ascii=True)
        print(f"  {os.path.basename(f)}: {n} ids re-keyed")
        total += n

json.dump(mapping, open(os.path.join(CLS, f"rekey-map-{STAMP}.json"), "w"), indent=1, sort_keys=True)
json.dump(unresolved, open(os.path.join(CLS, f"rekey-unresolved-{STAMP}.json"), "w"), indent=1)
print(f"mapped {len(mapping)} ids ({total} references) | unresolved {len(unresolved)}")
