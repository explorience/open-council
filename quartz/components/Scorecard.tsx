import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/scorecard.scss"

interface ScorecardOptions {
  showAlignment: boolean
}

const defaultOptions: ScorecardOptions = {
  showAlignment: true,
}

export default ((userOpts?: Partial<ScorecardOptions>) => {
  const Scorecard: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    // Only render on councillor pages with stats
    const pageType = fileData.frontmatter?.type as string | undefined
    const attendanceRate = fileData.frontmatter?.attendanceRate as number | undefined

    if (pageType !== "councillor" || attendanceRate === undefined) {
      return null
    }

    const participationRate = (fileData.frontmatter?.participationRate as number) || 0
    const yeaRate = (fileData.frontmatter?.yeaRate as number) || 0
    const totalVotes = (fileData.frontmatter?.totalVotes as number) || 0

    // Determine rating for each metric (for color coding)
    const getAttendanceRating = (rate: number) => {
      if (rate >= 80) return "excellent"
      if (rate >= 60) return "good"
      if (rate >= 40) return "fair"
      return "poor"
    }

    const getParticipationRating = (rate: number) => {
      if (rate >= 90) return "excellent"
      if (rate >= 75) return "good"
      if (rate >= 50) return "fair"
      return "poor"
    }

    return (
      <div class="scorecard">
        <h3>Councillor Scorecard</h3>
        <div class="scorecard-metrics">
          <div class={`scorecard-metric ${getAttendanceRating(attendanceRate)}`}>
            <div class="metric-value">{attendanceRate.toFixed(0)}%</div>
            <div class="metric-label">Attendance</div>
          </div>
          <div class={`scorecard-metric ${getParticipationRating(participationRate)}`}>
            <div class="metric-value">{participationRate.toFixed(0)}%</div>
            <div class="metric-label">Vote Participation</div>
          </div>
          <div class="scorecard-metric neutral">
            <div class="metric-value">{yeaRate.toFixed(0)}%</div>
            <div class="metric-label">Yea Rate</div>
          </div>
          <div class="scorecard-metric neutral">
            <div class="metric-value">{totalVotes.toLocaleString()}</div>
            <div class="metric-label">Total Votes</div>
          </div>
        </div>
      </div>
    )
  }

  Scorecard.css = style

  return Scorecard
}) satisfies QuartzComponentConstructor
