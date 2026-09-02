/**
 * Election Hub — evidence-link integrity check
 *
 * For every evidence link on the issue pages and councillor stance pages
 * (built from data/election/issues.json + data/election/stances.json),
 * verifies that:
 *  1. The anchor resolves to a build-output HTML page that actually exists
 *     under public/ (a row anchors.ts marked `anchorAmbiguous` is expected
 *     to have no #fragment and is checked only for page existence — the
 *     fragment was deliberately omitted, not a bug).
 *  2. That page's content contains the cited motion's own result string
 *     (e.g. "Motion Failed (7 to 8)") within the anchor's own section (from
 *     the anchor's heading id up to the next heading), not just somewhere
 *     on the page — i.e. the link lands on the right motion, not just the
 *     right page.
 *  3. UNIQUENESS (hub-recheck verdict finding 14, added 2026-08-31): no
 *     #fragment is claimed by two rows with DIFFERENT itemNumbers — that
 *     would mean two genuinely different motions collided onto the same
 *     heading without anchors.ts catching it. Rows that legitimately share
 *     a fragment because they're different sub-motions of the SAME item
 *     number (e.g. amendment parts a/b/c under one agenda item — see
 *     anchors.ts's module doc) are expected and excluded from this check;
 *     only a same-fragment / different-itemNumber pairing counts as a
 *     violation. This is a check on EXISTENCE plus UNIQUENESS, not
 *     existence alone.
 *
 * Run after `npm run build` (needs public/ to exist).
 * Usage: npx tsx scripts/election/verify-evidence-links.ts
 */

import fs from "fs";
import path from "path";

const REPO_ROOT = process.cwd();
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const DATA_DIR = path.join(REPO_ROOT, "data", "election");

interface CheckResult {
  ok: boolean;
  reason?: string;
}

const htmlCache = new Map<string, string | null>();

/** Quartz slugifies each path segment of a source file's relative path
 * (spaces -> hyphens, among other things) to build its output URL — see
 * quartz/util/path.ts slugifyFilePath / slugSegment. Evidence links are
 * built from the RAW meetingSlug (with spaces), same as the rest of the
 * site's internal links, and Quartz's own link-resolution transform turns
 * those into the slugified output path at build time. This check needs the
 * same transform to find the actual emitted file on disk. */
function slugifySegment(segment: string): string {
  return segment.replace(/\s/g, "-").replace(/%20/g, "-").replace(/&/g, "-");
}

function loadHtml(urlPath: string): string | null {
  if (htmlCache.has(urlPath)) return htmlCache.get(urlPath)!;
  const decoded = decodeURIComponent(urlPath).replace(/^\//, "");
  const segments = decoded.split("/").map(slugifySegment);
  const filePath = path.join(PUBLIC_DIR, ...segments) + ".html";
  let html: string | null = null;
  if (fs.existsSync(filePath)) html = fs.readFileSync(filePath, "utf-8");
  htmlCache.set(urlPath, html);
  return html;
}

/** Extract the raw HTML from just after the element with the given id up to
 * the start of the next heading tag (h1-h6), or EOF. Best-effort text
 * search, not a real HTML parser — good enough to check "does the cited
 * result text appear in THIS motion's own section". */
function sectionAfterAnchor(html: string, anchorId: string): string | null {
  const idMarker = `id="${anchorId}"`;
  const idx = html.indexOf(idMarker);
  if (idx === -1) return null;
  const from = idx + idMarker.length;
  const nextHeading = html.slice(from).search(/<h[1-6]\b/i);
  const to = nextHeading === -1 ? html.length : from + nextHeading;
  return html.slice(from, to);
}

function checkEvidenceLink(
  anchor: string | null,
  resultText: string,
  anchorAmbiguous: boolean,
): CheckResult {
  if (!anchor) return { ok: false, reason: "null anchor" };
  const [urlPath, anchorId] = anchor.split("#");
  if (!anchorId) {
    // A row anchors.ts marked ambiguous deliberately has no #fragment
    // (see anchors.ts's AnchorResult doc) — that's the honest outcome when
    // two different headings share an item number and nothing in the
    // motion's own text disambiguates them; still verify the page itself
    // exists, but don't fail it for lacking a fragment it was never meant
    // to have.
    if (anchorAmbiguous) {
      const html = loadHtml(urlPath);
      return html === null
        ? { ok: false, reason: `build output missing for ${urlPath}` }
        : { ok: true };
    }
    return { ok: false, reason: "anchor has no #fragment" };
  }
  const html = loadHtml(urlPath);
  if (html === null)
    return { ok: false, reason: `build output missing for ${urlPath}` };
  const section = sectionAfterAnchor(html, anchorId);
  if (section === null)
    return {
      ok: false,
      reason: `anchor id "${anchorId}" not found in ${urlPath}`,
    };

  const tallyMatch = resultText.match(/\((\d+)\s*(?:to|[-–—])\s*(\d+)\)/i);
  const tally = tallyMatch ? `${tallyMatch[1]} to ${tallyMatch[2]}` : null;
  const passFail = /Motion Passed/i.test(resultText)
    ? "Motion Passed"
    : /Motion Failed/i.test(resultText)
      ? "Motion Failed"
      : null;

  if (tally && !section.includes(`(${tally})`)) {
    return {
      ok: false,
      reason: `tally "(${tally})" not found in anchor's own section`,
    };
  }
  if (passFail && !new RegExp(passFail, "i").test(section)) {
    return {
      ok: false,
      reason: `"${passFail}" not found in anchor's own section`,
    };
  }
  return { ok: true };
}

interface Row {
  source: string;
  motionId: string;
  itemNumber: string;
  anchor: string | null;
  anchorAmbiguous: boolean;
  result: string;
}

/** Uniqueness pass (finding 14): group every row that HAS a #fragment by
 * that exact fragment; any group whose rows carry more than one distinct
 * itemNumber is a real collision anchors.ts should have disambiguated or
 * marked ambiguous, and didn't. Rows sharing a fragment with the SAME
 * itemNumber (ordinary amendment sub-parts a/b/c under one item) are
 * expected and not flagged. */
function checkUniqueness(rows: Row[]): {
  motionId: string;
  anchor: string;
  reason: string;
}[] {
  const byFragment = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.anchor || !r.anchor.includes("#")) continue;
    const arr = byFragment.get(r.anchor) ?? [];
    arr.push(r);
    byFragment.set(r.anchor, arr);
  }

  const violations: { motionId: string; anchor: string; reason: string }[] = [];
  for (const [anchor, group] of byFragment) {
    const distinctItemNumbers = new Set(group.map((r) => r.itemNumber));
    if (distinctItemNumbers.size > 1) {
      const ids = [...new Set(group.map((r) => r.motionId))].join(", ");
      violations.push({
        motionId: ids,
        anchor,
        reason: `anchor shared by ${distinctItemNumbers.size} different item numbers (${[...distinctItemNumbers].join(", ")}) across motions ${ids} — not motion-unique`,
      });
    }
  }
  return violations;
}

function main() {
  const issues = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "issues.json"), "utf-8"),
  );
  const stances = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "stances.json"), "utf-8"),
  );

  let total = 0;
  let failures: {
    source: string;
    motionId: string;
    anchor: string | null;
    reason: string;
  }[] = [];
  const allRows: Row[] = [];

  for (const [issueSlug, issue] of Object.entries<any>(issues.issues)) {
    for (const v of issue.votes) {
      total++;
      const res = checkEvidenceLink(
        v.anchor,
        v.result,
        Boolean(v.anchorAmbiguous),
      );
      if (!res.ok)
        failures.push({
          source: `issue:${issueSlug}`,
          motionId: v.id,
          anchor: v.anchor,
          reason: res.reason!,
        });
      allRows.push({
        source: `issue:${issueSlug}`,
        motionId: v.id,
        itemNumber: `${v.meetingSlug}#${v.itemNumber}`,
        anchor: v.anchor,
        anchorAmbiguous: Boolean(v.anchorAmbiguous),
        result: v.result,
      });
    }
  }

  for (const [slug, c] of Object.entries<any>(stances.councillors)) {
    for (const issue of Object.values<any>(c.issues)) {
      for (const axis of issue.axes) {
        for (const ev of axis.evidence) {
          total++;
          const res = checkEvidenceLink(
            ev.anchor,
            ev.result,
            Boolean(ev.anchorAmbiguous),
          );
          if (!res.ok)
            failures.push({
              source: `councillor:${slug}`,
              motionId: ev.motionId,
              anchor: ev.anchor,
              reason: res.reason!,
            });
          // Not added to allRows: this is the SAME motion catalogued above
          // via issues.json (every direction-bearing motion is classified
          // into exactly one issue), just re-shown per-councillor — adding
          // it again would double-count every ordinary shared-heading case
          // as if it were a fresh collision.
        }
      }
    }
  }

  const uniquenessViolations = checkUniqueness(allRows);
  for (const v of uniquenessViolations) {
    failures.push({
      source: "uniqueness",
      motionId: v.motionId,
      anchor: v.anchor,
      reason: v.reason,
    });
  }

  console.log(
    `Checked ${total} evidence links (+ uniqueness across ${allRows.length} issue-page rows).`,
  );
  if (failures.length === 0) {
    console.log(
      "All evidence links resolve to a build-output page whose own section contains the cited motion's result, and no fragment is shared across different item numbers.",
    );
    process.exit(0);
  }

  console.log(`${failures.length} evidence link(s) FAILED:`);
  const byMotion = new Map<string, typeof failures>();
  for (const f of failures) {
    const arr = byMotion.get(f.motionId) ?? [];
    arr.push(f);
    byMotion.set(f.motionId, arr);
  }
  for (const [motionId, group] of byMotion) {
    console.log(
      `  motion ${motionId} (${group.length} instance(s)): ${group[0].reason} — anchor: ${group[0].anchor}`,
    );
  }
  process.exit(1);
}

main();
