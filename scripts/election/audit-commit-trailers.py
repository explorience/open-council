#!/usr/bin/env python3
"""
Round-9 gate items 5+6: complete trailer audit over every branch-authored
commit on feat/election-hub.

DETECTION RULE (the whole rule, not a summary): for every commit in
`git log origin/main..HEAD` that is BRANCH-AUTHORED (see the exclusion rule
below), the commit's full raw message (`git log -1 --format=%B`), with only
its trailing newline(s) stripped, must end with EXACTLY:

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AEA1RWnKEDhEFCsvSP5Xmp

and nothing else after that second line -- no extra blank line with
content, no leaked heredoc terminator ("EOF"), no stray closing paren, no
duplicate trailer, nothing. A commit whose message doesn't contain both
lines at all (e.g. missing Claude-Session entirely) fails the same way as
one with garbage trailing after them: either way, the message does not end
with exactly this two-line block.

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
Exit 0 with zero branch-authored failures; exit 1 otherwise. Prints every
excluded (upstream) commit and every branch-authored commit's verdict.

EXTENSION (frontpage-v3 build, append-only -- the original two-line
"Claude Fable 5" + Claude-Session block below is left intact and still
passes unchanged; this only ADDS alternatives, it never narrows what
already passed): the Front Page v3 build brief names the co-author as
"Claude Fable 5.1" and specifies a commit trailer of the single
Co-Authored-By line alone, with no Claude-Session line -- a different
model name AND a different trailer shape than the original rule
anticipated. REQUIRED_TRAILERS is therefore now a tuple of every exact
suffix that passes (str.endswith accepts a tuple natively): the original
"Claude Fable 5" two-line block, its "Claude Fable 5.1" two-line
equivalent, and a single-line Co-Authored-By-only variant for each of the
two names. A commit's message passes if it ends with ANY one of these
four exact strings.
"""
import re
import subprocess
import sys

_SESSION_LINE = "Claude-Session: https://claude.ai/code/session_01AEA1RWnKEDhEFCsvSP5Xmp"


def _co_authored_by(model_name: str) -> str:
    return f"Co-Authored-By: {model_name} <noreply@anthropic.com>"


REQUIRED_TRAILERS = (
    # Original rule, unchanged (append-only).
    f"{_co_authored_by('Claude Fable 5')}\n{_SESSION_LINE}",
    # Extension: same two-line shape, "Claude Fable 5.1" co-author.
    f"{_co_authored_by('Claude Fable 5.1')}\n{_SESSION_LINE}",
    # Extension: single-line trailer (no Claude-Session), either name --
    # the shape the frontpage-v3 build brief actually specifies.
    _co_authored_by("Claude Fable 5"),
    _co_authored_by("Claude Fable 5.1"),
)

PR_SUBJECT_RE = re.compile(r"\(#\d+\)\s*$")


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

        if trimmed.endswith(REQUIRED_TRAILERS):
            passes.append((sha[:8], subject))
        else:
            # Extension: any accepted trailer variant appearing anywhere in
            # the body (not necessarily at the very end) means the message
            # has extra trailing content rather than a missing trailer.
            reason = (
                "trailers present but followed by extra content (leaked heredoc/paren/etc.)"
                if any(variant in body for variant in REQUIRED_TRAILERS)
                else "missing one or both required trailer lines"
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
    print("PASS: every branch-authored commit ends with exactly the two required trailers.")
    sys.exit(0)


if __name__ == "__main__":
    main()
