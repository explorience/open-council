import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/opencouncilheader.scss"
import script from "./scripts/opencouncilheader.inline"

const OpenCouncilHeader: QuartzComponent = () => {
  return <div className="open-council-header">
    <a href="https://github.com/explorience/open-council">
      <img src="/img/github-mark-white.svg"
           alt="GitHub Link"
           style="width:20px;height:20px"
           className="github-dark"
      />
      <img src="/img/github-mark.svg"
           alt="GitHub Link"
           style="width:20px;height:20px"
           className="github-light"
      />
    </a>
    <div className="title-div">
      <h1><a href="/">Open Council</a></h1>
    </div>
  </div>
}

OpenCouncilHeader.css = style
OpenCouncilHeader.beforeDOMLoaded = script

export default (() => OpenCouncilHeader) satisfies QuartzComponentConstructor

