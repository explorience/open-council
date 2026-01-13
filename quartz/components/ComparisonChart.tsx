import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/comparisonChart.inline"
import style from "./styles/comparisonChart.scss"

export default (() => {
  const ComparisonChart: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    // Only render on councillor pages with stats
    const pageType = fileData.frontmatter?.type as string | undefined
    const attendanceRate = fileData.frontmatter?.attendanceRate as number | undefined
    const councillorSlug = fileData.frontmatter?.councillorSlug as string | undefined

    if (pageType !== "councillor" || attendanceRate === undefined) {
      return null
    }

    return (
      <div
        id="comparison-chart-modal"
        class="comparison-modal"
        data-councillor-slug={councillorSlug}
      >
        <div class="comparison-modal-backdrop"></div>
        <div class="comparison-modal-content">
          <button class="comparison-modal-close" aria-label="Close modal">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <h3 class="comparison-modal-title"></h3>
          <div id="comparison-chart-container" class="comparison-chart"></div>
        </div>
      </div>
    )
  }

  ComparisonChart.css = style
  ComparisonChart.afterDOMLoaded = script

  return ComparisonChart
}) satisfies QuartzComponentConstructor
