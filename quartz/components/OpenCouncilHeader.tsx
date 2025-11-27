import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/opencouncilheader.scss"
import script from "./scripts/opencouncilheader.inline"

const OpenCouncilHeader: QuartzComponent = () => {
  return <div className="open-council-header">
    <div className="title-div">
      <h1><a href="/">Open Council</a></h1>
    </div>
  </div>
}

OpenCouncilHeader.css = style
OpenCouncilHeader.beforeDOMLoaded = script

export default (() => OpenCouncilHeader) satisfies QuartzComponentConstructor

