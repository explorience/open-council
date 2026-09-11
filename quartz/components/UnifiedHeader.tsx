import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/unifiedHeader.scss"
// @ts-ignore
import script from "./scripts/unifiedHeader.inline"

const UnifiedHeader: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  const isHomepage = fileData.slug === "index"
  return (
    <>
      {/* Skip links for keyboard navigation */}
      <div class="skip-links" role="navigation" aria-label="Skip links">
        <a href="#main-content">Skip to main content</a>
        {/* Verified design-gate finding: on the homepage, HomepageHero's
            real #hero-chat-input stays display:none until chat mode is
            active (homepageHero.scss) - FrontpageWall's own
            #fp-assistant-input is the visible chat entry point there
            instead (it forwards into the real chat on submit; see
            frontpageWall.inline.ts's wireAssistant). A skip link to a
            hidden target focuses nothing. Elsewhere #hero-chat-input is
            the real, visible target and stays correct. */}
        <a href={isHomepage ? "#fp-assistant-input" : "#hero-chat-input"}>Skip to chat</a>
        {isHomepage && <a href="#fpWallEnd">Skip the division wall</a>}
      </div>
      <header class="unified-header">
      <div class="header-left">
        <a href="/" class="header-logo">
          {/* Design-gate finding, unaddressed across three rounds: the
              masthead was set type only (wordmark + BETA chip + oxblood
              rule), against the standing "generic = failure / drawn mark +
              signature device" rule — the division wall carried the whole
              brand alone. This mark echoes the wall's own signature device
              (a split yea/nay cell) rather than inventing an unrelated
              symbol: a hand-inked double-stroke ring (the sketchy wobble
              comes from two slightly offset circles, not a perfect one)
              split diagonally into a graphite half and an oxblood half,
              with a doubled hand-drawn dividing line — same visual grammar
              as `.wall .c`'s .y/.n split-fill, at masthead scale. */}
          <svg
            class="header-mark"
            width="22"
            height="22"
            viewBox="0 0 22 22"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <clipPath id="fpMarkClip">
                <circle cx="11" cy="11" r="8.6" />
              </clipPath>
            </defs>
            <g clip-path="url(#fpMarkClip)">
              <rect x="0" y="0" width="22" height="22" fill="var(--graphite-ink)" opacity="0.22" />
              <path d="M2 15 L18 4 L22 4 L22 22 L2 22 Z" fill="var(--accent-fill)" opacity="0.55" />
            </g>
            <circle cx="11" cy="11" r="8.6" fill="none" stroke="var(--graphite-ink)" stroke-width="1.4" />
            <circle
              cx="11.5"
              cy="10.6"
              r="8.1"
              fill="none"
              stroke="var(--graphite-ink)"
              stroke-width="1"
              opacity="0.55"
            />
            <path
              d="M3.2 14.8 C7 11 14 9.4 18.6 6.2"
              fill="none"
              stroke="var(--accent-fill)"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path
              d="M3.6 15.6 C7.4 11.6 14.3 9.9 19 6.8"
              fill="none"
              stroke="var(--accent-fill)"
              stroke-width="1"
              stroke-linecap="round"
              opacity="0.5"
            />
          </svg>
          Open Council <span class="beta-tag">BETA</span>
        </a>
      </div>

      <div class="header-right">
        {/* Search button - triggers existing search modal */}
        <button class="header-search-btn" aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        {/* Dark mode toggle - uses existing darkmode class for script compatibility */}
        <button class="header-darkmode-btn darkmode" aria-label="Toggle dark mode" title="Toggle theme">
          <svg
            class="sun-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
          <svg
            class="moon-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>

        {/* Hamburger menu - always visible */}
        <button class="header-hamburger" aria-label="Menu" aria-expanded="false">
          <span class="hamburger-line"></span>
          <span class="hamburger-line"></span>
          <span class="hamburger-line"></span>
        </button>
      </div>

      {/* Navigation menu dropdown */}
      <nav class="header-mobile-menu" aria-label="Site navigation">
        <a href="/councillors" class="mobile-menu-item">Councillors</a>
        <a href="/months" class="mobile-menu-item">Browse All Meetings</a>
        <a href="/votes" class="mobile-menu-item">Vote Explorer</a>
        <a href="/watchlist" class="mobile-menu-item">My Watchlist</a>
        <a href="/alerts" class="mobile-menu-item">Alerts</a>
        <a href="/election" class="mobile-menu-item">Election Hub</a>
        <a href="/about" class="mobile-menu-item">About</a>
        <div class="menu-divider"></div>
        <div class="menu-section">
          <span class="menu-section-title">Committees</span>
          <a href="/committees/planning-environment" class="mobile-menu-item">Planning & Environment</a>
          <a href="/committees/strategic-priorities" class="mobile-menu-item">Strategic Priorities</a>
          <a href="/committees/corporate-services" class="mobile-menu-item">Corporate Services</a>
          <a href="/committees/community-protective-services" class="mobile-menu-item">Community Services</a>
          <a href="/committees/civic-works" class="mobile-menu-item">Civic Works</a>
          <a href="/committees/city-council" class="mobile-menu-item">City Council</a>
          <a href="/committees/audit" class="mobile-menu-item">Audit Committee</a>
          {/* Only reachable from councillor pages before this fix - see the
              30 Aug 2026 audit's FOLLOW-UP finding. corporate-services was
              also missing above; both gaps predate this branch. */}
          <a href="/committees/infrastructure-corporate-services" class="mobile-menu-item">Infrastructure & Corporate Services</a>
          <a href="/committees/budget" class="mobile-menu-item">Budget Committee</a>
        </div>
      </nav>
    </header>
    </>
  )
}

UnifiedHeader.css = style
UnifiedHeader.afterDOMLoaded = script
UnifiedHeader.displayName = "UnifiedHeader"

export default (() => UnifiedHeader) satisfies QuartzComponentConstructor
