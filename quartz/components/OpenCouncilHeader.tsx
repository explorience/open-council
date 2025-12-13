import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/opencouncilheader.scss"
import script from "./scripts/opencouncilheader.inline"

const OpenCouncilHeader: QuartzComponent = () => {
  return (
    <div className="open-council-header">
      <div className="title-div">
        <h1><a href="/">Open Council</a></h1>
      </div>
      <button class="chat-trigger-btn" aria-label="Open chat assistant" title="Ask a question">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
    </div>
  )
}

OpenCouncilHeader.css = style
OpenCouncilHeader.beforeDOMLoaded = script

export default (() => OpenCouncilHeader) satisfies QuartzComponentConstructor
