/**
 * Per-motion evidence anchors — the single definition, shared by the
 * emitter and every consumer.
 *
 * WHY THIS EXISTS. Hub evidence rows used to link to a *heading* anchor
 * predicted offline by re-implementing Quartz's slugger against the raw
 * markdown (see scripts/election/anchors.ts). That works for the majority
 * of rows, but it cannot work for a motion whose agenda item number is
 * shared by another heading on the same page: nothing in the heading text
 * distinguishes the two, so the link had to degrade to a bare meeting-page
 * link plus a disclaimer. It was also latently fragile — a github-slugger
 * "-1/-2" suffix depends on document order, so an unrelated new heading
 * earlier on the page can silently re-point a published link at a real but
 * WRONG motion.
 *
 * The fix is to stop predicting ids and start EMITTING them, at the one
 * place that knows which motion a heading belongs to: the Votes-section
 * generator (scripts/add-votes-to-pages.ts).
 *
 * THE KEY. `motion-<itemNumber>-<rollCallOrdinal>`, both fields taken
 * straight from data/votes/_all-motions.json, which BOTH generators
 * already read (no new data dependency, no new join).
 *
 * Explicitly NOT keyed on `AggregatedMotion.id`. That id is
 * sha256(date|meetingSlug|itemNumber|motionText|rollCallOrdinal) — it
 * embeds motionText, the most volatile field in the corpus. Replaying the
 * 2026-08-01 snapshot against HEAD, 17,450/17,450 shared ids (100%) had
 * changed, because a re-scrape routinely reflows a motion's prose. An
 * id-derived anchor would rot every published link on every scrape. The
 * natural key survives: (meetingSlug, itemNumber, rollCallOrdinal) is
 * unique across all 23,040 motions and all 16,652 substantive ones, and is
 * derived only from fields a re-scrape reproduces.
 *
 * NOT keyed on the tally, the result string, the item title or the heading
 * text either — same reason, plus 40.1% of substantive motions share a
 * result string with a same-item sibling, so result text cannot identify a
 * motion even in principle. scripts/election/verify-evidence-anchor-precision.py
 * enforces that with a grep-level guard.
 *
 * PLACEMENT. The anchor element is emitted immediately AFTER the motion's
 * `###` heading, never on it:
 *   - on it would mean rewriting the heading's own id, which is exactly the
 *     link rot this change is meant to prevent (and would change ids
 *     readers may already have bookmarked);
 *   - before it would make verify-evidence-links.ts's sectionAfterAnchor
 *     (which slices from the id to the NEXT <h1-6>) return an empty
 *     section, defeating the correctness check.
 * Emitting a separate element is additive: rehype-slug only assigns ids to
 * h1-h6 elements, so every existing auto-generated heading id is untouched.
 */

export const MOTION_ANCHOR_PREFIX = "motion-";

/**
 * Normalize an agenda item number into the id-safe portion of an anchor.
 *
 * Item numbers in the corpus are not all "8.1.13": there are lettered
 * sub-items ("4.5.b"), roman numerals ("XIII"), and — the reason this is
 * not just a dot-to-dash swap — hash forms like "10#2". A literal "#" in
 * an id would break the fragment AND trip Quartz's Obsidian-tag rewrite
 * (see stripHashTagRisk in generate-hub-pages.ts), so every non-alphanumeric
 * run collapses to a single hyphen.
 *
 * Verified against the whole corpus: this normalization introduces no new
 * collisions — (meetingSlug, normalizedItem, rollCallOrdinal) is still
 * unique across all 23,040 motions.
 */
export function normalizeItemNumber(itemNumber: string): string {
  const normalized = itemNumber
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // No motion in the corpus has an empty item number, but never emit a
  // malformed id if one ever appears.
  return normalized || "item";
}

/** The anchor id for one recorded motion, e.g. "motion-8-1-13-0". */
export function motionAnchorId(
  itemNumber: string,
  rollCallOrdinal: number,
): string {
  return `${MOTION_ANCHOR_PREFIX}${normalizeItemNumber(itemNumber)}-${rollCallOrdinal}`;
}

/**
 * The markdown/HTML the Votes-section generator writes.
 *
 * A <div>, deliberately, not an <a>. CommonMark only treats a raw-HTML line
 * as a BLOCK when its tag is on the block-tag list; <a> is not on it, so an
 * anchor written as `<a id=…></a>` comes back wrapped in a paragraph
 * (`<p><a …></a></p>`) and that empty paragraph's margins add visible
 * whitespace under every motion heading on 1,376 meeting pages. <div> is on
 * the list, so it passes through as its own block with no wrapper. Any
 * element with an id is a valid fragment target, so nothing else changes.
 *
 * Quartz parses this raw HTML into a real element (ObsidianFlavoredMarkdown
 * registers rehype-raw), and rehype-slug ignores it because it is not a
 * heading — which is what keeps this additive. `class` carries only a
 * scroll offset, so the motion's own heading stays on screen when a reader
 * taps through.
 */
export function motionAnchorHtml(anchorId: string): string {
  return `<div id="${anchorId}" class="motion-anchor"></div>`;
}

/** Matches an emitted anchor in a meeting page's markdown or HTML. The <a>
 * form is accepted too: it is what the first cut emitted, and anchors are
 * append-only, so a page carrying one must keep resolving. */
export const MOTION_ANCHOR_ID_PATTERN = /<(?:div|a) id="(motion-[a-z0-9-]+)"/g;
