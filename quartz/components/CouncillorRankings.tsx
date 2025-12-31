import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/councillorRankings.inline"
import style from "./styles/councillorRankings.scss"

interface CouncillorRankingsOptions {
  title: string
}

const defaultOptions: CouncillorRankingsOptions = {
  title: "Councillor Rankings",
}

export default ((userOpts?: Partial<CouncillorRankingsOptions>) => {
  const CouncillorRankings: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    // Only render on councillor-index pages
    const pageType = fileData.frontmatter?.type as string | undefined
    if (pageType !== "councillor-index") {
      return null
    }

    return (
      <div class="councillor-rankings">
        <div class="rankings-tabs">
          <button class="rankings-tab active" data-metric="attendance">
            Attendance
          </button>
          <button class="rankings-tab" data-metric="participation">
            Vote Participation
          </button>
          <button class="rankings-tab" data-metric="dissent">
            Dissent Rate
          </button>
        </div>
        <div class="rankings-filter">
          <label>
            <input type="checkbox" id="show-current-only" checked />
            <span>Current council only</span>
          </label>
        </div>
        <div id="rankings-chart" class="rankings-chart"></div>
      </div>
    )
  }

  CouncillorRankings.css = style
  CouncillorRankings.afterDOMLoaded = script

  return CouncillorRankings
}) satisfies QuartzComponentConstructor
