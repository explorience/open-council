import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { resolveRelative } from "../util/path"
import { byDateAndAlphabetical } from "./PageList"
import { Date, getDate } from "./Date"
import style from "./styles/dashboardView.scss"

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
  years: number[]
  councillors: Councillor[]
  recentMeetingsLimit: number
}

const defaultOptions: DashboardViewOptions = {
  committees: [
    { name: "Planning and Environment", slug: "planning-environment", count: 230 },
    { name: "Corporate Services", slug: "corporate-services", count: 223 },
    { name: "Strategic Priorities and Policy", slug: "strategic-priorities", count: 211 },
    { name: "Civic Works", slug: "civic-works", count: 167 },
    { name: "Community and Protective Services", slug: "community-protective-services", count: 146 },
    { name: "Audit Committee", slug: "audit", count: 55 },
    { name: "Budget Committee", slug: "budget" },
    { name: "City Council", slug: "city-council", count: 107 },
  ],
  years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011],
  councillors: [
    { name: "J. Morgan", slug: "j-morgan", role: "Mayor" },
    { name: "P. Van Meerbergen", slug: "p-van-meerbergen" },
    { name: "S. Turner", slug: "s-turner" },
    { name: "S. Lewis", slug: "s-lewis" },
    { name: "J. Helmer", slug: "j-helmer" },
    { name: "A. Hopkins", slug: "a-hopkins" },
    { name: "P. Squire", slug: "p-squire" },
    { name: "S. Hillier", slug: "s-hillier" },
  ],
  recentMeetingsLimit: 8,
}

export default ((userOpts?: Partial<DashboardViewOptions>) => {
  const DashboardView: QuartzComponent = ({
    displayClass,
    allFiles,
    fileData,
    cfg,
  }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    // Get recent meetings
    const meetings = allFiles
      .filter((f) => f.slug !== "index" && !f.slug?.startsWith("committees/") && !f.slug?.startsWith("years/") && !f.slug?.startsWith("councillors/"))
      .sort(byDateAndAlphabetical(cfg))
      .slice(0, opts.recentMeetingsLimit)

    const totalMeetings = allFiles.filter(
      (f) => f.slug !== "index" && !f.slug?.startsWith("committees/") && !f.slug?.startsWith("years/") && !f.slug?.startsWith("councillors/")
    ).length

    return (
      <div class="dashboard-view advanced-only">
        {/* Stats Row */}
        <div class="dashboard-stats">
          <div class="stat-card">
            <span class="stat-number">{totalMeetings.toLocaleString()}</span>
            <span class="stat-label">Meetings</span>
          </div>
          <div class="stat-card">
            <span class="stat-number">14</span>
            <span class="stat-label">Years</span>
          </div>
          <div class="stat-card">
            <span class="stat-number">{opts.committees.length}</span>
            <span class="stat-label">Committees</span>
          </div>
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
            <a href="#" class="panel-more browse-all-link">View all meetings →</a>
          </div>

          {/* Years Panel */}
          <div class="dashboard-panel">
            <h3 class="panel-title">Browse by Year</h3>
            <div class="years-grid">
              {opts.years.map((year) => (
                <a href={`/years/${year}`} class="year-link">
                  {year}
                </a>
              ))}
            </div>
          </div>

          {/* Councillors Panel */}
          <div class="dashboard-panel">
            <h3 class="panel-title">Councillors</h3>
            <ul class="panel-list councillors-list">
              {opts.councillors.map((councillor) => (
                <li>
                  <a href={`/councillors/${councillor.slug}`} class="panel-link">
                    <span class="link-name">{councillor.name}</span>
                    {councillor.role && <span class="councillor-role">{councillor.role}</span>}
                  </a>
                </li>
              ))}
            </ul>
            <a href="/councillors" class="panel-more">View all councillors →</a>
          </div>
        </div>

        {/* Bottom Actions */}
        <div class="dashboard-actions">
          <button class="action-btn browse-all-btn">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            Browse All Files
          </button>
          <button class="action-btn search-btn">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Full Search
          </button>
        </div>
      </div>
    )
  }

  DashboardView.css = style

  return DashboardView
}) satisfies QuartzComponentConstructor
