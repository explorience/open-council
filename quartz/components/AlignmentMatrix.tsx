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
            <span>Show:</span>
            <select id="alignment-filter">
              <option value="current">Current Council (2022-2026)</option>
              <option value="all">All Councillors</option>
            </select>
          </label>
          <label>
            <span>Sort by:</span>
            <select id="alignment-sort">
              <option value="name">Name</option>
              <option value="cluster">Average Alignment</option>
            </select>
          </label>
        </div>
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
