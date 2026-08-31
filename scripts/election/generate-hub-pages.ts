/**
 * Election Hub — page generator
 *
 * Reads data/election/issues.json + data/election/stances.json (built by
 * generate-stances.ts) plus data/election/wards.json and
 * data/councillors/registry.json, and writes the Election Hub's markdown
 * pages into content/election/. Mirrors the pattern in
 * scripts/generate-pages.ts: deterministic, data-in / markdown-out, safe to
 * re-run.
 *
 * This is a LENS on the real site (see quartz/styles/election-hub.scss for
 * the self-contained styling layer these pages opt into via
 * `cssclasses: [election-hub]`) — it does not touch global layout, global
 * styles, or any non-election content.
 *
 * Usage: npx tsx scripts/election/generate-hub-pages.ts
 */

import fs from "fs/promises";
import path from "path";
import { loadRegistry } from "../../lib/councillors/registry.js";

const REPO_ROOT = process.cwd();
const DATA_DIR = path.join(REPO_ROOT, "data", "election");
const CONTENT_DIR = path.join(REPO_ROOT, "content", "election");

// ---------------------------------------------------------------------------
// Types (mirror the shapes emitted by generate-stances.ts)
// ---------------------------------------------------------------------------

interface Tally {
  yea: number;
  nay: number;
  recuse: number;
  absent: number;
  abstain: number;
  other: number;
}

interface DirectionInfo {
  axis: string | null;
  valence?: number;
  label: string;
  axisLabels?: { expansive: string; restrictive: string };
}

interface IssueVote {
  id: string;
  date: string;
  meetingSlug: string;
  meetingTitle: string;
  meetingType: string;
  meetingUrl: string;
  itemNumber: string;
  itemTitle: string;
  motionText: string;
  result: string;
  passed: boolean;
  margin: number;
  tally: Tally;
  anchor: string | null;
  matchedKeywords: string[];
  direction: DirectionInfo;
  positions: Record<string, string>;
}

interface IssueEntry {
  label: string;
  dividedVoteCount: number;
  directionBearingVoteCount: number;
  votes: IssueVote[];
}

interface UnclassifiedSample {
  id: string;
  date: string;
  itemNumber: string;
  itemTitle: string;
}

interface IssuesFile {
  generatedAt: string;
  cutoffDate: string;
  methodology: string;
  unclassified: { count: number; note: string; sample: UnclassifiedSample[] };
  issues: Record<string, IssueEntry>;
}

interface EvidenceRow {
  motionId: string;
  date: string;
  meetingSlug: string;
  meetingTitle: string;
  meetingType: string;
  meetingUrl: string;
  itemNumber: string;
  itemTitle: string;
  anchor: string | null;
  result: string;
  tally: string;
  theirVote: string;
}

interface AxisStance {
  axis: string;
  axisLabels: { expansive: string; restrictive: string };
  sampleSize: number;
  for: number;
  against: number;
  forPct: string;
  recused: number;
  absent: number;
  abstain: number;
  other: number;
  pattern: string;
  evidence: EvidenceRow[];
}

interface IssueStance {
  issueLabel: string;
  divisionsInCorpus: number;
  overall: {
    sampleSize: number;
    for: number;
    against: number;
    recused: number;
    absent: number;
    abstain: number;
    other: number;
  };
  axes: AxisStance[];
}

interface CouncillorStance {
  displayName: string;
  role: string;
  issues: Record<string, IssueStance>;
}

interface StancesFile {
  generatedAt: string;
  cutoffDate: string;
  methodology: string;
  councillors: Record<string, CouncillorStance>;
}

interface WardEntry {
  ward: number;
  currentRepSlug: string;
  boundaryChanged2026: boolean;
  incumbent2026Note: string | null;
  source?: string;
}

interface WardsFile {
  currentTermEndsNote: string;
  boundaryReviewSource: string;
  candidateListSource: string;
  candidateListLastChecked: string;
  cityWardMapTool: string;
  wards: WardEntry[];
  unresolvedNote: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Escape a string for safe use inside a markdown table cell. */
function tcell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Link to an internal page whose path may contain spaces/parens (meeting
 * slugs do) — wrap the destination in angle brackets, matching the
 * convention already used in scripts/generate-pages.ts. */
function link(text: string, destPath: string): string {
  return `[${tcell(text)}](<${destPath}>)`;
}

/** Best-effort link to the underlying motion: prefer the precomputed
 * heading anchor; fall back to the bare meeting page if the anchor is
 * missing (per the stance-engine's guidance — never treat a null anchor as
 * an error). */
function motionLink(
  text: string,
  anchor: string | null,
  meetingSlug: string,
): string {
  const dest = anchor ?? `/${meetingSlug}`;
  return link(text, dest);
}

const VOTE_LABEL: Record<string, string> = {
  yea: "Yea",
  nay: "Nay",
  recuse: "Recused",
  absent: "Absent",
  abstain: "Abstained",
  other: "Other",
};

const STANDING_DISCLAIMER = `> **This is a descriptive record, not an endorsement.** Every pattern below is built from real recorded votes since 2023, translated from raw yea/nay into what the vote actually did (see [What Council Actually Controls](/election/what-council-controls) for how much of this any of them controls). It says nothing about a councillor's reasons, character, or fitness for office — only how they voted. Votes with no clear direction ("unclear") are excluded from the pattern counts but stay linked below for transparency, and every row links to the real motion so you can read it yourself.`;

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

async function loadJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Landing page: /election
// ---------------------------------------------------------------------------

function generateIndexPage(issues: IssuesFile, stances: StancesFile): string {
  const councillorSlugs = Object.keys(stances.councillors);
  const issueRows = Object.entries(issues.issues)
    .sort((a, b) => b[1].dividedVoteCount - a[1].dividedVoteCount)
    .map(
      ([slug, entry]) =>
        `- [${entry.label}](/election/issues/${slug}) — ${entry.dividedVoteCount} divided votes since 2023, ${entry.directionBearingVoteCount} with a clear direction`,
    )
    .join("\n");

  const registry = loadRegistry();
  const councillorRows = councillorSlugs
    .map((slug) => stances.councillors[slug])
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map(
      (c) =>
        `- [${c.displayName}](/election/councillors/${slugFor(registry, c.displayName)}) — ${c.role}`,
    )
    .join("\n");

  return `---
title: "The Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker">Open Council · Election Lens · 2026</p>

London elects a new mayor and 14 ward councillors on **October 26, 2026**. This page is a lens laid over the real record on [Open Council](/) — every number and every link here comes from the same council-meeting data the rest of the site is built on. Nothing here is new information; it's the existing record of the **current council (2022–2026)**, organized around the questions an election raises.

Raw yea/nay votes don't tell you much on their own — a "yea" on a motion to increase permitted density and a "yea" on a motion to remove where townhouses are allowed point in opposite directions. Every position summarized here has been translated into **what the vote actually did**, with the underlying motion linked so you can check the translation yourself.

<div class="eh-callout">
This is a descriptive record of how the current council voted. It is not an endorsement of any candidate, and it does not tell you who to vote for.
</div>

## Find your ward

New ward boundaries take effect for this election. [Look up your current representative and what's on your Oct 26 ballot →](/election/wards)

## What council actually controls

Zoning and the budget, yes. Policing and healthcare, mostly not. [Read the plain-language breakdown, sourced line by line →](/election/what-council-controls)

## Divided votes by issue

These are the issues where council has actually split since 2023 — where a vote wasn't unanimous, and wasn't purely procedural. ${issues.unclassified.count.toLocaleString()} additional divided motions since 2023 didn't clearly match any of these issue clusters and aren't force-fit into one; they're listed on each issue's page and in the underlying data for transparency.

${issueRows}

## Councillor stance profiles

Full voting pattern per councillor per issue, current council (15 members: the Mayor plus 14 ward councillors). Every pattern sentence links to its evidence.

${councillorRows}

---

*Methodology: a "divided" vote is any non-unanimous, non-procedural council or committee motion since ${issues.cutoffDate}. Issue and direction ("what a yea did") are derived from each motion's own text using a fixed, deterministic set of rules, not assumed from topic and not a case-by-case judgment call — see the [issues page](/election/issues) for the exact counts and the unclassified/unclear disclosure.*
`;
}

// ---------------------------------------------------------------------------
// Councillor stance profile pages: /election/councillors/{slug}
// ---------------------------------------------------------------------------

function slugFor(
  registry: ReturnType<typeof loadRegistry>,
  displayName: string,
): string {
  for (const info of Object.values(registry)) {
    if (info.displayName === displayName) return info.slug;
  }
  return displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function renderAxisSection(axis: AxisStance): string {
  const evidenceRows = axis.evidence
    .map((ev) => {
      const itemLink = motionLink(
        ev.itemTitle || "(untitled item)",
        ev.anchor,
        ev.meetingSlug,
      );
      const theirVote = VOTE_LABEL[ev.theirVote] ?? ev.theirVote;
      return `| ${ev.date} | ${itemLink} | ${theirVote} | ${tcell(ev.result)} |`;
    })
    .join("\n");

  return `#### ${axis.axisLabels.expansive} vs. ${axis.axisLabels.restrictive}

${axis.pattern}

<details class="eh-evidence">
<summary>Show all ${axis.evidence.length} vote${axis.evidence.length === 1 ? "" : "s"} behind this pattern</summary>

| Date | Item | Their vote | Result |
|------|------|------------|--------|
${evidenceRows}

</details>
`;
}

function renderIssueSection(issueSlug: string, issue: IssueStance): string {
  const o = issue.overall;
  const axesMd = issue.axes.map(renderAxisSection).join("\n");

  return `### [${issue.issueLabel}](/election/issues/${issueSlug})

*${issue.divisionsInCorpus} divided votes on this issue since 2023. This councillor had a recorded position (yea or nay) on ${o.sampleSize} of the direction-bearing ones — ${o.recused} recused, ${o.absent} absent.*

${axesMd}`;
}

function generateCouncillorPage(
  slug: string,
  c: CouncillorStance,
  ward: WardEntry | undefined,
): string {
  const issueSlugs = Object.keys(c.issues).sort(
    (a, b) => c.issues[b].divisionsInCorpus - c.issues[a].divisionsInCorpus,
  );
  const sections = issueSlugs
    .map((issSlug) => renderIssueSection(issSlug, c.issues[issSlug]))
    .join("\n\n");

  const roleLine = ward
    ? `${c.role}, Ward ${ward.ward} (2022–2026 boundaries)`
    : c.role;

  const noPatternNote =
    issueSlugs.length === 0
      ? "\nNo issue reached the sample-size threshold for this councillor in the current data. This can happen for councillors who joined recently, or whose committee assignments didn't overlap with an issue's divided votes.\n"
      : "";

  return `---
title: "${c.displayName} — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Councillor Stance Profile</p>

# ${c.displayName}

${roleLine} · [Full voting record on Open Council →](/councillors/current/${slug})

${STANDING_DISCLAIMER}
${noPatternNote}
${sections}

---

*Sample sizes above count only votes where ${c.displayName} cast a yea or nay that the direction-rules pipeline could classify as "for" or "against" the issue's axis. Recusals (declared a pecuniary interest — an ethical/legal requirement, not a choice) and absences are shown separately in each issue's summary line and are never counted as a position.*
`;
}

// ---------------------------------------------------------------------------
// Issue pages: /election/issues/{slug}
// ---------------------------------------------------------------------------

function renderIssueVoteRow(v: IssueVote): string {
  const itemLink = motionLink(
    v.itemTitle || "(untitled item)",
    v.anchor,
    v.meetingSlug,
  );
  const whatAYeaDid = v.direction.axis
    ? v.direction.label
    : "Not classified — the direction wasn't clear from the motion text (listed for transparency)";
  const tallyStr = `${v.tally.yea}–${v.tally.nay}`;
  return `| ${v.date} | ${itemLink} | ${tcell(whatAYeaDid)} | ${tallyStr} | ${tcell(v.result)} |`;
}

function generateIssuePage(
  issue: IssueEntry,
  methodology: string,
  cutoffDate: string,
): string {
  const sorted = [...issue.votes].sort((a, b) => b.date.localeCompare(a.date));
  const rows = sorted.map(renderIssueVoteRow).join("\n");
  const clearCount = issue.directionBearingVoteCount;
  const unclearCount = issue.dividedVoteCount - clearCount;

  return `---
title: "${issue.label} — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Issue</p>

# ${issue.label}

${issue.dividedVoteCount} divided (non-unanimous, non-procedural) council or committee votes on this issue since ${cutoffDate}. ${clearCount} of those had a clear "what a yea did" direction; ${unclearCount} did not and are marked below rather than guessed at.

For how each current councillor voted on these, see their [stance profile](/election#councillor-stance-profiles).

| Date | Item | What a yea did | Tally (Y–N) | Result |
|------|------|-----------------|:-----------:|--------|
${rows}

---

*Methodology: ${tcell(methodology)}*
`;
}

function generateIssuesIndexPage(issues: IssuesFile): string {
  const rows = Object.entries(issues.issues)
    .sort((a, b) => b[1].dividedVoteCount - a[1].dividedVoteCount)
    .map(
      ([slug, entry]) =>
        `| [${entry.label}](/election/issues/${slug}) | ${entry.dividedVoteCount} | ${entry.directionBearingVoteCount} |`,
    )
    .join("\n");

  const sampleRows = issues.unclassified.sample
    .slice(0, 40)
    .map((s) => `- ${s.date} — ${tcell(s.itemTitle)} (item ${s.itemNumber})`)
    .join("\n");

  return `---
title: "Divided Votes by Issue — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Issues</p>

# Divided votes by issue

Council doesn't split on most of what it votes on — most motions pass unanimously. These are the issues where it has actually divided since ${issues.cutoffDate}.

| Issue | Divided votes | With a clear direction |
|-------|:---:|:---:|
${rows}

## Unclassified divided votes

${issues.unclassified.count.toLocaleString()} additional divided motions since ${issues.cutoffDate} matched none of the issue clusters above (or matched an explicit governance/procedure exclusion) and are not force-fit into one. A sample of ${Math.min(40, issues.unclassified.sample.length)}:

${sampleRows}

*${tcell(issues.unclassified.note)}*
`;
}

// ---------------------------------------------------------------------------
// What Council Actually Controls: /election/what-council-controls
// (content supplied verbatim by the civics-content research pass)
// ---------------------------------------------------------------------------

function generateControlsPage(): string {
  return `---
title: "What Council Actually Controls — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Explainer</p>

# What council actually controls

London's mayor and 14 ward councillors have real, direct authority over some of what shapes daily life in the city, and only indirect influence, or none at all, over the rest. Knowing which is which matters when weighing a candidate's record. Below is a plain-language map of where City of London Council's authority actually starts and stops, with the governing law or city page linked for every claim.

## Council controls directly

**Zoning and land use planning.** Under the Planning Act and the Municipal Act, 2001, council is the only body that can pass or amend a zoning by-law or adopt or amend London's official plan (the London Plan). Provincial guidance for municipal councillors is explicit that these two powers cannot be delegated away from council. Every rezoning, height limit and permitted-use decision in the city starts as a council vote.

Sources: [Ontario, Municipal Councillors' Guide, "Exercising municipal powers"](https://www.ontario.ca/document/ontario-municipal-councillors-guide/8-exercising-municipal-powers) · [City of London, Zoning](https://london.ca/business-development/zoning) · [City of London, The London Plan (Official Plan)](https://london.ca/business-development/official-plan)

**Property tax and the budget.** Council sets London's property tax rates each year, approved each April, and has moved to approving a multi-year budget under authority the Municipal Act, 2001 gives municipalities to budget for periods of two to five years. This is the single largest lever council holds: it decides how much is raised and where it goes.

Sources: [City of London, Property Taxes](https://london.ca/government/property-taxes-finance/property-taxes) · [City of London, Multi-Year Budget](https://london.ca/government/property-taxes-finance/municipal-budget/multi-year-budget)

**Local by-laws.** Council passes the by-laws that govern property standards, noise, parking, animal control and business licensing, using authority granted by the Municipal Act, 2001, the Building Code Act and the Planning Act.

Source: [City of London, By-Laws](https://london.ca/by-laws)

**Transit.** London's bus system is operated by the London Transit Commission, a seven-member body appointed by council (including sitting councillors) under a by-law made under the City of London Act. Council does not make day-to-day transit decisions, but it appoints the Commission, approves its budget and sets the broader policy direction the LTC works within.

Source: [London Transit Commission, Commission Information](https://www.londontransit.ca/commission-information/)

**Parks, recreation and municipal services.** The Municipal Act, 2001 gives municipalities broad jurisdiction over parks, recreation, culture, local roads, waste collection and similar services, exercised through council by-laws and the budget.

Source: [Municipal Act, 2001, S.O. 2001, c. 25 (CanLII)](https://www.canlii.org/en/on/laws/stat/so-2001-c-25/latest/so-2001-c-25.html)

**Housing tools.** Council controls the municipal levers available for housing supply: rezoning for higher density, community improvement plans that incentivize affordable units, and, within limits set by the province, inclusionary zoning near major transit stations. It does not control interest rates, national housing supply programs, or provincial rent rules.

Source: [City of London, More Homes](https://london.ca/business-development/more-homes)

## Council only influences

**Policing.** The London Police Service is overseen by the London Police Service Board, a separate body, not council, under the Community Safety and Policing Act, 2019. The board sets policy, priorities and the line-item budget; council's role is limited to approving or rejecting the board's total requested budget amount. Council cannot rewrite individual budget lines or direct police operations. If council and the board cannot agree on a total figure, the dispute goes to provincial conciliation or arbitration.

Sources: [Community Safety and Policing Act, 2019, S.O. 2019, c. 1, Sched. 1 (CanLII)](https://www.canlii.org/en/on/laws/stat/so-2019-c-1-sch-1/latest/so-2019-c-1-sch-1.html) · [London Police Service Board, Accountability and Reporting](https://londonpoliceserviceboard.com/accountability-and-reporting/)

**Encampments.** Council can pass by-laws restricting encampments in parks and public spaces, but that power sits inside a provincial legal framework that is actively shifting. Ontario's Bill 6, the Safer Municipalities Act, 2025, raised trespass penalties and created new public-substance-use offences, in force since June 2025. Separately, a May 2026 Ontario Superior Court decision on a Waterloo Region encampment found that clearing a site without adequate alternative shelter can violate Charter rights. Any London by-law in this area has to operate inside both.

Sources: [Legislative Assembly of Ontario, Bill 6, Safer Municipalities Act, 2025](https://www.ola.org/en/legislative-business/bills/parliament-44/session-1/bill-6) · [ablawg.ca, "Canada's Evolving Right to Shelter: Region of Waterloo v Named Respondents & Persons Unknown"](https://ablawg.ca/2026/07/10/canadas-evolving-right-to-shelter-region-of-waterloo-v-named-respondents-persons-unknown/)

## Provincial or federal, not council's call

**Healthcare.** Delivery and funding of hospital and physician services is a provincial responsibility, run day to day by Ontario's Ministry of Health, within conditions the federal Canada Health Act sets for funding. London council has no authority over hospital funding or care covered by a health card. Public health is a partial exception: the Middlesex-London Health Unit is jointly governed by provincial and municipal appointees and cost-shared between the province and the City.

Sources: [Government of Canada, Canada Health Act Annual Report](https://www.canada.ca/en/health-canada/services/publications/health-system-services/canada-health-act-annual-report-2023-2024.html) · [Middlesex-London Health Unit, Board of Health](https://www.healthunit.com/board-of-health)

**Education.** School boards, not council, run London's public and Catholic schools, under the Education Act, which is provincial legislation.

Source: [Ontario, Responsibility for Publicly Funded Elementary and Secondary Education](https://www.ontario.ca/page/responsibility-publicly-funded-elementary-and-secondary-education)

**Planning appeals.** Even a council zoning decision is not necessarily final. The Ontario Land Tribunal, a provincial adjudicative body, hears appeals from applicants or members of the public and has the power to overturn or amend a zoning by-law or official plan amendment that council has already passed.

Sources: [Ontario, Citizen's Guide to Land Use Planning: The Ontario Land Tribunal](https://www.ontario.ca/document/citizens-guide-land-use-planning/ontario-land-tribunal) · [Ontario Land Tribunal, Appeal Guide 2023](https://olt.gov.on.ca/wp-content/uploads/2023/02/Appeal_Guide_2023.pdf)

---

*This page explains legal authority in plain language; it is not legal advice. Every claim above links to a primary government or legal source — follow the links to read them yourself.*
`;
}

// ---------------------------------------------------------------------------
// Ward finder: /election/wards
// ---------------------------------------------------------------------------

function generateWardsPage(
  wardsData: WardsFile,
  registry: ReturnType<typeof loadRegistry>,
): string {
  const bySlug = new Map<string, { displayName: string }>();
  for (const info of Object.values(registry))
    bySlug.set(info.slug, { displayName: info.displayName });

  const rows = wardsData.wards
    .map((w) => {
      const rep = bySlug.get(w.currentRepSlug);
      const repLink = rep
        ? `[${rep.displayName}](/election/councillors/${w.currentRepSlug})`
        : "—";
      const changed = w.boundaryChanged2026 ? "Changed" : "Same shape";
      const note = w.incumbent2026Note ? w.incumbent2026Note : "—";
      return `| ${w.ward} | ${repLink} | ${changed} | ${note} |`;
    })
    .join("\n");

  return `---
title: "Find Your Ward — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Find Your Ward</p>

# Find your ward

${wardsData.currentTermEndsNote}

<div class="eh-ward-finder" data-eh-ward-finder>
  <label for="eh-address-input" class="eh-ward-finder-label">Look up an address (London, ON)</label>
  <div class="eh-ward-finder-row">
    <input id="eh-address-input" class="eh-ward-finder-input" type="text" placeholder="e.g. 300 Dufferin Ave" autocomplete="off" />
    <button id="eh-address-submit" class="eh-ward-finder-button" type="button">Find my ward</button>
  </div>
  <p id="eh-ward-finder-status" class="eh-ward-finder-status" role="status" aria-live="polite"></p>
  <div id="eh-ward-finder-result" class="eh-ward-finder-result" hidden></div>
  <p class="eh-ward-finder-fallback">This looks up your address against the City of London's live ward map. If it doesn't respond, use the ward table below, or the City's own <a href="${wardsData.cityWardMapTool}">ward map tool</a>.</p>
</div>

## All 14 wards

| Ward | Current representative (2022–2026) | 2026 boundary | 2026 ballot note |
|:---:|---|:---:|---|
${rows}

${wardsData.unresolvedNote}

For the authoritative, official candidate list for every ward, see the City Clerk's [certified list of candidates](${wardsData.candidateListSource}) (checked ${wardsData.candidateListLastChecked}). Per this hub's scope, only current councillors get a stance profile here — challengers don't have a council voting record to summarize.

<script>
(function () {
  "use strict";
  var WARDS_2022 = 8; // MapServer layer id, "Election 2022 Wards" — currently in effect until Nov 15, 2026
  var WARDS_2026 = 9; // MapServer layer id, "Election 2026 Wards" — the boundaries used for the Oct 26, 2026 ballot
  var BASE = "https://maps.london.ca/server/rest/services";
  var GEOCODE_URL = BASE + "/Locators/SearchKeyCompositeLocator/GeocodeServer/findAddressCandidates";
  var WARD_QUERY_URL = function (layer) { return BASE + "/OpenData/OpenData_Elections/MapServer/" + layer + "/query"; };
  var TIMEOUT_MS = 7000;
  var REPS = ${JSON.stringify(
    Object.fromEntries(
      wardsData.wards.map((w) => [
        String(w.ward),
        {
          slug: w.currentRepSlug,
          name: bySlug.get(w.currentRepSlug)?.displayName ?? w.currentRepSlug,
          note2026: w.incumbent2026Note,
        },
      ]),
    ),
  )};

  function jsonp(url, params, onSuccess, onError) {
    var cbName = "eh_cb_" + Math.random().toString(36).slice(2);
    var script = document.createElement("script");
    var timer = setTimeout(function () {
      cleanup();
      onError(new Error("timed out"));
    }, TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) {
      cleanup();
      onSuccess(data);
    };

    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    script.src = url + "?" + qs + "&callback=" + cbName;
    script.onerror = function () {
      cleanup();
      onError(new Error("script load failed"));
    };
    document.head.appendChild(script);
  }

  function findWard(lon, lat, layer, cb) {
    jsonp(WARD_QUERY_URL(layer), {
      f: "json",
      geometry: lon + "," + lat,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "Ward"
    }, function (data) {
      var feature = data && data.features && data.features[0];
      cb(feature ? feature.attributes.Ward : null);
    }, function (err) { cb(null, err); });
  }

  // Ward numbers come back from a third-party (City of London) server via
  // JSONP. Validate the shape before using them at all, and build the
  // result with DOM APIs (textContent / element properties) rather than
  // innerHTML, so nothing from that response is ever parsed as markup.
  var WARD_RE = /^([1-9]|1[0-4])$/;
  function safeWard(w) {
    return typeof w === "string" && WARD_RE.test(w) ? w : null;
  }

  function el(tag, opts) {
    var node = document.createElement(tag);
    if (opts) {
      if (opts.text !== undefined) node.textContent = opts.text;
      if (opts.className) node.className = opts.className;
      if (opts.href) { node.href = opts.href; }
    }
    return node;
  }

  function renderResult(container, ward2022Raw, ward2026Raw) {
    var ward2022 = safeWard(ward2022Raw);
    var ward2026 = safeWard(ward2026Raw);
    var rep2022 = ward2022 ? REPS[ward2022] : null;
    var rep2026Note = ward2026 && REPS[ward2026] ? REPS[ward2026].note2026 : null;

    while (container.firstChild) container.removeChild(container.firstChild);
    var any = false;

    if (ward2022) {
      any = true;
      var p1 = el("p");
      p1.appendChild(el("strong", { text: "Your current representative (Ward " + ward2022 + "):" }));
      if (rep2022) {
        p1.appendChild(document.createTextNode(" "));
        var a = el("a", { text: rep2022.name, href: "/election/councillors/" + rep2022.slug });
        p1.appendChild(a);
      }
      container.appendChild(p1);
    }

    if (ward2026) {
      any = true;
      var p2 = el("p");
      p2.appendChild(el("strong", { text: "Your Oct 26, 2026 ballot ward: " }));
      p2.appendChild(document.createTextNode("Ward " + ward2026));
      if (ward2022 && ward2022 !== ward2026) {
        p2.appendChild(document.createTextNode(" "));
        p2.appendChild(el("em", { text: "(different from your current ward — boundaries changed here)" }));
      }
      container.appendChild(p2);
      if (rep2026Note) {
        container.appendChild(el("p", { className: "eh-ward-finder-note", text: rep2026Note }));
      }
    }

    if (!any) {
      container.appendChild(el("p", { text: "Couldn't match that address to a ward. Try a more specific address, or use the table below." }));
    }
    container.hidden = false;
  }

  function run() {
    var input = document.getElementById("eh-address-input");
    var button = document.getElementById("eh-address-submit");
    var status = document.getElementById("eh-ward-finder-status");
    var result = document.getElementById("eh-ward-finder-result");
    if (!input || !button || !status || !result) return;

    function submit() {
      var address = input.value.trim();
      if (!address) return;
      status.textContent = "Looking up \\"" + address + "\\"…";
      result.hidden = true;

      jsonp(GEOCODE_URL, { SingleLine: address + ", London, ON", f: "json", outSR: 4326 }, function (data) {
        var candidate = data && data.candidates && data.candidates[0];
        if (!candidate || candidate.score < 70) {
          status.textContent = "Couldn't find that address. Try including a street number and name.";
          return;
        }
        var lon = candidate.location.x;
        var lat = candidate.location.y;
        var done = 0, ward2022 = null, ward2026 = null;
        function maybeFinish() {
          done++;
          if (done === 2) {
            status.textContent = "";
            renderResult(result, ward2022, ward2026);
          }
        }
        findWard(lon, lat, WARDS_2022, function (w) { ward2022 = w; maybeFinish(); });
        findWard(lon, lat, WARDS_2026, function (w) { ward2026 = w; maybeFinish(); });
      }, function () {
        status.textContent = "The City's address lookup didn't respond. Use the ward table below instead.";
      });
    }

    button.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
</script>
`;
}

// ---------------------------------------------------------------------------
// Councillors index: /election/councillors
// ---------------------------------------------------------------------------

function generateCouncillorsIndexPage(stances: StancesFile): string {
  const rows = Object.entries(stances.councillors)
    .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName))
    .map(
      ([slug, c]) =>
        `- [${c.displayName}](/election/councillors/${slug}) — ${c.role}`,
    )
    .join("\n");

  return `---
title: "Councillor Stance Profiles — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Councillors</p>

# Councillor stance profiles

The Mayor and all 14 current ward councillors, with their voting pattern on each divided issue since 2023. Descriptive record, not an endorsement — see each profile for the full disclaimer.

${rows}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function main() {
  console.log("Election Hub page generator\n");

  const issues = await loadJson<IssuesFile>(path.join(DATA_DIR, "issues.json"));
  const stances = await loadJson<StancesFile>(
    path.join(DATA_DIR, "stances.json"),
  );
  const wardsData = await loadJson<WardsFile>(
    path.join(DATA_DIR, "wards.json"),
  );
  const registry = loadRegistry();

  const wardBySlug = new Map<string, WardEntry>();
  for (const w of wardsData.wards) wardBySlug.set(w.currentRepSlug, w);

  // Landing page
  await writeFile(
    path.join(CONTENT_DIR, "index.md"),
    generateIndexPage(issues, stances),
  );
  console.log("  Wrote election/index.md");

  // What council controls
  await writeFile(
    path.join(CONTENT_DIR, "what-council-controls.md"),
    generateControlsPage(),
  );
  console.log("  Wrote election/what-council-controls.md");

  // Ward finder
  await writeFile(
    path.join(CONTENT_DIR, "wards.md"),
    generateWardsPage(wardsData, registry),
  );
  console.log("  Wrote election/wards.md");

  // Issues
  await writeFile(
    path.join(CONTENT_DIR, "issues", "index.md"),
    generateIssuesIndexPage(issues),
  );
  for (const [slug, issue] of Object.entries(issues.issues)) {
    await writeFile(
      path.join(CONTENT_DIR, "issues", `${slug}.md`),
      generateIssuePage(issue, issues.methodology, issues.cutoffDate),
    );
  }
  console.log(
    `  Wrote election/issues/ (${Object.keys(issues.issues).length} issues + index)`,
  );

  // Councillors
  await writeFile(
    path.join(CONTENT_DIR, "councillors", "index.md"),
    generateCouncillorsIndexPage(stances),
  );
  for (const [slug, c] of Object.entries(stances.councillors)) {
    await writeFile(
      path.join(CONTENT_DIR, "councillors", `${slug}.md`),
      generateCouncillorPage(slug, c, wardBySlug.get(slug)),
    );
  }
  console.log(
    `  Wrote election/councillors/ (${Object.keys(stances.councillors).length} councillors + index)`,
  );

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
