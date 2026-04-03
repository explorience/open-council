import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/watchButton.scss"
// @ts-ignore
import script from "./scripts/watchButton.inline"

const WatchButton: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  const slug = fileData.slug ?? ""
  const title = fileData.frontmatter?.title ?? slug

  return (
    <div class="watch-button-container" data-slug={slug} data-title={title}>
      <button class="watch-btn" aria-label="Watch this page" aria-pressed="false">
        <svg class="watch-icon-off" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <svg class="watch-icon-on" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="display:none">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <span class="watch-label">Watch</span>
      </button>
    </div>
  )
}

WatchButton.css = style
WatchButton.afterDOMLoaded = script
WatchButton.displayName = "WatchButton"

export default (() => WatchButton) satisfies QuartzComponentConstructor
