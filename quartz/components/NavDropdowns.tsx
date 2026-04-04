import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/navDropdowns.scss"
// @ts-ignore
import script from "./scripts/navDropdowns.inline"

export interface Committee {
  name: string
  slug: string
  count?: number
}

export interface NavDropdownsOptions {
  committees: Committee[]
}

const defaultOptions: NavDropdownsOptions = {
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
}

export default ((userOpts?: Partial<NavDropdownsOptions>) => {
  const NavDropdowns: QuartzComponent = (_props: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    return (
      <nav class="nav-dropdowns">
        {/* Mobile hamburger toggle */}
        <button class="nav-hamburger" aria-label="Toggle navigation menu" aria-expanded="false">
          <span class="hamburger-line"></span>
          <span class="hamburger-line"></span>
          <span class="hamburger-line"></span>
        </button>

        {/* Nav items container - collapsible on mobile */}
        <div class="nav-items">
          <div class="nav-dropdown">
            <button class="nav-dropdown-trigger" aria-expanded="false" aria-haspopup="true">
              <span>By Committee</span>
              <svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div class="nav-dropdown-menu" role="menu">
              {opts.committees.map((committee) => (
                <a href={`/committees/${committee.slug}`} class="nav-dropdown-item" role="menuitem">
                  <span class="item-name">{committee.name}</span>
                  {committee.count && <span class="item-count">{committee.count}</span>}
                </a>
              ))}
            </div>
          </div>

          <a href="/councillors" class="nav-link">
            Councillors
          </a>

          <a href="/votes" class="nav-link">
            Votes
          </a>

          <button class="nav-link nav-recent-meetings" aria-label="Show recent meetings" aria-expanded="false">
            Recent Meetings
          </button>

          <a href="/guide" class="nav-link">
            Guide
          </a>

          <a href="/feedback" class="nav-link">
            Feedback
          </a>

          <a href="/watchlist" class="nav-link nav-login-link">
            Login
          </a>
        </div>
      </nav>
    )
  }

  NavDropdowns.css = style
  NavDropdowns.afterDOMLoaded = script

  return NavDropdowns
}) satisfies QuartzComponentConstructor
