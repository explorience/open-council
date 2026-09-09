#!/usr/bin/env python3
"""
Round-9 gate items 5+6: complete trailer audit over every branch-authored
commit on feat/election-hub.

DETECTION RULE (the whole rule, not a summary): for every commit in
`git log origin/main..HEAD` that is BRANCH-AUTHORED (see the exclusion rule
below), the commit's full raw message (`git log -1 --format=%B`), with only
its trailing newline(s) stripped, must end with EXACTLY one of two accepted
forms:

  (a) the historical two-line block (append-only -- kept valid forever for
      the commits already written with it):

        Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
        Claude-Session: <the authoring session URL — any one of KNOWN_SESSIONS below>

  (b) the current single-line form (ATTRIBUTION CHANGE, session account
      switched -- no Claude-Session line any more):

        Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

and nothing else after that final line -- no extra blank line with
content, no leaked heredoc terminator ("EOF"), no stray closing paren, no
duplicate trailer, nothing. A commit whose message doesn't contain any
accepted trailer at all (e.g. missing it entirely) fails the same way as
one with garbage trailing after an accepted trailer: either way, the
message does not end with exactly one accepted block. Note the single-line
form (b) is not a suffix of the two-line block (a) -- (a) ends with the
Claude-Session line, not the Co-Authored-By line -- so the two forms never
collide and a message ending in Co-Authored-By plus garbage never
false-passes as (b).

A message ending in TWO CONSECUTIVE Co-Authored-By lines (a duplicated
trailer -- e.g. an amend or heredoc mistake that appended a second copy)
must FAIL: `str.endswith(block)` alone is not enough to check this, since
a duplicate trailer's tail is STILL a byte-for-byte suffix match on the
single-line block -- the check must also confirm the matched block isn't
itself immediately preceded by another copy of an accepted block (see
`ends_with_exactly_one_trailer_block` below, and its `--self-test`).

EXCLUSION RULE ("excluding upstream content"): a commit is NOT branch-
authored -- and is skipped by this audit entirely, neither passed nor
failed -- when either is true:
  - its author email ends with "@users.noreply.github.com" (a GitHub
    squash-merge's commit author, not this branch's own git identity), or
  - its subject line ends with a GitHub PR reference, "(#123)".
Both signals independently identify the two commits on this branch that
are real upstream PRs pulled in via a merge from origin/main earlier in
this branch's history (origin/main has since moved on, so they still show
up in `origin/main..HEAD`) -- not something the branch's own fixer workflow
wrote, and not something this audit should rewrite or hold to the fixer's
own trailer convention.

Usage: python3 scripts/election/audit-commit-trailers.py
       python3 scripts/election/audit-commit-trailers.py --self-test
Exit 0 with zero branch-authored failures; exit 1 otherwise. Prints every
excluded (upstream) commit and every branch-authored commit's verdict.
--self-test exercises ends_with_exactly_one_trailer_block directly (no git
calls): both clean accepted forms must pass, and a message ending in a
duplicated trailer (single-line or historical two-line) must fail.
"""
import re
import subprocess
import sys

# One entry per legitimate authoring session: a commit must end with exactly
# the Co-Authored-By line plus the Claude-Session line of the session that
# authored it. Sessions are append-only here; never remove an old one (its
# commits are permanent history).
KNOWN_SESSIONS = (
    "https://claude.ai/code/session_01AEA1RWnKEDhEFCsvSP5Xmp",
    "https://claude.ai/code/session_014Svnp8WcfKWLkqhk694WTP",
)
CO_AUTHORED_BY_LINE = "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

# Historical two-line blocks: one per known session, append-only -- never
# remove an entry (its commits are permanent history).
ACCEPTED_TRAILER_BLOCKS = tuple(
    f"{CO_AUTHORED_BY_LINE}\nClaude-Session: {session}" for session in KNOWN_SESSIONS
) + (
    # Current single-line form (ATTRIBUTION CHANGE): bare Co-Authored-By,
    # nothing after it. Added for the new authoring account; the two-line
    # blocks above stay valid forever for pre-existing commits.
    CO_AUTHORED_BY_LINE,
)

PR_SUBJECT_RE = re.compile(r"\(#\d+\)\s*$")


def ends_with_exactly_one_trailer_block(trimmed: str) -> bool:
    """True if `trimmed` (the commit message with only its trailing
    newline(s) stripped) ends with EXACTLY ONE of ACCEPTED_TRAILER_BLOCKS --
    not merely a byte-for-byte suffix match, which a DUPLICATE trailer
    (e.g. two consecutive Co-Authored-By lines) would also produce, since
    the string still ends with the accepted single-line block's exact
    bytes regardless of what identical block precedes it. After a
    candidate match, the remainder (everything before the matched block)
    must NOT itself end with an accepted block -- that would mean the
    "accepted" tail was immediately preceded by a duplicate of itself (or
    of another accepted form), which is exactly the malformed case this
    audit exists to catch, not a clean single trailer."""
    for block in ACCEPTED_TRAILER_BLOCKS:
        if not trimmed.endswith(block):
            continue
        # Strip the single "\n" line-separator between a duplicated trailer
        # and the one we just matched before checking for a preceding
        # duplicate -- without this, "...LINE\nLINE" would have a remainder
        # ending in "LINE\n", which never matches LINE as a plain suffix.
        remainder = trimmed[: -len(block)].rstrip("\n")
        if any(remainder.endswith(b) for b in ACCEPTED_TRAILER_BLOCKS):
            continue  # duplicate trailer immediately before this one -- reject
        return True
    return False


def run(*args):
    return subprocess.run(
        ["git", *args], cwd=".", capture_output=True, text=True, check=True
    ).stdout


def is_upstream_content(author_email: str, subject: str) -> bool:
    return author_email.endswith("@users.noreply.github.com") or bool(
        PR_SUBJECT_RE.search(subject)
    )


def main():
    shas = run("log", "origin/main..HEAD", "--format=%H").splitlines()
    if not shas:
        print("No commits in origin/main..HEAD.")
        sys.exit(0)

    excluded = []
    failures = []
    passes = []

    for sha in shas:
        author_email = run("log", "-1", "--format=%ae", sha).strip()
        subject = run("log", "-1", "--format=%s", sha).strip()

        if is_upstream_content(author_email, subject):
            excluded.append((sha[:8], author_email, subject))
            continue

        body = run("log", "-1", "--format=%B", sha)
        trimmed = body.rstrip("\n")

        if ends_with_exactly_one_trailer_block(trimmed):
            passes.append((sha[:8], subject))
        else:
            reason = (
                "missing a recognized trailer block entirely"
                if CO_AUTHORED_BY_LINE not in body
                else "trailer present but followed by extra content (leaked heredoc/paren/etc.), "
                "or duplicated, or otherwise malformed"
            )
            failures.append((sha[:8], subject, reason, trimmed[-200:]))

    print(f"Commits in origin/main..HEAD: {len(shas)}")
    print(f"  Excluded as upstream content (not this branch's own commits): {len(excluded)}")
    for sha, email, subject in excluded:
        print(f"    {sha}  author={email!r}  {subject!r}")

    print(f"  Branch-authored, checked: {len(passes) + len(failures)}")
    print(f"    PASS: {len(passes)}")
    print(f"    FAIL: {len(failures)}")
    for sha, subject, reason, tail in failures:
        print(f"      {sha}  {subject!r}")
        print(f"        reason: {reason}")
        print(f"        message tail: {tail!r}")

    print(f"\n{'=' * 60}")
    if failures:
        print(f"FAIL: {len(failures)} branch-authored commit(s) have a malformed trailer block.")
        sys.exit(1)
    print(
        "PASS: every branch-authored commit ends with exactly one accepted "
        "trailer block (single-line or historical two-line), with no "
        "duplicate and nothing trailing after it."
    )
    sys.exit(0)


def self_test() -> int:
    """Negative test for ends_with_exactly_one_trailer_block: confirms both
    accepted clean forms pass, AND -- the defect this round's fix targets --
    a message ending in TWO CONSECUTIVE Co-Authored-By lines fails, exactly
    as the module docstring promises."""
    ok = True

    clean_single = "Some commit body.\n\n" + CO_AUTHORED_BY_LINE
    if ends_with_exactly_one_trailer_block(clean_single.rstrip("\n")):
        print(" - clean single-line trailer -> accepted (correct)")
    else:
        print("SELF-TEST FAILED: a clean single-line trailer was rejected")
        ok = False

    clean_historical = "Some commit body.\n\n" + ACCEPTED_TRAILER_BLOCKS[0]
    if ends_with_exactly_one_trailer_block(clean_historical.rstrip("\n")):
        print(" - clean historical two-line trailer -> accepted (correct)")
    else:
        print("SELF-TEST FAILED: a clean historical two-line trailer was rejected")
        ok = False

    duplicate = "Some commit body.\n\n" + CO_AUTHORED_BY_LINE + "\n" + CO_AUTHORED_BY_LINE
    if ends_with_exactly_one_trailer_block(duplicate.rstrip("\n")):
        print("SELF-TEST FAILED: a message ending in TWO consecutive Co-Authored-By lines was wrongly accepted")
        ok = False
    else:
        print(" - duplicate Co-Authored-By trailer -> rejected (correct)")

    duplicate_historical = (
        "Some commit body.\n\n" + ACCEPTED_TRAILER_BLOCKS[0] + "\n" + ACCEPTED_TRAILER_BLOCKS[0]
    )
    if ends_with_exactly_one_trailer_block(duplicate_historical.rstrip("\n")):
        print("SELF-TEST FAILED: a message ending in a duplicated two-line block was wrongly accepted")
        ok = False
    else:
        print(" - duplicate historical two-line trailer -> rejected (correct)")

    if not ok:
        return 1
    print("\nSELF-TEST PASSED")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    main()
