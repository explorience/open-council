import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/alertsFeed.scss"
// @ts-ignore
import script from "./scripts/alertsFeed.inline"

const AlertsFeed: QuartzComponent = (_props: QuartzComponentProps) => {
  return (
    <div class="alerts-feed">
      <div class="alerts-header">
        <h1>Alerts</h1>
        <p class="alerts-subtitle">Recent activity on issues you're watching.</p>
      </div>

      <div class="alerts-filters" id="alerts-filters">
        <button class="filter-btn active" data-filter="all">All</button>
      </div>

      <div class="alerts-list" id="alerts-list">
        {/* Populated by inline script */}
      </div>

      <div class="alerts-empty" id="alerts-empty" style="display: none">
        <div class="empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </div>
        <h3>No alerts yet</h3>
        <p><a href="/watchlist">Watch some topics</a> to start receiving alerts about council activity that matters to you.</p>
      </div>
    </div>
  )
}

AlertsFeed.css = style
AlertsFeed.afterDOMLoaded = script
AlertsFeed.displayName = "AlertsFeed"

export default (() => AlertsFeed) satisfies QuartzComponentConstructor
