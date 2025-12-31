import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/votingRecord.scss"

interface VotingRecordOptions {
  showPercentages: boolean
}

const defaultOptions: VotingRecordOptions = {
  showPercentages: true,
}

export default ((userOpts?: Partial<VotingRecordOptions>) => {
  const VotingRecord: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    // Only render on councillor pages with vote data
    const pageType = fileData.frontmatter?.type as string | undefined
    const totalVotes = fileData.frontmatter?.totalVotes as number | undefined

    if (pageType !== "councillor" || !totalVotes) {
      return null
    }

    const yeas = (fileData.frontmatter?.votesYea as number) || 0
    const nays = (fileData.frontmatter?.votesNay as number) || 0
    const absent = (fileData.frontmatter?.votesAbsent as number) || 0

    // Calculate percentages
    const yeaPct = ((yeas / totalVotes) * 100).toFixed(1)
    const nayPct = ((nays / totalVotes) * 100).toFixed(1)
    const absentPct = ((absent / totalVotes) * 100).toFixed(1)

    // Calculate bar widths (yea + nay should = 100% of participation)
    const participated = yeas + nays
    const yeaWidth = participated > 0 ? (yeas / participated) * 100 : 50
    const nayWidth = participated > 0 ? (nays / participated) * 100 : 50

    return (
      <div class="voting-record">
        <h3>Voting Summary</h3>

        <div class="voting-bar">
          <div class="voting-bar-yea" style={`width: ${yeaWidth}%`}>
            <span class="voting-bar-label">Yea</span>
          </div>
          <div class="voting-bar-nay" style={`width: ${nayWidth}%`}>
            <span class="voting-bar-label">Nay</span>
          </div>
        </div>

        <div class="voting-stats">
          <div class="voting-stat voting-stat-yea">
            <span class="voting-stat-value">{yeas.toLocaleString()}</span>
            <span class="voting-stat-label">Yea votes</span>
            {opts.showPercentages && <span class="voting-stat-pct">{yeaPct}%</span>}
          </div>
          <div class="voting-stat voting-stat-nay">
            <span class="voting-stat-value">{nays.toLocaleString()}</span>
            <span class="voting-stat-label">Nay votes</span>
            {opts.showPercentages && <span class="voting-stat-pct">{nayPct}%</span>}
          </div>
          <div class="voting-stat voting-stat-absent">
            <span class="voting-stat-value">{absent.toLocaleString()}</span>
            <span class="voting-stat-label">Absent</span>
            {opts.showPercentages && <span class="voting-stat-pct">{absentPct}%</span>}
          </div>
          <div class="voting-stat voting-stat-total">
            <span class="voting-stat-value">{totalVotes.toLocaleString()}</span>
            <span class="voting-stat-label">Total votes</span>
          </div>
        </div>
      </div>
    )
  }

  VotingRecord.css = style

  return VotingRecord
}) satisfies QuartzComponentConstructor
