#!/usr/bin/env python3
"""
Round-8 gate item 4 sweep: structural detectors over EVERY built HTML page
under public/election/ (all ~28 pages -- landing, wards, what-council-
controls, the issues index, all 8 issue pages, the councillors index, and
every councillor profile), proving the Election Hub's rendered prose is free
of two defect classes that earlier rounds only found by accident:

  (a) EMPHASIS-SPAN CORRUPTION: round-7 gate item 1 found that a literal
      asterisk sitting inside an already-open markdown italic span breaks
      Quartz's renderer, producing a spurious closing/reopening
      </em><em> pair in the middle of what should have been one
      continuous word or sentence (see that fix's commit message for the
      exact mechanism, and generate-hub-pages.ts's tcell() for the
      renderer-side guard it added). That fix covered the one call site
      known at the time; this sweep proves the CLASS is gone everywhere,
      not just that one instance.

  (b) DEVELOPER JARGON IN PROSE: round-7 gate item 4 de-jargoned the
      stances.json methodology paragraph by hand; round-8 gate items 1-2
      found a second, still-jargon-laden paragraph (issues.json's) that
      hand-editing had simply never reached. This sweep is the structural
      guard against a THIRD hand-written paragraph shipping with the same
      defect: it doesn't know what "methodology" text is, it just looks
      for the vocabulary shapes a developer reaches for and a voter never
      would, anywhere on any built page.

DETECTION RULE (the whole rule, not a summary):

  (a) Scanned over each page's full rendered markup (script/style/svg
      elements removed first -- Quartz's own inline JS and SVG icon path
      data are full of exactly the tag-adjacency and identifier shapes
      this sweep looks for, and are not prose). A hit is any `</em>`
      immediately followed (across optional whitespace only) by `<em>`,
      with a word character touching the boundary on BOTH sides -- the
      "mid-token" shape a stray asterisk produces, as opposed to two
      separately-italicized phrases sitting next to each other with a
      space or punctuation between them, which is ordinary markdown, not
      corruption.

  (b) Scanned over the same script/style/svg-stripped page, walking every
      text node individually so each hit can be attributed to a real
      sentence. Five checks per text node, after first masking out any
      run of text that is itself a real URL (`https?://\\S+` or
      `www\\.\\S+`), since a URL legitimately contains slashes and
      sometimes a dotted extension-shaped suffix that isn't jargon:

        1. FILE EXTENSION -- a bare `.json`, `.ts`, or `.py`.
        2. PATH SEPARATOR -- a `/` immediately after one of this repo's
           own top-level source directories (data, content, scripts,
           quartz, public, lib, server, supabase, docs, scraping) --
           deliberately NOT a bare `\\w+/\\w+` pattern, because this hub's
           own legitimate prose is full of genuine slash-joined pairs that
           are not file paths at all: "and/or", "yea/nay", topic labels
           like "encampment/homelessness" or "downtown/core". A path
           regex broad enough to catch a stray file reference but narrow
           enough not to flag those was only achievable by anchoring on
           this repo's actual directory names, which is also exactly the
           shape every real jargon leak on this hub has had so far (see
           the old issues.json methodology text this sweep exists to keep
           gone).
        3. GLOB WILDCARD -- a literal `*` character in text. Properly
           rendered markdown converts a real `*` into `<em>`/`<strong>`
           tags; one surviving as literal text is either a glob pattern
           (`batch-*-verified.json`) or the (a) corruption bug above, and
           and both are worth a FAIL. (Two real motions in the current
           corpus use a literal asterisk in their own title -- "Life*Spin"
           and a "D400*H61" zoning notation -- exempted the same way as
           every other verbatim quote below.)
        4. SNAKE_CASE -- `[a-z][a-z0-9]*_[a-z0-9_]*`, e.g. `also_present`.
        5. CAMELCASE -- `[a-z]+[A-Z][a-zA-Z0-9]*`, e.g. `movedTowardText`.
           `eSCRIBE` (the meeting-management platform's real product name,
           which legitimately appears in this hub's prose) is explicitly
           allowlisted so this check doesn't fail on a proper noun.
        6. BARE WORDS -- "regex", "pipeline", or "null" as whole words, or
           the phrase "verdict values", case-insensitive.

      Two structural exemptions apply to ALL SIX jargon checks (not to
      (a), which is about markup corruption and can occur anywhere):

        - Any text node inside a `<td>`: every table on this hub (vote
          tables, evidence tables, unclear-evidence tables) holds either a
          verbatim motion title/text or a bare number -- never hub-
          authored prose. Confirmed necessary, not theoretical: the
          current corpus has real motion text containing "D400*H61",
          "Life*Spin", and a motion titled "... Pipeline Decommissioning
          and New Pipeline Agreement" -- all genuine, all inside table
          cells or the exemption below, all false positives without this
          exemption.
        - Any text node inside a `<li>` whose own full text opens with a
          "YYYY-MM-DD — " date stamp: the issues-index "Unclassified
          divided votes" list, which quotes real agenda-item titles
          verbatim -- same convention, same rationale, as
          sweep-membership-claims.py's SOURCE_TITLE_BULLET_RE.

A hit is a FAIL. Zero hits is the only passing state.

Usage: python3 scripts/election/sweep-voter-facing-text.py
"""
import glob
import re
import sys

from bs4 import BeautifulSoup, NavigableString

HTML_GLOB = "public/election/**/*.html"

# --- (a) emphasis-span corruption -------------------------------------
EMPHASIS_CORRUPTION_RE = re.compile(r"\w</em>\s*<em>\w")

# --- (b) developer jargon in prose --------------------------------------
URL_RE = re.compile(r"(https?://\S+|www\.\S+)")

EXTENSION_RE = re.compile(r"\.(json|ts|py)\b", re.IGNORECASE)

REPO_ROOTS = (
    "data",
    "content",
    "scripts",
    "quartz",
    "public",
    "lib",
    "server",
    "supabase",
    "docs",
    "scraping",
)
PATH_SEPARATOR_RE = re.compile(
    r"\b(?:" + "|".join(REPO_ROOTS) + r")/[\w.-]+(?:/[\w.-]+)*"
)

GLOB_WILDCARD_RE = re.compile(r"\*")

SNAKE_CASE_RE = re.compile(r"\b[a-z][a-z0-9]*_[a-z0-9_]*\b")

# Real product name (the meeting-management platform this hub's source data
# comes from) that legitimately appears in prose and would otherwise trip
# the camelCase check below -- lowercase letter immediately followed by an
# uppercase one.
CAMEL_CASE_ALLOW = {"eSCRIBE"}
CAMEL_CASE_RE = re.compile(r"\b[a-z]+[A-Z][a-zA-Z0-9]*\b")

BARE_WORD_RE = re.compile(r"\b(regex|pipeline|null|verdict values)\b", re.IGNORECASE)

JARGON_CHECKS = [
    (EXTENSION_RE, "developer jargon: file extension"),
    (PATH_SEPARATOR_RE, "developer jargon: path separator"),
    (GLOB_WILDCARD_RE, "developer jargon: glob wildcard / stray asterisk"),
    (SNAKE_CASE_RE, "developer jargon: snake_case identifier"),
    (CAMEL_CASE_RE, "developer jargon: camelCase identifier"),
    (BARE_WORD_RE, "developer jargon: regex/pipeline/null/verdict values"),
]

SOURCE_TITLE_BULLET_RE = re.compile(r"^\s*\d{4}-\d{2}-\d{2}\s+—\s+")


def is_verbatim_quote_node(node) -> bool:
    """True if this text node sits inside a table cell (verbatim motion
    title/text or a bare number) or inside a date-stamped "Unclassified
    divided votes" bullet (verbatim agenda-item title)."""
    for ancestor in node.parents:
        name = getattr(ancestor, "name", None)
        if name == "td":
            return True
        if name == "li" and SOURCE_TITLE_BULLET_RE.match(ancestor.get_text()):
            return True
    return False


def strip_camel_allowlist(text: str) -> str:
    for allowed in CAMEL_CASE_ALLOW:
        text = text.replace(allowed, " " * len(allowed))
    return text


def check_jargon_in_text(text: str):
    """Yield (pattern-description, matched-text) for every jargon hit in
    this already-URL-masked run of text."""
    masked = URL_RE.sub(lambda m: " " * len(m.group(0)), text)
    camel_input = strip_camel_allowlist(masked)
    for pattern, desc in JARGON_CHECKS:
        haystack = camel_input if pattern is CAMEL_CASE_RE else masked
        for m in pattern.finditer(haystack):
            yield desc, m.group(0)


def main():
    files = sorted(glob.glob(HTML_GLOB, recursive=True))
    if not files:
        print("ERROR: no files matched public/election/**/*.html — check CWD (run from repo root) and that `npm run build` has been run")
        sys.exit(2)

    hits = []
    exempted = 0
    pages_scanned = 0

    for path in files:
        raw = open(path, encoding="utf-8").read()
        soup = BeautifulSoup(raw, "html.parser")
        for tag in soup.find_all(["script", "style", "svg"]):
            tag.decompose()
        pages_scanned += 1

        # (a) emphasis-span corruption: scan the cleaned markup directly.
        markup = str(soup)
        for m in EMPHASIS_CORRUPTION_RE.finditer(markup):
            snippet = markup[max(0, m.start() - 30) : m.end() + 30]
            hits.append((path, "emphasis-span corruption (mid-token </em><em> boundary)", snippet))

        # (b) developer jargon: walk every text node.
        for node in soup.find_all(string=True):
            if not isinstance(node, NavigableString):
                continue
            text = str(node)
            if not text.strip():
                continue
            if is_verbatim_quote_node(node):
                for _desc, _matched in check_jargon_in_text(text):
                    exempted += 1
                continue
            for desc, matched in check_jargon_in_text(text):
                context = text.strip()
                if len(context) > 80:
                    idx = context.find(matched)
                    lo = max(0, idx - 30)
                    context = ("…" if lo > 0 else "") + context[lo : idx + len(matched) + 30] + "…"
                hits.append((path, desc, f"{matched!r} in {context!r}"))

    print(f"Scanned {pages_scanned} built page(s) under public/election/.")
    print(f"Exempted {exempted} match(es) as verbatim motion-quote table cells or unclassified-list bullets.")
    if hits:
        print(f"\nFAIL: {len(hits)} voter-facing-text defect(s) found:")
        for path, desc, detail in hits:
            print(f"  {path}  [{desc}]  {detail}")
        sys.exit(1)

    print("PASS: zero emphasis-span corruption, zero developer jargon, across all built Election Hub pages.")


if __name__ == "__main__":
    main()
