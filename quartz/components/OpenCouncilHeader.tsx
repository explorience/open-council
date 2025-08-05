import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

const OpenCouncilHeader: QuartzComponent = () => {
  return <div className="open-council-header">
    <a href="https://github.com/explorience/open-council">
      <img src="/img/github-mark-white.svg"
           alt="GitHub Link"
           style="width:20px;height:20px"
      />
    </a>
    <h1><a href="/">Open Council</a></h1>
  </div>
}

OpenCouncilHeader.css = `
.open-council-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 15px;
  height: 50px;
  * {
    height: 100%;
  }
}
`

export default (() => OpenCouncilHeader) satisfies QuartzComponentConstructor

