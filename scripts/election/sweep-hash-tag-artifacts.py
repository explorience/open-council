#!/usr/bin/env python3
"""
Round-5 gate item 5 sweep: proves zero '#'-token tag-parsing artifacts
remain in the generated Election Hub content — both in the markdown source
(content/election/) and, where a build exists, the rendered HTML
(public/election/) as junk /tags/... targets.

DETECTION RULE (the whole rule, not a summary):

  1. Markdown source (content/election/**/*.md): any '#' character
     immediately followed by a word character AND preceded by either the
     start of a line or a space — the exact pattern Quartz's Obsidian-tag
     plugin matches (quartz/plugins/transformers/ofm.ts tagRegex:
     `(?<=^| )#(word chars...)`). generate-hub-pages.ts's tcell() now
     rewrites every "#P-5"-style reference to "No. P-5" at generation time
     (see stripHashTagRisk), so this pattern should never appear in
     generated markdown again. A hit here is a FAIL — it means some text
     field bypassed tcell(), or a new call site was added without it.

  2. Rendered HTML (public/election/**/*.html), if a build is present: any
     anchor tag whose class list includes "tag-link" and whose href starts
     with a /tags/ path ending in a business-case-shaped slug (a bare
     capital-P-then-digits pattern, e.g. /tags/p-5, /tags/p-31 — the exact
     shape these motions' business-case numbers slugify to). A hit here is a
     FAIL — it means the tag-link the source data caused still made it into
     the build. HTML scan is skipped (reported, not failed) if public/ has
     not been rebuilt since this fix landed, since it may still hold a
     stale pre-fix build.

Usage: python3 scripts/election/sweep-hash-tag-artifacts.py
"""
import glob
import re
import sys
import os

MD_GLOB = "content/election/**/*.md"
HTML_GLOB = "public/election/**/*.html"

MD_TAG_RE = re.compile(r"(?:^|(?<= ))#(?=\w)")
HTML_JUNK_TAG_RE = re.compile(
    r'<a href="[^"]*?/tags/p-\d[^"]*"[^>]*class="[^"]*tag-link[^"]*"', re.IGNORECASE
)


def scan_markdown():
    files = sorted(glob.glob(MD_GLOB, recursive=True))
    hits = []
    for path in files:
        for line_no, line in enumerate(open(path, encoding="utf-8"), start=1):
            for m in MD_TAG_RE.finditer(line):
                hits.append((path, line_no, line[max(0, m.start() - 20):m.start() + 20].strip()))
    return files, hits


def scan_html():
    files = sorted(glob.glob(HTML_GLOB, recursive=True))
    hits = []
    for path in files:
        text = open(path, encoding="utf-8").read()
        for m in HTML_JUNK_TAG_RE.finditer(text):
            line_no = text.count("\n", 0, m.start()) + 1
            hits.append((path, line_no, m.group(0)[:120]))
    return files, hits


def main():
    md_files, md_hits = scan_markdown()
    if not md_files:
        print("ERROR: no files matched content/election/**/*.md — check CWD (run from repo root)")
        sys.exit(2)

    print(f"Scanned {len(md_files)} markdown files under content/election/.")
    if md_hits:
        print(f"\nFAIL (markdown): {len(md_hits)} '#'-token artifact(s):")
        for path, line_no, ctx in md_hits[:50]:
            print(f"  {path}:{line_no}  ...{ctx}...")
        if len(md_hits) > 50:
            print(f"  ... and {len(md_hits) - 50} more")
    else:
        print("PASS (markdown): zero '#'-token artifacts.")

    html_files, html_hits = scan_html()
    if html_files:
        print(f"\nScanned {len(html_files)} built HTML files under public/election/.")
        if html_hits:
            print(f"FAIL (html): {len(html_hits)} junk business-case /tags/ link(s):")
            for path, line_no, ctx in html_hits[:50]:
                print(f"  {path}:{line_no}  {ctx}")
            if len(html_hits) > 50:
                print(f"  ... and {len(html_hits) - 50} more")
        else:
            print("PASS (html): zero junk business-case /tags/ links in the built output.")
    else:
        print("\nNo public/election/**/*.html found — HTML check skipped (run `npm run build` first to include it).")

    if md_hits or html_hits:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
