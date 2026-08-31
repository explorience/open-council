#!/usr/bin/env python3
"""
Round-9 gate item 1/2 fix generator: rewrites every whatAYeaDid label in the
corpus that violates the rule "whatAYeaDid always describes what a yea
SUPPORTED/would have done, never the outcome" -- by APPENDING new
{field: "whatAYeaDid"} rows to data/election/classify/corrections.json (the
existing, never-edit-in-place correction layer -- see its schema and loader
in generate-stances.ts's applyCorrections()), never by touching a
batch-*-verified.json file directly.

Two defect subclasses, both caught by scripts/election/
sweep-outcome-verb-inversion.py (run that script to verify zero remain after
this one has been run and the site regenerated):

  1. OUTCOME-VERB INVERSION (10 motions): a Failed motion's label opens with
     a verb describing the VOTE'S OUTCOME (e.g. "Rejected...", "Declined...")
     instead of what a yea supported. These need a real semantic rewrite --
     the corrected text below was produced by reading each motion's own full
     operative clause (see each entry's `reason` for the source) and cannot
     be derived mechanically, so it is hand-curated in INVERSION_FIXES below.

  2. UNHEDGED (32 motions before this script's first run): a Failed motion's
     label describes an action in the plain past tense with no "would have"
     hedge at all -- true (as far as it goes) but reads as if the action
     happened when the motion failed. Four of these needed a small rewrite
     (CUSTOM_HEDGE_FIXES: a "Moved to X; this motion failed" or "Voted to X"
     construction that doesn't take a mechanical "Would have " prefix
     cleanly); the rest are fixed completely mechanically -- prepend
     "Would have " and lowercase the original first letter -- by this
     script's main loop, with no hand-curation at all.

Idempotent: skips any id whose whatAYeaDid correction is already present
with the same was/now pair; errors loudly if a stale `was` no longer matches
the live corpus (data/election/issues.json), same staleness contract as the
axis/polarity corrections already use in TypeScript.

Usage: python3 scripts/election/fix-whataeadid-outcome-inversions.py
Then:  npx tsx scripts/election/generate-stances.ts
       npx tsx scripts/election/generate-hub-pages.ts
       python3 scripts/election/sweep-outcome-verb-inversion.py   # expect PASS
"""
import json
import sys

ISSUES_PATH = "data/election/issues.json"
CORRECTIONS_PATH = "data/election/classify/corrections.json"

# ---------------------------------------------------------------------------
# Subclass 1: outcome-verb inversions on Failed motions (10 known rows,
# round-9 gate item 1). Each `now` was derived by reading the motion's own
# complete operative clause (see data/election/issues.json's motionText for
# this id, or the raw meeting JSON) -- not a mechanical transform.
# ---------------------------------------------------------------------------
INVERSION_FIXES = {
    "ccd852275515": (
        "Declined to include costing an expanded Tier 2 Surge Response (50 additional warming spaces at -5C) among the scenarios Civic Administration must investigate and report back on.",
        "Would have included costing an expanded Tier 2 Surge Response (50 additional warming spaces at -5C) among the scenarios Civic Administration must investigate and report back on.",
    ),
    "1a8f5640663c": (
        "Rejected approving the Homeless Prevention Service Standards regarding Good Neighbour and Community Relations.",
        "Would have approved the Homeless Prevention Service Standards regarding Good Neighbour and Community Relations.",
    ),
    "0af18c13bd47": (
        "Rejected amending the Housing Stability Services procurement framework to add a one-year (plus option) contract renewal and a directed review of existing housing-stability contracts with a report back to Council.",
        "Would have amended the Housing Stability Services procurement framework to add a one-year (plus option) contract renewal and a directed review of existing housing-stability contracts with a report back to Council.",
    ),
    "0d6178fd82e4": (
        "Rejected directing Civic Administration to consult with first responders (paramedics, police, fire) on emergency services at the Micro-Modular Shelter Site and report back.",
        "Would have directed Civic Administration to consult with first responders (paramedics, police, fire) on emergency services at the Micro-Modular Shelter Site and report back.",
    ),
    "ed4f4a5e9b2e": (
        "Rejected directing Civic Administration to consult with service providers on their roles, responsibilities, and costs at the Micro-Modular Shelter Site and report back.",
        "Would have directed Civic Administration to consult with service providers on their roles, responsibilities, and costs at the Micro-Modular Shelter Site and report back.",
    ),
    "e92845765097": (
        "Rejected directing Civic Administration to consult with the London Transit Commission and report back on improving transit service (rerouting, snow/ice clearing, lighting) to the Micro-Modular Shelter Site.",
        "Would have directed Civic Administration to consult with the London Transit Commission and report back on improving transit service (rerouting, snow/ice clearing, lighting) to the Micro-Modular Shelter Site.",
    ),
    "ce30b4eefd9e": (
        "Declined to accept the Development Charges Tribunal's recommendation to dismiss the appeal regarding development charges applied to the London Cross-Cultural Learner Centre's Doorway to Dreams project.",
        "Would have accepted the Development Charges Tribunal's recommendation to dismiss the appeal regarding development charges applied to the London Cross-Cultural Learner Centre's Doorway to Dreams project, on the Tribunal's finding that the charges were correctly determined.",
    ),
    "700cfca48a00": (
        "Rejected reverting the Affordable Home Ownership Incentive Program's loan term from ten years back down to five years, leaving the ten-year term in place.",
        "Would have reverted the Affordable Home Ownership Incentive Program's loan term from ten years back down to five years.",
    ),
    "512f5fb9506a": (
        "Declined to refer the Affordable Home Ownership Incentive Program back to Civic Administration for a report on program options (expanding to existing housing stock, tightening eligibility, funding sources, budget detail, other jurisdictions), leaving the original by-law on the table instead.",
        "Would have referred the Affordable Home Ownership Incentive Program back to Civic Administration for a report on program options (expanding to existing housing stock, tightening eligibility, funding sources, budget detail, other jurisdictions).",
    ),
    "bffba588345c": (
        "Rejected directing Civic Administration to report back with recommendations on municipal options to limit 'bad-faith' tenancy evictions tied to demolitions and conversions of residential premises.",
        "Would have directed Civic Administration to report back with recommendations on municipal options to limit 'bad-faith' tenancy evictions tied to demolitions and conversions of residential premises.",
    ),
}

INVERSION_REASON = (
    "Round-9 gate item 1: this label began with a verb describing the VOTE'S "
    "OUTCOME (the motion failing) rather than what a yea on it supported -- "
    "per the rule whatAYeaDid always describes what a yea supported/would "
    "have done, never the outcome, a yea here renders as opposing the exact "
    "thing that councillor voted for. Reworded to the \"Would have ...\" "
    "construction used by every other Failed-motion label in this corpus, "
    "describing the motion's own operative clause rather than its result."
)

# ---------------------------------------------------------------------------
# Subclass 2a: unhedged labels needing a small hand rewrite (not a clean
# mechanical "Would have " prefix -- a "Moved to X; this motion failed" or
# "Voted to X" construction).
# ---------------------------------------------------------------------------
CUSTOM_HEDGE_FIXES = {
    "b076ce02bb71": (
        "Moved to direct Civic Administration to report back to a future Infrastructure and Corporate Services Committee meeting with a proposed implementation plan for a 'Point of Purchase' weeping-tile (stormwater) disconnection program; this motion failed.",
        "Would have directed Civic Administration to report back to a future Infrastructure and Corporate Services Committee meeting with a proposed implementation plan for a 'Point of Purchase' weeping-tile (stormwater) disconnection program.",
    ),
    "d0b0c8c79902": (
        "Moved to amend the short-term-accommodation by-law to cap occupancy at a Dwelling Unit offering short-term accommodation at no more than two individuals per bedroom (excluding children under 2), with single-room occupant limits set by inspection; this amendment failed.",
        "Would have amended the short-term-accommodation by-law to cap occupancy at a Dwelling Unit offering short-term accommodation at no more than two individuals per bedroom (excluding children under 2), with single-room occupant limits set by inspection.",
    ),
    "e2146aa78193": (
        "Voted to refer the 1103 & 1111 Westdel Bourne rezoning application (OZ-25072) to a future Planning and Environment Committee meeting so the applicant could consider consolidating additional lands, rather than deciding the application at this meeting.",
        "Would have referred the 1103 & 1111 Westdel Bourne rezoning application (OZ-25072) to a future Planning and Environment Committee meeting so the applicant could consider consolidating additional lands, rather than deciding the application at this meeting.",
    ),
    "bcf2885344bc": (
        "A yea referred part c) -- a directed staff review of the five-bedroom limit on additional residential units -- to a future Planning and Environment Committee meeting rather than deciding it that day.",
        "A yea would have referred part c) -- a directed staff review of the five-bedroom limit on additional residential units -- to a future Planning and Environment Committee meeting rather than deciding it that day.",
    ),
}

HEDGE_REASON = (
    "Round-9 gate item 1/2: this label described a Failed motion's action in "
    "the plain past tense with no \"would have\" hedge -- true as far as it "
    "goes, but reads as if the action happened. Reworded to the same "
    "\"Would have ...\" construction the rest of this corpus's Failed-motion "
    "labels already use, so the identical whatAYeaDid field heals both the "
    "issue-page cell and the councillor-page unclear-section cell it renders "
    "into (see sweep-failed-motion-yea.py's unified hedge check)."
)


def mechanical_hedge(label: str) -> str:
    return "Would have " + label[0].lower() + label[1:]


def load_issue_labels():
    """id -> (label, passed) for every vote in the built issues.json."""
    data = json.load(open(ISSUES_PATH, encoding="utf-8"))
    out = {}
    for issue in data["issues"].values():
        for v in issue["votes"]:
            label = ((v.get("direction") or {}).get("label") or "").strip()
            out[v["id"]] = (label, v["passed"])
    return out


def main():
    labels = load_issue_labels()

    corrections = []
    if_exists = json.load(open(CORRECTIONS_PATH, encoding="utf-8"))
    existing = if_exists

    existing_whataeadid_keys = {
        (c["id"], c["was"])
        for c in existing
        if c.get("field") == "whatAYeaDid"
    }

    new_rows = []

    def add(motion_id: str, was: str, now: str, reason: str):
        if motion_id not in labels:
            print(f"SKIP {motion_id}: not found in {ISSUES_PATH} (already fixed via a prior run, or id changed)")
            return
        live_label, passed = labels[motion_id]
        if live_label != was:
            if live_label == now:
                print(f"SKIP {motion_id}: already corrected to the target text (idempotent re-run)")
                return
            raise SystemExit(
                f"STALE: {motion_id} expected whatAYeaDid {was!r} but corpus currently has {live_label!r}"
            )
        if (motion_id, was) in existing_whataeadid_keys:
            print(f"SKIP {motion_id}: correction already present in {CORRECTIONS_PATH}")
            return
        new_rows.append(
            {
                "id": motion_id,
                "field": "whatAYeaDid",
                "was": was,
                "now": now,
                "reason": reason,
                "quote": was,
            }
        )

    for motion_id, (was, now) in INVERSION_FIXES.items():
        add(motion_id, was, now, INVERSION_REASON)

    for motion_id, (was, now) in CUSTOM_HEDGE_FIXES.items():
        add(motion_id, was, now, HEDGE_REASON)

    handled = set(INVERSION_FIXES) | set(CUSTOM_HEDGE_FIXES)
    mechanical_count = 0
    for motion_id, (label, passed) in labels.items():
        if motion_id in handled:
            continue
        if not label or label.lower() == "unclear":
            continue
        if passed:
            continue
        if "would have" in label.lower():
            continue
        add(motion_id, label, mechanical_hedge(label), HEDGE_REASON)
        mechanical_count += 1

    if not new_rows:
        print("Nothing to add -- corrections.json is already up to date.")
        return

    existing.extend(new_rows)
    with open(CORRECTIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(
        f"Added {len(new_rows)} whatAYeaDid correction(s) to {CORRECTIONS_PATH} "
        f"({len(INVERSION_FIXES)} outcome-verb inversions, "
        f"{len(CUSTOM_HEDGE_FIXES)} custom hedge rewrites, "
        f"{mechanical_count} mechanical hedge prefixes)."
    )


if __name__ == "__main__":
    main()
