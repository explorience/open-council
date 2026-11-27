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
 *  3. IDENTITY (replaces the old fragment-uniqueness pass, 2026-09-09).
 *     Every row whose anchor is a per-motion anchor must carry EXACTLY the
 *     id derived from that row's own natural key — motion-<itemNumber>-
 *     <rollCallOrdinal>, recomputed here from the row's own fields rather
 *     than trusted from the generator. A row pointing at a sibling roll
 *     call under the same item now fails, which is precisely the silent
 *     mis-point the old result-string oracle could not see (40.1% of
 *     substantive motions share a result string with a same-item sibling).
 *
 *     The old pass grouped rows by fragment and flagged only a fragment
 *     shared across DIFFERENT item numbers. Against motion-id anchors that
 *     check is vacuous — such fragments are unique by construction — so it
 *     would have passed silently forever. It is kept, narrowed to the rows
 *     that still use a legacy heading slug, where it is still meaningful.
 *
 * Checks 1 and 2 are deliberately retained as an INDEPENDENT correctness
 * net: check 3 proves the anchor is the one the natural key implies, and
 * checks 1-2 prove the page really carries that anchor and that the motion
 * sitting at it is the one the row describes.
 *
 * Run after `npm run build` (needs public/ to exist).
 * Usage: npx tsx scripts/election/verify-evidence-links.ts
 */

import fs from "fs";
import path from "path";
import { motionAnchorId, MOTION_ANCHOR_PREFIX } from "../motion-anchor.js";

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
  meetingSlug: string;
  itemNumber: string;
  rollCallOrdinal: number;
  anchor: string | null;
  anchorAmbiguous: boolean;
  anchorPrecise: boolean;
  result: string;
}

/** Check 3, part A — IDENTITY. For every row whose anchor is a per-motion
 * anchor, recompute the id from the row's OWN natural key and require an
 * exact match. This is the check that catches a fragment silently swapped
 * to a same-item sibling, which the result-string oracle in
 * checkEvidenceLink cannot see when the siblings share a result string. */
function checkAnchorIdentity(rows: Row[]): {
  motionId: string;
  anchor: string;
  reason: string;
}[] {
  const violations: { motionId: string; anchor: string; reason: string }[] = [];
  for (const r of rows) {
    if (!r.anchor) continue;
    const fragment = r.anchor.split("#")[1];
    const expected = motionAnchorId(r.itemNumber, r.rollCallOrdinal);

    if (r.anchorPrecise) {
      if (fragment !== expected) {
        violations.push({
          motionId: r.motionId,
          anchor: r.anchor,
          reason: `row is marked precise but its fragment is "${fragment ?? "(none)"}", not the id its own key implies ("${expected}") — it points at a different roll call`,
        });
      }
      continue;
    }
    // Not marked precise: it must NOT be wearing a per-motion fragment,
    // otherwise a fallback row is being published as if it were verified.
    if (fragment?.startsWith(MOTION_ANCHOR_PREFIX)) {
      violations.push({
        motionId: r.motionId,
        anchor: r.anchor,
        reason: `row carries per-motion fragment "${fragment}" but is not marked anchorPrecise — an unverified anchor is being published as a precise one`,
      });
    }
  }
  return violations;
}

/** Check 3, part B — COLLISION. Two rows describing DIFFERENT roll calls
 * must never share one fragment. Kept from the original finding-14 pass and
 * strengthened: the key is now the full natural key (meeting + item +
 * roll-call ordinal), not the item number alone, so two different roll
 * calls under one item count as a collision instead of being waved through
 * as "ordinary sub-parts". Rows that legitimately repeat the SAME motion
 * (the same key, re-shown on another page) are not flagged. */
function checkFragmentCollisions(rows: Row[]): {
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
    const keys = new Set(
      group.map((r) => `${r.meetingSlug}|${r.itemNumber}|${r.rollCallOrdinal}`),
    );
    if (keys.size > 1) {
      const ids = [...new Set(group.map((r) => r.motionId))].join(", ");
      violations.push({
        motionId: ids,
        anchor,
        reason: `anchor shared by ${keys.size} different roll calls (${[...keys].join(" / ")}) across motions ${ids} — not motion-unique`,
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
  const identityRows: Row[] = [];

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
        meetingSlug: v.meetingSlug,
        itemNumber: v.itemNumber,
        rollCallOrdinal: v.rollCallOrdinal,
        anchor: v.anchor,
        anchorAmbiguous: Boolean(v.anchorAmbiguous),
        anchorPrecise: Boolean(v.anchorPrecise),
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
          // Not added to allRows (the COLLISION pass): this is the SAME
          // motion catalogued above via issues.json (every direction-bearing
          // motion is classified into exactly one issue), just re-shown
          // per-councillor — adding it again would double-count every
          // ordinary shared-heading case as if it were a fresh collision.
          // It IS added to the IDENTITY pass below, because that check is
          // per-row and these are the rows carrying most of the hub's
          // councillor-page evidence.
          identityRows.push({
            source: `councillor:${slug}`,
            motionId: ev.motionId,
            meetingSlug: ev.meetingSlug,
            itemNumber: ev.itemNumber,
            rollCallOrdinal: ev.rollCallOrdinal,
            anchor: ev.anchor,
            anchorAmbiguous: Boolean(ev.anchorAmbiguous),
            anchorPrecise: Boolean(ev.anchorPrecise),
            result: ev.result,
          });
        }
      }
    }
  }

  const identityViolations = checkAnchorIdentity([...allRows, ...identityRows]);
  for (const v of identityViolations) {
    failures.push({
      source: "identity",
      motionId: v.motionId,
      anchor: v.anchor,
      reason: v.reason,
    });
  }

  const collisionViolations = checkFragmentCollisions(allRows);
  for (const v of collisionViolations) {
    failures.push({
      source: "collision",
      motionId: v.motionId,
      anchor: v.anchor,
      reason: v.reason,
    });
  }

  const preciseRows = [...allRows, ...identityRows].filter(
    (r) => r.anchorPrecise,
  );
  console.log(
    `Checked ${total} evidence links (identity across ${allRows.length + identityRows.length} rows, ${preciseRows.length} of them per-motion anchors; collision across ${allRows.length} issue-page rows).`,
  );
  if (failures.length === 0) {
    console.log(
      "All evidence links resolve to a build-output page whose own section contains the cited motion's result, every per-motion anchor is exactly the id its own roll-call key implies, and no fragment is shared by two different roll calls.",
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
