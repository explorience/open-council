import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/scorecard.inline"
import style from "./styles/scorecard.scss"

export default (() => {
  const Scorecard: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    // Only render on councillor pages with stats
    const pageType = fileData.frontmatter?.type as string | undefined
    const attendanceRate = fileData.frontmatter?.attendanceRate as number | undefined

    if (pageType !== "councillor" || attendanceRate === undefined) {
      return null
    }

    const participationRate = (fileData.frontmatter?.participationRate as number) || 0
    const yeaRate = (fileData.frontmatter?.yeaRate as number) || 0
    const totalVotes = (fileData.frontmatter?.totalVotes as number) || 0
    const isCurrent = fileData.slug?.includes("/current/") ?? false

    // Get councillor slug from the file path
    const slug = fileData.slug?.split("/").pop() || ""

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
      <div class="scorecard" data-councillor-slug={slug}>
        <h3>Councillor Scorecard</h3>
        <div class="scorecard-metrics">
          <div
            class={`scorecard-metric clickable ${getAttendanceRating(attendanceRate)}`}
            data-metric="attendance"
            role="button"
            tabIndex={0}
          >
            <div class="metric-value">{attendanceRate.toFixed(0)}%</div>
            <div class="metric-label">Attendance</div>
            <div class="metric-hint">Click to compare</div>
          </div>
          <div
            class={`scorecard-metric clickable ${getParticipationRating(participationRate)}`}
            data-metric="participation"
            role="button"
            tabIndex={0}
          >
            <div class="metric-value">{participationRate.toFixed(0)}%</div>
            <div class="metric-label">Vote Participation</div>
            <div class="metric-hint">Click to compare</div>
          </div>
          <div
            class="scorecard-metric clickable neutral"
            data-metric="yeaRate"
            role="button"
            tabIndex={0}
            title="Percentage of votes cast as Yea (excludes absences)"
          >
            <div class="metric-value">{yeaRate.toFixed(0)}%</div>
            <div class="metric-label">Yea Rate (when voting)</div>
            <div class="metric-hint">Click to compare</div>
          </div>
          <div
            class="scorecard-metric clickable neutral"
            data-metric="totalVotes"
            role="button"
            tabIndex={0}
          >
            <div class="metric-value">{totalVotes.toLocaleString()}</div>
            <div class="metric-label">Total Votes</div>
            <div class="metric-hint">Click to compare</div>
          </div>
        </div>
        {isCurrent && (
          <div class="scorecard-footer">
            <a href="/councillors/alignment" class="alignment-link">
              View voting alignment with other councillors →
            </a>
          </div>
        )}
      </div>
    )
  }

  Scorecard.css = style
  Scorecard.afterDOMLoaded = script

  return Scorecard
}) satisfies QuartzComponentConstructor
