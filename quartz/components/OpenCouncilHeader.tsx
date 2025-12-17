import { QuartzComponent, QuartzComponentConstructor } from "./types"
import style from "./styles/opencouncilheader.scss"
// @ts-ignore
import script from "./scripts/opencouncilheader.inline"

const OpenCouncilHeader: QuartzComponent = () => {
  return (
    <div className="open-council-header">
      <div className="header-left">
        <a href="/about" className="about-link">About</a>
        <button class="chat-trigger-btn" aria-label="Open chat assistant">Chat</button>
      </div>
      <div className="title-div">
        <h1><a href="/">Open Council</a> <span className="beta-tag">BETA</span></h1>
      </div>
      <div className="header-right">
        {/* Placeholder for symmetry - Search/Darkmode added by sticky header */}
      </div>
    </div>
  )
}

OpenCouncilHeader.css = style
OpenCouncilHeader.beforeDOMLoaded = script
OpenCouncilHeader.displayName = "OpenCouncilHeader"

export default (() => OpenCouncilHeader) satisfies QuartzComponentConstructor
