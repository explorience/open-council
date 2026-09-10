/**
 * The honest fallback must keep working even when nothing currently uses it.
 *
 * Per-motion anchors now cover every published hub evidence row, so the
 * fallback path in anchors.ts is dormant on today's corpus. Dormant is not
 * dead: pre-2018 minutes carry no generated Votes section (and sometimes no
 * headings at all), and a future re-scrape can produce a meeting whose page
 * has no anchor for a motion. If that path silently rotted, those rows
 * would publish a fragment pointing at the wrong motion — the exact failure
 * this whole change exists to prevent.
 *
 * These tests drive anchors.ts against synthetic meeting pages, so they
 * exercise all three outcomes without depending on the live corpus:
 *   1. precise  — the page carries the per-motion anchor for this roll call
 *   2. legacy   — no per-motion anchor, but the item's heading is unique
 *   3. fallback — no per-motion anchor and the item number is shared by two
 *                 genuinely different motions: page link, ambiguous: true
 *
 * Run: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "anchors-fallback-"));
const meetingDir = path.join(tmpRoot, "content", "months", "2014-06");
fs.mkdirSync(meetingDir, { recursive: true });

const SLUG_PRECISE = "months/2014-06/2014-06-09 Precise Meeting";
const SLUG_LEGACY = "months/2014-06/2014-06-09 Legacy Meeting";
const SLUG_AMBIGUOUS = "months/2014-06/2014-06-09 Ambiguous Meeting";

fs.writeFileSync(
  path.join(meetingDir, "2014-06-09 Precise Meeting.md"),
  [
    "## Votes",
    "",
    "### 2. 2014 Development Charges By-law",
    "",
    '<a id="motion-2-0" class="motion-anchor"></a>',
    "",
    "**Motion Passed (10 to 3)**",
    "",
    "### 2. 2014 Development Charges By-law",
    "",
    '<a id="motion-2-4" class="motion-anchor"></a>',
    "",
    "**Motion Passed (8 to 4)**",
    "",
  ].join("\n"),
);

// No Votes section at all — one heading per item, so the legacy heading
// resolver can still identify it.
fs.writeFileSync(
  path.join(meetingDir, "2014-06-09 Legacy Meeting.md"),
  ["### 5. Sole Item", "", "Motion Passed (9 to 4)", ""].join("\n"),
);

// No Votes section, and item 12 is reused for two genuinely different
// motions with the SAME result string — provably indistinguishable by
// content, which is what the fallback exists for.
fs.writeFileSync(
  path.join(meetingDir, "2014-06-09 Ambiguous Meeting.md"),
  [
    "### 12. Emergent Motions",
    "",
    "Kensington bridge rehabilitation deferral. Motion Passed (9 to 4)",
    "",
    "### 12. Emergent Motions",
    "",
    "Airport terminal lease amendment. Motion Passed (9 to 4)",
    "",
  ].join("\n"),
);

const cwdBefore = process.cwd();
process.chdir(tmpRoot);
// anchors.ts resolves its content dir from process.cwd() at module load, so
// the import has to happen after the chdir.
const { motionEvidenceAnchor } = await import("./anchors.js");
process.chdir(cwdBefore);

test("uses the per-motion anchor emitted for this exact roll call", () => {
  const result = motionEvidenceAnchor({
    meetingSlug: SLUG_PRECISE,
    itemNumber: "2",
    rollCallOrdinal: 4,
    result: "Motion Passed (8 to 4)",
  });
  assert.equal(result?.url, `/${SLUG_PRECISE}#motion-2-4`);
  assert.equal(result?.precise, true);
  assert.equal(result?.ambiguous, false);
});

test("does not confuse two roll calls under one shared heading", () => {
  const first = motionEvidenceAnchor({
    meetingSlug: SLUG_PRECISE,
    itemNumber: "2",
    rollCallOrdinal: 0,
    result: "Motion Passed (10 to 3)",
  });
  const second = motionEvidenceAnchor({
    meetingSlug: SLUG_PRECISE,
    itemNumber: "2",
    rollCallOrdinal: 4,
    result: "Motion Passed (8 to 4)",
  });
  assert.notEqual(first?.url, second?.url);
});

test("falls back to the heading slug when the page has no per-motion anchor", () => {
  const result = motionEvidenceAnchor({
    meetingSlug: SLUG_LEGACY,
    itemNumber: "5",
    rollCallOrdinal: 0,
    result: "Motion Passed (9 to 4)",
  });
  assert.equal(result?.url, `/${SLUG_LEGACY}#5-sole-item`);
  assert.equal(result?.precise, false);
  assert.equal(result?.ambiguous, false);
});

test("keeps the honest page-only fallback when no anchor can be right", () => {
  const result = motionEvidenceAnchor({
    meetingSlug: SLUG_AMBIGUOUS,
    itemNumber: "12",
    rollCallOrdinal: 0,
    result: "Motion Passed (9 to 4)",
  });
  assert.equal(result?.url, `/${SLUG_AMBIGUOUS}`);
  assert.equal(result?.ambiguous, true);
  assert.equal(result?.precise, false);
  assert.ok(!result?.url.includes("#"), "must not guess a fragment");
});

test("a computed anchor is never published unless the page really has it", () => {
  // Same page as the precise case, but an ordinal the page carries no
  // anchor for: the id is computable, yet must not be emitted on faith.
  const result = motionEvidenceAnchor({
    meetingSlug: SLUG_PRECISE,
    itemNumber: "2",
    rollCallOrdinal: 9,
    result: "Motion Passed (11 to 1)",
  });
  assert.ok(
    !result?.url.includes("#motion-2-9"),
    "must not publish an anchor that is absent from the page",
  );
  assert.equal(result?.precise, false);
});
