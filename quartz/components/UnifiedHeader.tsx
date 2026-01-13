import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/unifiedHeader.scss"
// @ts-ignore
import script from "./scripts/unifiedHeader.inline"

const UnifiedHeader: QuartzComponent = (_props: QuartzComponentProps) => {
  return (
    <header class="unified-header">
      <div class="header-left">
        <a href="/" class="header-logo">
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

        {/* About link - desktop only */}
        <a href="/about" class="header-about-link">
          About
        </a>

        {/* Hamburger menu - mobile only */}
        <button class="header-hamburger" aria-label="Menu" aria-expanded="false">
          <span class="hamburger-line"></span>
          <span class="hamburger-line"></span>
          <span class="hamburger-line"></span>
        </button>
      </div>

      {/* Mobile menu dropdown */}
      <nav class="header-mobile-menu" aria-label="Mobile navigation">
        <a href="/councillors" class="mobile-menu-item">Councillors</a>
        <a href="/committees/city-council" class="mobile-menu-item">City Council</a>
        <a href="/committees/planning-environment" class="mobile-menu-item">Planning Committee</a>
        <button class="mobile-menu-item browse-trigger-mobile">Browse All Meetings</button>
        <button class="mobile-menu-item chat-trigger-mobile">Chat with AI</button>
        <a href="/about" class="mobile-menu-item">About</a>
      </nav>
    </header>
  )
}

UnifiedHeader.css = style
UnifiedHeader.afterDOMLoaded = script
UnifiedHeader.displayName = "UnifiedHeader"

export default (() => UnifiedHeader) satisfies QuartzComponentConstructor
