import fs from "fs"
import path from "path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { filterRealMeetingFiles } from "../../lib/meetings/filter-real-meetings.js"
import { committees, councillors } from "./data/roster.js"
import {
  type DivisionWallFile,
  type DivisionWallRecord,
  decidedByTwoOrFewer,
  deriveClosest20,
  formatWallDate,
} from "./util/divisionWall.js"
import style from "./styles/frontpageWall.scss"
// @ts-ignore
import script from "./scripts/frontpageWall.inline"

export interface FrontpageWallOptions {
  assistantQuestions: string[]
}

const defaultOptions: FrontpageWallOptions = {
  assistantQuestions: [
    "What split council most this term?",
    "How did my councillor vote on housing?",
    "Show me the closest votes this year",
  ],
}

// Read once at module load (Quartz build runs this module exactly once
// per build, same lifetime as any other component's imports) rather than
// per-render — the data doesn't change mid-build. A missing/unreadable
// file degrades to an empty wall instead of failing the whole build: the
// rest of the homepage (chat, dashboard, explorer, nav) must still work
// even if `npm run generate:frontpage` hasn't been run yet.
function loadWallData(): DivisionWallFile {
  const dataPath = path.join(process.cwd(), "data", "frontpage", "division-wall.json")
  try {
    const raw = fs.readFileSync(dataPath, "utf-8")
    return JSON.parse(raw) as DivisionWallFile
  } catch (err) {
    console.warn(
      `[FrontpageWall] Could not read ${dataPath} (run "npm run generate:frontpage" first) - rendering an empty wall. ${err}`,
    )
    return { cutoffDate: "", recordCount: 0, records: [] }
  }
}

const wallFile = loadWallData()

// Escapes "<" so a title containing a literal "<" (or, in principle, a
// "</script>" sequence) can never be misread as markup — <
// round-trips through JSON.parse unchanged.
//
// Rendered via dangerouslySetInnerHTML, NOT as ordinary JSX child text:
// preact-render-to-string HTML-entity-escapes normal text children
// (", &, <, > -> &quot; &amp; &lt; &gt;) the same as it would inside a
// <p>, with no special case for <script>'s raw-text parsing model. A
// <script type="application/json"> is a raw-text element per the HTML
// spec — the browser never entity-decodes its content — so plain JSX
// children left every embedded quote as the literal four-character
// string "&quot;" in the parsed JSON, breaking JSON.parse outright (the
// wall silently rendered zero cells: buildWall()'s try/catch swallowed
// the parse error). dangerouslySetInnerHTML bypasses that escaping so
// the real JSON bytes reach the browser unchanged.
function safeJsonScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}

export default ((userOpts?: Partial<FrontpageWallOptions>) => {
  const FrontpageWall: QuartzComponent = ({ allFiles }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }
    const records: DivisionWallRecord[] = wallFile.records
    const wallCount = records.length
    const twoOrFewer = decidedByTwoOrFewer(records)
    const closest20 = deriveClosest20(records)
    const cutoffYear = wallFile.cutoffDate ? wallFile.cutoffDate.slice(0, 4) : "2023"

    // Ghost numeral = total REAL meetings on file, not the divided-vote
    // count — same pairing the approved prototype used, and the same
    // real derivation DashboardView's "Meetings" stat card uses (no
    // second count that can drift from it).
    const totalMeetings = filterRealMeetingFiles(allFiles).length

    return (
      <section class="fp-wall-section" aria-labelledby="fp-h1">
        <div class="fp-hero">
          <span
            class="fp-ghost fp-display"
            aria-hidden="true"
            data-target={totalMeetings}
          >
            {totalMeetings.toLocaleString("en-CA")}
          </span>
          {/* Verified design-gate finding: the ghost numeral is deliberately
              the ALL-TIME meetings total (see the totalMeetings comment
              above), not the wall's own divided-vote count shown further
              down - the spec calls this "the whole record" framing,
              distinct from the wall below it. But it's decorative/
              aria-hidden with no sighted-user label of its own, sitting
              right behind a headline about split votes, so a reader has
              no way to tell it's a different metric from the wall's
              "1,803 divided votes" a few rows down - two large, similar-
              looking numbers with no visible distinction reads as a data
              bug even when it isn't one. This caption is the only change;
              the numeral itself and its value are untouched. */}
          <span class="fp-ghost-label fp-mono" aria-hidden="true">
            meetings on file, all-time
          </span>
          <p class="fp-kicker fp-mono">London City Council, Division Record</p>
          <h1 id="fp-h1" class="fp-h1 fp-display">
            Every vote that <span class="fp-ox">split</span> council.
          </h1>
          <p class="fp-sub">
            Searchable minutes, motions and tallies since {cutoffYear}. The wall below is
            every divided vote, in order.
          </p>
        </div>

        <div class="fp-stats">
          <div class="fp-card fp-assistant">
            <p class="fp-assistant-lead">
              Ask the record anything: meetings, motions, votes, councillors.
            </p>
            <div class="fp-assistant-chips">
              {opts.assistantQuestions.map((q) => (
                <button type="button" class="fp-assistant-chip fp-mono" data-question={q}>
                  {q}
                </button>
              ))}
            </div>
            <div class="fp-assistant-rule" aria-hidden="true"></div>
            <div class="fp-assistant-inputrow">
              <label for="fp-assistant-input" class="sr-only">
                Ask the record
              </label>
              <input
                id="fp-assistant-input"
                class="fp-assistant-input fp-mono"
                type="text"
                placeholder="Ask a question..."
              />
              <button type="button" class="fp-assistant-send fp-mono">
                Ask
              </button>
            </div>
            <p class="fp-assistant-disclaimer fp-mono">AI-generated · may be inaccurate</p>
          </div>

          <div class="fp-numcol fp-mono">
            <div class="fp-stat-row fp-stat-row--big fp-stat-row--first">
              <a href="/months" class="fp-stat-label">
                Meetings
              </a>
              <span class="fp-stat-value">{totalMeetings.toLocaleString("en-CA")}</span>
            </div>
            <div class="fp-stat-row fp-stat-row--big">
              <a href="/committees" class="fp-stat-label">
                Committees
              </a>
              <span class="fp-stat-value">{committees.length}</span>
            </div>
            <div class="fp-stat-row fp-stat-row--big">
              <a href="/councillors" class="fp-stat-label">
                Councillors
              </a>
              <span class="fp-stat-value">{councillors.length}</span>
            </div>
            {committees.map((c) => (
              <div class="fp-stat-row fp-stat-row--n">
                <a href={`/committees/${c.slug}`} class="fp-stat-label">
                  {c.name}
                </a>
                <span class="fp-stat-value">{c.count ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        <div class="wall-head">
          <h2 class="fp-display">The Division Wall</h2>
          <span class="count fp-mono">{wallCount.toLocaleString("en-CA")}</span>
        </div>
        <p class="wall-sub fp-mono">
          {wallCount.toLocaleString("en-CA")} divided votes since {cutoffYear}, oldest to
          newest. Each cell is one vote; the split shows yeas against nays. Tap any vote to see
          what it was.
        </p>
        {/* Design-gate BLOCKER (repeat, r2+r3): the prototype ships a
            .wall-legend (reskin-A2-frontpage-v3.html:230) explaining the
            yea/nay swatches and the two-or-fewer count - 1,803 colour-coded
            cells with no key and no stated tap affordance. Ported verbatim,
            same class names/structure so frontpageWall.scss's existing
            prototype-derived rules apply unchanged. */}
        <div class="wall-legend fp-mono" aria-hidden="false">
          <span>
            <span class="sw sw-yea" aria-hidden="true"></span>Yea share
          </span>
          <span>
            <span class="sw sw-nay" aria-hidden="true"></span>Nay share
          </span>
          <span>{twoOrFewer.toLocaleString("en-CA")} decided by two votes or fewer</span>
        </div>

        <div
          id="fpWall"
          class="wall"
          role="list"
          aria-label={`Every divided council vote since ${cutoffYear}, in chronological order`}
        ></div>

        {/* Skip target for UnifiedHeader's "Skip the division wall" link
            (verified a11y-gate finding: 1,800+ individually focusable
            cells with no way to tab past them in one step). */}
        <span id="fpWallEnd" tabindex={-1}></span>

        {/* Compact tuple payload, sorted chronologically ascending — the
            client script (frontpageWall.inline.ts) builds the wall cells
            and year chapter breaks from this in one pass. See
            scripts/generate-frontpage-data.ts's module doc for the shape. */}
        <script
          type="application/json"
          id="wallData"
          dangerouslySetInnerHTML={{ __html: safeJsonScript(records) }}
        ></script>

        <div id="wallTip" class="wall-tip fp-mono" role="status" aria-live="polite" hidden></div>

        {wallCount > 0 && (
          <details class="closest">
            <summary>The twenty closest votes, as a table</summary>
            <div class="closest-table-wrap">
              <table class="closest-table fp-mono">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Item</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {closest20.map((r) => {
                    const [date, yea, nay, passed, title, , url] = r
                    return (
                      <tr>
                        <td>
                          <a href={url}>{formatWallDate(date)}</a>
                        </td>
                        <td>{title}</td>
                        <td>
                          {passed ? "Passed" : "Failed"} {yea}-{nay}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>
    )
  }

  FrontpageWall.css = style
  FrontpageWall.afterDOMLoaded = script

  return FrontpageWall
}) satisfies QuartzComponentConstructor
