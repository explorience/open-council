import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { resolveRelative } from "../util/path"
import { byDateAndAlphabetical } from "./PageList"
import { Date, getDate } from "./Date"
import { filterRealMeetingFiles } from "../../lib/meetings/filter-real-meetings.js"
import style from "./styles/dashboardView.scss"
// @ts-ignore
import script from "./scripts/dashboardView.inline"

export interface Committee {
  name: string
  slug: string
  count?: number
}

export interface Councillor {
  name: string
  slug: string
  role?: string
}

export interface DashboardViewOptions {
  committees: Committee[]
  councillors: Councillor[]
  recentMeetingsLimit: number
}

const defaultOptions: DashboardViewOptions = {
  // Counts snapshotted from content/committees/*.md's `meetingCount`
  // frontmatter after the committee-mapping fix + historical vote/data
  // repair (30 Aug 2026 audit) - they WILL drift again as new meetings are
  // scraped, same as before. infrastructure-corporate-services is new: the
  // committee-mapping fix (extractCommittee picking the longest matching
  // pattern) correctly split it out of corporate-services for the first
  // time; see lib/meetings/committee.ts.
  committees: [
    { name: "Planning and Environment", slug: "planning-environment", count: 298 },
    { name: "Strategic Priorities and Policy", slug: "strategic-priorities", count: 282 },
    { name: "Corporate Services", slug: "corporate-services", count: 263 },
    { name: "Community and Protective Services", slug: "community-protective-services", count: 208 },
    { name: "Civic Works", slug: "civic-works", count: 203 },
    { name: "City Council", slug: "city-council", count: 185 },
    { name: "Audit Committee", slug: "audit", count: 70 },
    { name: "Infrastructure and Corporate Services", slug: "infrastructure-corporate-services", count: 30 },
    { name: "Budget Committee", slug: "budget", count: 22 },
  ],
  councillors: [
    { name: "J. Morgan", slug: "j-morgan", role: "Mayor" },
    { name: "P. Cuddy", slug: "p-cuddy" },
    { name: "D. Ferreira", slug: "d-ferreira" },
    { name: "S. Franke", slug: "s-franke" },
    { name: "S. Hillier", slug: "s-hillier" },
    { name: "A. Hopkins", slug: "a-hopkins" },
    { name: "S. Lehman", slug: "s-lehman" },
    { name: "S. Lewis", slug: "s-lewis" },
    { name: "H. McAlister", slug: "h-mcalister" },
    { name: "E. Peloza", slug: "e-peloza" },
    { name: "J. Pribil", slug: "j-pribil" },
    { name: "C. Rahman", slug: "c-rahman" },
    { name: "S. Stevenson", slug: "s-stevenson" },
    { name: "S. Trosow", slug: "s-trosow" },
    { name: "P. Van Meerbergen", slug: "p-van-meerbergen" },
  ],
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
