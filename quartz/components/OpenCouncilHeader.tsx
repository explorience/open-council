import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/opencouncilheader.scss"
import script from "./scripts/opencouncilheader.inline"

const OpenCouncilHeader: QuartzComponent = () => {
  return <div className="open-council-header">
    <div className="title-div">
      <h1><a href="/">Open Council</a></h1>
    </div>
    <a href="/about" className="about-link" aria-label="About Open Council">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="info-icon"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    </a>
  </div>
}

OpenCouncilHeader.css = style
OpenCouncilHeader.beforeDOMLoaded = script

export default (() => OpenCouncilHeader) satisfies QuartzComponentConstructor

