import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/watchlistPage.scss"
// @ts-ignore
import script from "./scripts/watchlistPage.inline"

const WatchlistPage: QuartzComponent = (_props: QuartzComponentProps) => {
  return (
    <div class="watchlist-page">
      <div class="watchlist-header">
        <h1>My Watchlist</h1>
        <p class="watchlist-subtitle">Issues, topics, and meetings you're tracking across London City Council.</p>
      </div>

      <div class="watchlist-tabs">
        <button class="watchlist-tab active" data-tab="watching">
          Watching <span class="tab-count">0</span>
        </button>
        <button class="watchlist-tab" data-tab="alerts">
          <a href="/alerts">Recent Alerts</a>
        </button>
      </div>

      <div class="watchlist-items" id="watchlist-items">
        {/* Populated by inline script */}
      </div>

      <div class="watchlist-empty" id="watchlist-empty" style="display: none">
        <div class="empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <h3>You're not watching anything yet</h3>
        <p>Browse <a href="/months">meetings</a>, <a href="/committees/city-council">committees</a>, or <a href="/councillors">councillors</a> and click <strong>Watch</strong> to start tracking topics that matter to you.</p>
      </div>
    </div>
  )
}

WatchlistPage.css = style
WatchlistPage.afterDOMLoaded = script
WatchlistPage.displayName = "WatchlistPage"

export default (() => WatchlistPage) satisfies QuartzComponentConstructor
