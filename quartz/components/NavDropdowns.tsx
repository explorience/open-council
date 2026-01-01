import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/navDropdowns.scss"
// @ts-ignore
import script from "./scripts/navDropdowns.inline"

export interface Committee {
  name: string
  slug: string
  count?: number
}

export interface Topic {
  name: string
  slug: string
}

export interface NavDropdownsOptions {
  committees: Committee[]
  years: number[]
  topics: Topic[]
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
  years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011],
  topics: [
    { name: "Transportation", slug: "transportation" },
    { name: "Housing", slug: "housing" },
    { name: "Public Safety", slug: "public-safety" },
    { name: "Climate & Environment", slug: "climate-environment" },
    { name: "Planning & Development", slug: "planning-development" },
    { name: "Budget & Taxes", slug: "budget-taxes" },
    { name: "Infrastructure", slug: "infrastructure" },
    { name: "Parks & Recreation", slug: "parks-recreation" },
    { name: "Social Services", slug: "social-services" },
    { name: "Economic Development", slug: "economic-development" },
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

          <div class="nav-dropdown">
            <button class="nav-dropdown-trigger" aria-expanded="false" aria-haspopup="true">
              <span>By Year</span>
              <svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div class="nav-dropdown-menu" role="menu">
              {opts.years.map((year) => (
                <a href={`/years/${year}`} class="nav-dropdown-item" role="menuitem">
                  <span class="item-name">{year}</span>
                </a>
              ))}
            </div>
          </div>

          <div class="nav-dropdown">
            <button class="nav-dropdown-trigger" aria-expanded="false" aria-haspopup="true">
              <span>By Topic</span>
              <svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div class="nav-dropdown-menu" role="menu">
              {opts.topics.map((topic) => (
                <a href={`/topics/${topic.slug}`} class="nav-dropdown-item" role="menuitem">
                  <span class="item-name">{topic.name}</span>
                </a>
              ))}
              <a href="/topics" class="nav-dropdown-item nav-dropdown-all" role="menuitem">
                <span class="item-name">View All Topics</span>
              </a>
            </div>
          </div>

          <a href="/councillors" class="nav-link">
            Councillors
          </a>

          <button class="nav-link nav-recent-meetings" aria-label="Show recent meetings" aria-expanded="false">
            Recent Meetings
          </button>

          <button class="nav-link nav-suggested-questions" aria-label="Show suggested questions" aria-expanded="false">
            Suggested Questions
          </button>

          <a href="/about" class="nav-link">
            About
          </a>
        </div>
      </nav>
    )
  }

  NavDropdowns.css = style
  NavDropdowns.afterDOMLoaded = script

  return NavDropdowns
}) satisfies QuartzComponentConstructor
