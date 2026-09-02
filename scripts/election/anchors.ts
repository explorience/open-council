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

// Meeting pages routinely present the SAME real vote twice: once as "raw
// minutes" (moved-by/seconded-by prose + a yea/nay table) and again, later
// in the same document, as a compact "roll call summary" (a <details> block
// under a duplicate heading with the identical item number and tally) —
// found 2026-08-31 while extending disambiguation past the original
// "Emergent Motions" case: EVERY Budget Committee business-case item hits
// this, so requiring an EXACT single tally+pass/fail match flagged the
// overwhelming majority of budget evidence rows as "ambiguous" when both
// candidate headings describe the identical event and either is a correct
// link. True ambiguity (two DIFFERENT motions coincidentally sharing an
// item number AND a tally, e.g. two distinct "Emergent Motions") is told
// apart from this "same vote, shown twice" case by comparing the sections'
// own text: a real duplicate shares most of its substantive vocabulary
// (the motion's own prose, repeated), while two unrelated motions don't.
const STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "were",
  "have",
  "been",
  "will",
  "shall",
  "motion",
  "moved",
  "seconded",
  "yeas",
  "nays",
  "yea",
  "nay",
  "passed",
  "failed",
  "view",
  "roll",
  "call",
  "details",
  "summary",
  "councillor",
  "mayor",
  "committee",
]);

function significantWords(text: string): Set<string> {
  const words =
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, " ")
      .match(/[a-z]{4,}/g) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)));
}

/** Fraction of the SMALLER word set also present in the other — 1.0 means
 * one is a subset of the other's vocabulary (strong sign of duplicated
 * content), 0 means no shared vocabulary at all. */
function wordOverlapRatio(a: string, b: string): number {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

/** True when every pairing among the given occurrences shares enough
 * vocabulary to be confident they describe the same real vote, presented
 * more than once on the page (see the comment above) — safe to pick any
 * one of them, not genuine ambiguity. */
const DUPLICATE_CONTENT_THRESHOLD = 0.6;
function allLikelyDuplicates(occs: AnchorOccurrence[]): boolean {
  for (let i = 0; i < occs.length; i++) {
    for (let j = i + 1; j < occs.length; j++) {
      if (
        wordOverlapRatio(occs[i].sectionText, occs[j].sectionText) <
        DUPLICATE_CONTENT_THRESHOLD
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Pull a "(N to M)" vote-tally fragment out of a motion result string, e.g.
 * "Motion Failed (7 to 8)" -> "7 to 8". Tolerant of the en/em dash variants
 * and extra whitespace some source pages use. */
function extractTally(resultText: string): string | null {
  const m = resultText.match(/\((\d+)\s*(?:to|[-–—])\s*(\d+)\)/i);
  return m ? `${m[1]} to ${m[2]}` : null;
}

export interface AnchorResult {
  /** `/<meetingSlug>#<slug>` when a specific heading was identified —
   * including the common, EXPECTED case of several motion rows (amendment
   * parts a, b, c...) correctly sharing one real heading, because that's
   * how the source page is laid out (a reader lands on the item and reads
   * down to their part; see module doc). `/<meetingSlug>` with no fragment
   * when no single heading could be identified — either the item number
   * doesn't appear on the page at all, or (see `ambiguous`) more than one
   * DIFFERENT heading shares this item number and nothing in the motion's
   * own result text tells them apart. */
  url: string;
  /** True only when this item number genuinely collided with another,
   * different heading occurrence on the same page, and no available signal
   * (tally, pass/fail) uniquely picked one — so `url` deliberately omits
   * the fragment rather than guess (hub-recheck verdict finding 14: two
   * such collision groups have identical result strings, so guessing here
   * would silently point some rows at the wrong motion). False for the
   * ordinary case of one real heading correctly shared by several
   * sub-motions — that isn't ambiguity, it's the source page's own
   * structure. */
  ambiguous: boolean;
}

/**
 * Best-effort evidence link for a motion. Multiple motion parts under the
 * same item (a, b, c...) normally share one heading and therefore one
 * anchor — that's how the source pages are laid out, so a reader lands on
 * the item and reads down to their part; `ambiguous` is false in that case.
 *
 * Some meetings have an item number that repeats with genuinely different
 * motions under it (e.g. item 12 "Emergent Motions" used twice in one
 * meeting for two unrelated motions). When that happens, `resultText` (the
 * motion's own "Motion Passed/Failed (N to M)" string) is used to pick the
 * occurrence whose rendered section actually contains BOTH that tally and
 * the matching Passed/Failed word — extended 2026-08-31 (hub-recheck
 * verdict finding 14) to try every remaining collision this way, not just
 * the one case the original fix targeted, and to fall back to tally alone
 * only if that's already unique. When even that can't narrow it to exactly
 * one occurrence — including the two collision groups where two different
 * motions share an identical result string, so no signal in the text can
 * tell them apart even in principle — `ambiguous: true` is returned with a
 * page-only URL instead of guessing at occurrences[0].
 */
export function motionAnchor(
  meetingSlug: string,
  itemNumber: string,
  resultText?: string,
): AnchorResult | null {
  let index = fileAnchorCache.get(meetingSlug);
  if (index === undefined) {
    const mdPath = findMarkdownFile(meetingSlug);
    index = mdPath ? buildAnchorIndex(mdPath) : null;
    fileAnchorCache.set(meetingSlug, index);
  }
  if (!index) return null;

  const occurrences = index.get(itemNumber);
  if (!occurrences || occurrences.length === 0) return null;
  if (occurrences.length === 1)
    return { url: `/${meetingSlug}#${occurrences[0].slug}`, ambiguous: false };

  const tally = resultText ? extractTally(resultText) : null;
  const passFail = resultText
    ? /Motion\s+Passed/i.test(resultText)
      ? "Motion Passed"
      : /Motion\s+Failed/i.test(resultText)
        ? "Motion Failed"
        : null
    : null;

  // Strongest signal: both the tally AND the pass/fail word present in the
  // same occurrence's section.
  const strongMatches =
    tally || passFail
      ? occurrences.filter((occ) => {
          const tallyOk = !tally || occ.sectionText.includes(`(${tally})`);
          const passFailOk =
            !passFail || new RegExp(passFail, "i").test(occ.sectionText);
          return tallyOk && passFailOk;
        })
      : [];
  if (strongMatches.length === 1)
    return {
      url: `/${meetingSlug}#${strongMatches[0].slug}`,
      ambiguous: false,
    };

  // Tally alone, if it already narrows to exactly one occurrence (original
  // fix's behavior, kept as a fallback for results the pass/fail regex
  // doesn't recognize).
  const tallyMatches = tally
    ? occurrences.filter((occ) => occ.sectionText.includes(`(${tally})`))
    : [];
  if (tallyMatches.length === 1)
    return { url: `/${meetingSlug}#${tallyMatches[0].slug}`, ambiguous: false };

  // More than one occurrence still matches (or none of the signals above
  // narrowed anything). Before declaring ambiguity, check whether the
  // remaining candidates are all the SAME real vote presented more than
  // once on the page (see allLikelyDuplicates above) — if so, any of them
  // is a correct link, so pick the first deterministically rather than
  // send the reader to a bare page-link for something that isn't actually
  // uncertain.
  const candidates =
    strongMatches.length > 1
      ? strongMatches
      : tallyMatches.length > 1
        ? tallyMatches
        : occurrences;
  if (candidates.length > 1 && allLikelyDuplicates(candidates)) {
    return { url: `/${meetingSlug}#${candidates[0].slug}`, ambiguous: false };
  }

  // Genuinely ambiguous: multiple DIFFERENT headings share this item number
  // and nothing in the motion's own result text or the sections' own
  // content disambiguates them. Link the meeting page itself rather than
  // guess which heading is right.
  return { url: `/${meetingSlug}`, ambiguous: true };
}
