#!/usr/bin/env python3
"""
Round-9 gate items 5+6, extended for the pattern-based era: complete
trailer audit over every branch-authored commit on feat/election-hub (and
its descendants).

DETECTION RULE (the whole rule, not a summary): for every commit in
`git log origin/main..HEAD` that is BRANCH-AUTHORED (see the exclusion rule
below), the commit's full raw message (`git log -1 --format=%B`), with only
its trailing newline(s) stripped, must end with EXACTLY one of two accepted
forms:

  (a) a historical two-line block (append-only -- kept valid forever for
      the commits already written with it):

        Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
        Claude-Session: <the authoring session URL — any one of KNOWN_SESSIONS below>

      Historical blocks are frozen, literal text -- they name the exact
      account ("Claude Fable 5") that was live when Claude-Session lines
      were still written. They are NOT pattern-matched, because doing so
      would let a stray Claude-Session line attach itself to some other
      model name that never actually wrote one.

  (b) a PATTERN-based single-line form (attribution has changed accounts
      more than once; this form must keep working across every future
      switch without editing this file again):

        Co-Authored-By: Claude <model name> <noreply@anthropic.com>

      where <model name> matches CO_AUTHORED_BY_RE below: one of the
      documented Anthropic model families (Fable / Opus / Sonnet / Haiku)
      followed by a version number (e.g. "5", "5.1", "3.5") and an
      optional parenthetical qualifier (e.g. "(1M context)"). This is the
      ONE regex constant this audit anchors on for the single-line form --
      any sibling branch extending accepted model names (e.g. adding a new
      version like "Fable 5.1") should widen the same family/version
      pattern here rather than hardcoding a second literal string, so that
      independent edits to this constant converge instead of conflict.

and nothing else after that final line -- no extra blank line with
content, no leaked heredoc terminator ("EOF"), no stray closing paren, no
duplicate trailer, nothing. A commit whose message doesn't contain any
attempted trailer at all (e.g. missing it entirely) fails the same way as
one with garbage trailing after an accepted trailer, or one naming a
non-Anthropic / malformed model: either way, the message does not end with
exactly one accepted block. Note form (b) is not a suffix of form (a) --
(a) ends with the Claude-Session line, not the Co-Authored-By line -- so
the two forms never collide and a message ending in Co-Authored-By plus
garbage never false-passes as (b).

A message ending in TWO CONSECUTIVE accepted trailers (a duplicated
trailer -- e.g. an amend or heredoc mistake that appended a second copy,
possibly under two DIFFERENT model names since the account can switch
mid-history) must FAIL: matching the tail alone is not enough to check
this, since a duplicate trailer's tail is STILL a match on the accepted
form regardless of what identical (or merely also-accepted) block precedes
it -- the check must also confirm the matched block isn't itself
immediately preceded by another accepted block (see
`ends_with_exactly_one_trailer_block` below, and its `--self-test`).

EXCLUSION RULE ("excluding upstream content"): a commit is NOT branch-
authored -- and is skipped by this audit entirely, neither passed nor
failed -- when either is true:
  - its author email ends with "@users.noreply.github.com" (a GitHub
    squash-merge's commit author, not this branch's own git identity), or
  - its subject line ends with a GitHub PR reference, "(#123)".
Both signals independently identify commits on this branch that are real
upstream PRs pulled in via a merge from origin/main earlier in this
branch's history (origin/main has since moved on, so they still show up in
`origin/main..HEAD`) -- not something the branch's own fixer workflow
wrote, and not something this audit should rewrite or hold to the fixer's
own trailer convention.

Usage: python3 scripts/election/audit-commit-trailers.py
       python3 scripts/election/audit-commit-trailers.py --self-test
Exit 0 with zero branch-authored failures; exit 1 otherwise. Prints every
excluded (upstream) commit and every branch-authored commit's verdict.
--self-test exercises ends_with_exactly_one_trailer_block directly (no git
calls): both accepted forms must pass (including multiple model
names/versions/qualifiers for the pattern form), a message ending in a
duplicated trailer (same or mixed accepted forms) must fail, and a
NEGATIVE case -- a non-Anthropic or malformed model name -- must fail too.
"""
import re
import subprocess
import sys

# One entry per legitimate authoring session: a commit must end with exactly
# the historical Co-Authored-By line plus the Claude-Session line of the
# session that authored it. Sessions are append-only here; never remove an
# old one (its commits are permanent history).
KNOWN_SESSIONS = (
    "https://claude.ai/code/session_01AEA1RWnKEDhEFCsvSP5Xmp",
    "https://claude.ai/code/session_014Svnp8WcfKWLkqhk694WTP",
)

# Frozen literal text for the historical two-line form -- the account name
# in use while Claude-Session lines were still written. Never generalize
# this to the pattern below: it names one specific account, on purpose.
HISTORICAL_CO_AUTHORED_BY_LINE = "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

# Historical two-line blocks: one per known session, append-only -- never
# remove an entry (its commits are permanent history).
ACCEPTED_HISTORICAL_BLOCKS = tuple(
    f"{HISTORICAL_CO_AUTHORED_BY_LINE}\nClaude-Session: {session}"
    for session in KNOWN_SESSIONS
)

# Documented Anthropic model families this audit will accept in the
# single-line pattern form. Widen this tuple (not a second hardcoded
# string) whenever a new family ships.
ANTHROPIC_MODEL_FAMILIES = ("Fable", "Opus", "Sonnet", "Haiku")

# THE single regex constant for the current, pattern-based single-line
# form. Sibling branches extending accepted model names (new versions,
# e.g. "Fable 5.1") should widen this same pattern rather than adding a
# parallel literal -- that keeps independent edits mergeable.
CO_AUTHORED_BY_RE = re.compile(
    r"^Co-Authored-By: Claude (?:"
    + "|".join(ANTHROPIC_MODEL_FAMILIES)
    + r") \d+(?:\.\d+)?(?: \([^()\n]+\))? <noreply@anthropic\.com>$"
)

PR_SUBJECT_RE = re.compile(r"\(#\d+\)\s*$")


def _is_accepted_single_line(line: str) -> bool:
    return CO_AUTHORED_BY_RE.match(line) is not None


def _remainder_ends_with_accepted_block(remainder: str) -> bool:
    """True if `remainder` (whatever precedes a just-matched trailer,
    trailing newlines already stripped) itself ends with an accepted
    block -- i.e. the trailer we just matched was a DUPLICATE, not the
    message's only trailer."""
    for block in ACCEPTED_HISTORICAL_BLOCKS:
        if remainder.endswith(block):
            return True
    last_line = remainder.rsplit("\n", 1)[-1]
    return _is_accepted_single_line(last_line)


def ends_with_exactly_one_trailer_block(trimmed: str) -> bool:
    """True if `trimmed` (the commit message with only its trailing
    newline(s) stripped) ends with EXACTLY ONE accepted trailer -- a
    historical two-line block, or a single line matching CO_AUTHORED_BY_RE
    -- and that trailer is not itself immediately preceded by another
    accepted block (which would make it a duplicate, not a clean single
    trailer)."""
    for block in ACCEPTED_HISTORICAL_BLOCKS:
        if trimmed.endswith(block):
            remainder = trimmed[: -len(block)].rstrip("\n")
            if _remainder_ends_with_accepted_block(remainder):
                return False  # duplicate trailer immediately before this one
            return True

    last_line = trimmed.rsplit("\n", 1)[-1]
    if _is_accepted_single_line(last_line):
        remainder = trimmed[: -len(last_line)].rstrip("\n")
        if _remainder_ends_with_accepted_block(remainder):
            return False  # duplicate trailer immediately before this one
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
                if "Co-Authored-By: Claude" not in body
                else "trailer present but followed by extra content (leaked heredoc/paren/etc.), "
                "or duplicated, or names an unrecognized model, or otherwise malformed"
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
        "trailer block (pattern-based single-line, or historical two-line), "
        "with no duplicate and nothing trailing after it."
    )
    sys.exit(0)


def self_test() -> int:
    """Exercises ends_with_exactly_one_trailer_block directly (no git
    calls). Covers: both accepted forms across several model
    names/versions/qualifiers, duplicate trailers (same-model and
    mixed-model), and the NEGATIVE case -- a non-Anthropic or malformed
    model name must still fail."""
    ok = True

    def check(label: str, message: str, expect_pass: bool) -> None:
        nonlocal ok
        got_pass = ends_with_exactly_one_trailer_block(message.rstrip("\n"))
        if got_pass == expect_pass:
            print(f" - {label} -> {'accepted' if got_pass else 'rejected'} (correct)")
        else:
            print(
                f"SELF-TEST FAILED: {label} -> {'accepted' if got_pass else 'rejected'}, "
                f"expected {'accepted' if expect_pass else 'rejected'}"
            )
            ok = False

    check(
        "clean single-line trailer (Fable 5, bare)",
        "Some commit body.\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>",
        True,
    )
    check(
        "clean single-line trailer (Opus 5, parenthetical)",
        "Some commit body.\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>",
        True,
    )
    check(
        "clean single-line trailer (Sonnet 5.1)",
        "Some commit body.\n\nCo-Authored-By: Claude Sonnet 5.1 <noreply@anthropic.com>",
        True,
    )
    check(
        "clean single-line trailer (Haiku 3.5)",
        "Some commit body.\n\nCo-Authored-By: Claude Haiku 3.5 <noreply@anthropic.com>",
        True,
    )
    check(
        "clean historical two-line trailer",
        "Some commit body.\n\n" + ACCEPTED_HISTORICAL_BLOCKS[0],
        True,
    )

    check(
        "duplicate Co-Authored-By trailer (same model)",
        "Some commit body.\n\n"
        "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>\n"
        "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>",
        False,
    )
    check(
        "duplicate Co-Authored-By trailer (mixed models across an account switch)",
        "Some commit body.\n\n"
        "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>\n"
        "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>",
        False,
    )
    check(
        "duplicate historical two-line trailer",
        "Some commit body.\n\n" + ACCEPTED_HISTORICAL_BLOCKS[0] + "\n" + ACCEPTED_HISTORICAL_BLOCKS[0],
        False,
    )
    check(
        "trailing garbage after an accepted single-line trailer",
        "Some commit body.\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>\nEOF",
        False,
    )

    # NEGATIVE: non-Anthropic / malformed model names must still fail.
    check(
        "non-Anthropic model name (Gemini is not an Anthropic family)",
        "Some commit body.\n\nCo-Authored-By: Claude Gemini 5 <noreply@anthropic.com>",
        False,
    )
    check(
        "malformed trailer (no version number)",
        "Some commit body.\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>",
        False,
    )
    check(
        "malformed trailer (wrong email domain)",
        "Some commit body.\n\nCo-Authored-By: Claude Opus 5 <noreply@openai.com>",
        False,
    )

    if not ok:
        return 1
    print("\nSELF-TEST PASSED")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    main()
