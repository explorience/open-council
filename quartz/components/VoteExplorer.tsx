import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/voteExplorer.inline"
import style from "./styles/voteExplorer.scss"

const VoteExplorer: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  if (fileData.frontmatter?.type !== "vote-explorer") {
    return null
  }

  return (
    <div class="vote-explorer">
      <div class="ve-header">
        <h1>Vote Explorer</h1>
        <p class="ve-subtitle">
          Every substantive vote by London City Council since 2011. Procedural motions excluded.
        </p>
        <div class="ve-freshness-notice" id="ve-freshness">
          <strong>Note:</strong> Vote data depends on the City of London publishing official meeting minutes.
          There is often a delay of several weeks between a meeting and the minutes being posted.
          <span id="ve-latest-date"></span>
        </div>
      </div>

      <div class="ve-controls">
        <div class="ve-search">
          <input
            type="text"
            id="ve-search"
            placeholder="Search motions, topics, or councillors..."
            autocomplete="off"
          />
        </div>

        <div class="ve-filters">
          <select id="ve-year">
            <option value="current">Current Term (2022-2026)</option>
            <option value="all">All Years (2011-2026)</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
            <option value="2022">2022</option>
            <option value="2021">2021</option>
            <option value="2020">2020</option>
            <option value="2019">2019</option>
            <option value="2018">2018</option>
            <option value="2017">2017</option>
            <option value="2016">2016</option>
            <option value="2015">2015</option>
            <option value="2014">2014</option>
            <option value="2013">2013</option>
            <option value="2012">2012</option>
            <option value="2011">2011</option>
          </select>

          <select id="ve-type">
            <option value="all">All Meeting Types</option>
            <option value="Council">Council</option>
            <option value="Strategic Priorities and Policy Committee">Strategic Priorities</option>
            <option value="Community and Protective Services Committee">Community & Protective</option>
            <option value="Planning and Environment Committee">Planning & Environment</option>
            <option value="Civic Works Committee">Civic Works</option>
            <option value="Corporate Services Committee">Corporate Services</option>
            <option value="Budget Committee">Budget Committee</option>
          </select>

          <select id="ve-result">
            <option value="all">All Results</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>

          <select id="ve-split">
            <option value="contested">Contested Only</option>
            <option value="all">All Votes</option>
            <option value="close">Close Votes (≤3 margin)</option>
          </select>
        </div>

        <div class="ve-stats" id="ve-stats">
          Loading...
        </div>
      </div>

      <div class="ve-results" id="ve-results">
        <div class="ve-loading" id="ve-loading">Loading vote data...</div>
      </div>

      <div class="ve-sentinel" id="ve-sentinel" style="height: 1px;"></div>
    </div>
  )
}

VoteExplorer.css = style
VoteExplorer.afterDOMLoaded = script
VoteExplorer.displayName = "VoteExplorer"

export default (() => VoteExplorer) satisfies QuartzComponentConstructor
