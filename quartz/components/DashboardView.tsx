import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { resolveRelative } from "../util/path"
import { byDateAndAlphabetical } from "./PageList"
import { Date, getDate } from "./Date"
import { filterRealMeetingFiles } from "../../lib/meetings/filter-real-meetings.js"
import { committees as defaultCommittees, councillors as defaultCouncillors, type Committee, type Councillor } from "./data/roster.js"
import style from "./styles/dashboardView.scss"
// @ts-ignore
import script from "./scripts/dashboardView.inline"

export type { Committee, Councillor }

export interface DashboardViewOptions {
  committees: Committee[]
  councillors: Councillor[]
  recentMeetingsLimit: number
}

// committees/councillors now live in ./data/roster.ts — shared with
// FrontpageWall.tsx's stats column so the two can't drift into two
// different counts for the same nine committees again.
const defaultOptions: DashboardViewOptions = {
  committees: defaultCommittees,
  councillors: defaultCouncillors,
  recentMeetingsLimit: 50,
}

export default ((userOpts?: Partial<DashboardViewOptions>) => {
  const DashboardView: QuartzComponent = ({
    allFiles,
    fileData,
    cfg,
  }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    // Real, deduped meeting pages only - shared with the "Recent Meetings"
    // rail in quartz.layout.ts so the two can't drift into different
    // exclusion lists again (see lib/meetings/filter-real-meetings.ts for
    // why this replaced a hand-maintained slug blocklist).
    const realMeetings = filterRealMeetingFiles(allFiles)

    // Get recent meetings
    const meetings = realMeetings
      .sort(byDateAndAlphabetical(cfg))
      .slice(0, opts.recentMeetingsLimit)

    const totalMeetings = realMeetings.length

    return (
      <div class="dashboard-view advanced-only">
        {/* Stats Row with Actions */}
        <div class="dashboard-stats">
          <a href="/months" class="action-btn browse-all-btn">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            Browse All
          </a>

          <div class="stats-group">
            <a href="/months" class="stat-card">
              <span class="stat-number">{totalMeetings.toLocaleString()}</span>
              <span class="stat-label">Meetings</span>
            </a>
            <a href="/committees" class="stat-card">
              <span class="stat-number">{opts.committees.length}</span>
              <span class="stat-label">Committees</span>
            </a>
            <a href="/councillors" class="stat-card">
              <span class="stat-number">{opts.councillors.length}</span>
              <span class="stat-label">Councillors</span>
            </a>
          </div>

          <button class="action-btn search-btn">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Search
          </button>
        </div>

        {/* Main Grid */}
        <div class="dashboard-grid">
          {/* Committees Panel */}
          <div class="dashboard-panel">
            <h3 class="panel-title">Committees</h3>
            <ul class="panel-list">
              {opts.committees.map((committee) => (
                <li>
                  <a href={`/committees/${committee.slug}`} class="panel-link">
                    <span class="link-name">{committee.name}</span>
                    {committee.count && <span class="link-count">{committee.count}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Recent Meetings Panel */}
          <div class="dashboard-panel">
            <h3 class="panel-title">Recent Meetings</h3>
            <ul class="panel-list meetings-list">
              {meetings.map((meeting) => {
                const title = meeting.frontmatter?.title ?? "Untitled"
                return (
                  <li>
                    <a href={resolveRelative(fileData.slug!, meeting.slug!)} class="panel-link meeting-link">
                      <span class="meeting-date">
                        {meeting.dates && <Date date={getDate(cfg, meeting)!} locale={cfg.locale} />}
                      </span>
                      <span class="meeting-title">{title}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
            <a href="/months" class="panel-more">View all meetings →</a>
          </div>

          {/* Councillors Panel */}
          <div class="dashboard-panel">
            <h3 class="panel-title">Councillors</h3>
            <ul class="panel-list councillors-list">
              {opts.councillors.map((councillor) => (
                <li>
                  <a href={`/councillors/current/${councillor.slug}`} class="panel-link">
                    <span class="link-name">{councillor.name}</span>
                    {councillor.role && <span class="councillor-role">{councillor.role}</span>}
                  </a>
                </li>
              ))}
            </ul>
            <a href="/councillors" class="panel-more">View all councillors →</a>
          </div>
        </div>

      </div>
    )
  }

  DashboardView.css = style
  DashboardView.afterDOMLoaded = script

  return DashboardView
}) satisfies QuartzComponentConstructor
