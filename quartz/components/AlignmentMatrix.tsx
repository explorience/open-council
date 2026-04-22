import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/alignmentMatrix.inline"
import style from "./styles/alignmentMatrix.scss"

export default (() => {
  const AlignmentMatrix: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    // Only render on the alignment page
    const pageType = fileData.frontmatter?.type as string | undefined
    if (pageType !== "alignment-matrix") {
      return null
    }

    return (
      <div class="alignment-matrix-container">
        <div class="alignment-controls">
          <label>
            <span>View:</span>
            <select id="alignment-view">
              <option value="overall">Overall</option>
              <option value="committee">By Committee</option>
              <option value="topic">By Topic</option>
            </select>
          </label>
          <label id="alignment-sub-label" style="display: none">
            <span>Filter:</span>
            <select id="alignment-sub"></select>
          </label>
          <label>
            <span>Sort by:</span>
            <select id="alignment-sort">
              <option value="name">Name</option>
              <option value="cluster">Average Alignment</option>
            </select>
          </label>
        </div>
        <div id="alignment-count" class="alignment-count"></div>
        <div class="alignment-legend">
          <span class="legend-label">Low alignment</span>
          <div class="legend-gradient"></div>
          <span class="legend-label">High alignment</span>
        </div>
        <div id="alignment-matrix" class="alignment-matrix"></div>
        <div id="alignment-tooltip" class="alignment-tooltip"></div>
      </div>
    )
  }

  AlignmentMatrix.css = style
  AlignmentMatrix.afterDOMLoaded = script

  return AlignmentMatrix
}) satisfies QuartzComponentConstructor
