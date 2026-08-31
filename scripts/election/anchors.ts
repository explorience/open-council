/**
 * Election Hub — evidence link anchors
 *
 * Quartz assigns heading ids the same way its own TOC transformer does:
 * parse the heading's markdown to plain text (mdast-util-to-string, which
 * decodes HTML entities like &nbsp; and drops link URLs but keeps link
 * text) and run it through github-slugger, per-page, in document order
 * (so repeated headings get -1/-2 suffixes). See quartz/plugins/transformers/toc.ts.
 *
 * This module replicates that exactly against the real meeting markdown
 * files so evidence links land on the right item heading, instead of
 * guessing at Quartz's slug algorithm from memory.
 */

import fs from "fs";
import path from "path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toString as mdastToString } from "mdast-util-to-string";
import GithubSlugger from "github-slugger";
import type { Root, Heading } from "mdast";

const CONTENT_DIR = path.join(process.cwd(), "content");
const parser = unified().use(remarkParse);

interface AnchorOccurrence {
  slug: string;
  /** Raw markdown from just after this heading up to the next heading (any
   * level) or EOF — used to disambiguate which occurrence a given motion's
   * result belongs to, when an item number repeats with genuinely different
   * motions under it (see motionAnchor). */
  sectionText: string;
}

// meetingSlug -> item number (leading digits+dots on the heading, e.g.
// "8.1.11") -> every heading occurrence for that item number, in document
// order, or null if no markdown file was found.
const fileAnchorCache = new Map<
  string,
  Map<string, AnchorOccurrence[]> | null
>();

function findMarkdownFile(meetingSlug: string): string | null {
  const direct = path.join(CONTENT_DIR, `${meetingSlug}.md`);
  if (fs.existsSync(direct)) return direct;

  const dir = path.dirname(direct);
  const base = path.basename(meetingSlug);
  const dateMatch = base.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch || !fs.existsSync(dir)) return null;

  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.startsWith(dateMatch[1]));
  if (candidates.length === 1) return path.join(dir, candidates[0]);

  const exact = `${base}.md`;
  if (candidates.includes(exact)) return path.join(dir, exact);

  return null;
}

/** Item-number label leading a heading, e.g. "8.1.11" from
 * "### 8.1.11&nbsp;&nbsp;&nbsp;[(2.7)](...) Award of ...". Trailing "." stripped. */
function extractItemNumber(headingText: string): string | null {
  const m = headingText.match(/^(\d+(?:\.\d+)*)\.?(?:\s|$)/);
  return m ? m[1] : null;
}

function buildAnchorIndex(mdPath: string): Map<string, AnchorOccurrence[]> {
  const raw = fs.readFileSync(mdPath, "utf-8");
  const lines = raw.split("\n");
  const slugger = new GithubSlugger();
  const index = new Map<string, AnchorOccurrence[]>();

  // First pass: find every heading line, its slug, and its item number.
  const headings: {
    lineIdx: number;
    slug: string;
    itemNumber: string | null;
  }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^#{1,6}\s/.test(line)) continue;
    const tree = parser.parse(line) as Root;
    const headingNode = tree.children.find(
      (c): c is Heading => c.type === "heading",
    );
    if (!headingNode) continue;
    const text = mdastToString(headingNode);
    const slug = slugger.slug(text);
    headings.push({ lineIdx: i, slug, itemNumber: extractItemNumber(text) });
  }

  // Second pass: for each heading, capture the raw text from just after it
  // up to the next heading (any level) or EOF, and — for headings that
  // carry an item number — record every occurrence (not just the first),
  // so a repeated item number (multiple genuinely different motions under
  // the same numbered agenda item) can be disambiguated by content later.
  for (let h = 0; h < headings.length; h++) {
    const { lineIdx, slug, itemNumber } = headings[h];
    if (!itemNumber) continue;
    const nextLineIdx =
      h + 1 < headings.length ? headings[h + 1].lineIdx : lines.length;
    const sectionText = lines.slice(lineIdx + 1, nextLineIdx).join("\n");
    const occurrences = index.get(itemNumber) ?? [];
    occurrences.push({ slug, sectionText });
    index.set(itemNumber, occurrences);
  }

  return index;
}

/** Pull a "(N to M)" vote-tally fragment out of a motion result string, e.g.
 * "Motion Failed (7 to 8)" -> "7 to 8". Tolerant of the en/em dash variants
 * and extra whitespace some source pages use. */
function extractTally(resultText: string): string | null {
  const m = resultText.match(/\((\d+)\s*(?:to|[-–—])\s*(\d+)\)/i);
  return m ? `${m[1]} to ${m[2]}` : null;
}

/**
 * Best-effort evidence link for a motion: `/<meetingSlug>#<anchor>` or null
 * if the source file couldn't be located or no heading matched the item
 * number. Multiple motion parts under the same item (a, b, c...) normally
 * share one heading and therefore one anchor — that's how the source pages
 * are laid out, so a reader lands on the item and reads down to their part.
 *
 * Some meetings have an item number that repeats with genuinely different
 * motions under it (e.g. item 12 "Emergent Motions" used twice in one
 * meeting for two unrelated motions). When that happens, `resultText` (the
 * motion's own "Motion Passed/Failed (N to M)" string) is used to pick the
 * occurrence whose rendered section actually contains that tally, instead
 * of always landing on the first occurrence. Falls back to the first
 * occurrence if no section's tally matches (e.g. resultText omitted, or the
 * tally text doesn't appear verbatim) — same behavior as before this
 * disambiguation existed.
 */
export function motionAnchor(
  meetingSlug: string,
  itemNumber: string,
  resultText?: string,
): string | null {
  let index = fileAnchorCache.get(meetingSlug);
  if (index === undefined) {
    const mdPath = findMarkdownFile(meetingSlug);
    index = mdPath ? buildAnchorIndex(mdPath) : null;
    fileAnchorCache.set(meetingSlug, index);
  }
  if (!index) return null;

  const occurrences = index.get(itemNumber);
  if (!occurrences || occurrences.length === 0) return null;
  if (occurrences.length === 1) return `/${meetingSlug}#${occurrences[0].slug}`;

  const tally = resultText ? extractTally(resultText) : null;
  if (tally) {
    const match = occurrences.find((occ) =>
      occ.sectionText.includes(`(${tally})`),
    );
    if (match) return `/${meetingSlug}#${match.slug}`;
  }

  return `/${meetingSlug}#${occurrences[0].slug}`;
}
