interface CouncillorStats {
  councillor: string
  slug: string
  attendance: {
    attendanceRate: number
    totalMeetings: number
  }
  voting: {
    participationRate: number
    yeaRate: number
    totalVotes: number
  }
}

interface StatsData {
  councillorStats: Record<string, CouncillorStats>
}

// Current council members
const CURRENT_COUNCIL = new Set([
  "j-morgan",
  "h-mcalister",
  "s-lewis",
  "p-cuddy",
  "s-stevenson",
  "j-pribil",
  "s-trosow",
  "c-rahman",
  "s-lehman",
  "a-hopkins",
  "p-van-meerbergen",
  "s-franke",
  "e-peloza",
  "d-ferreira",
  "s-hillier",
])

async function renderRankings() {
  const container = document.getElementById("rankings-chart")
  const tabs = document.querySelectorAll(".rankings-tab")
  const currentOnlyCheckbox = document.getElementById(
    "show-current-only"
  ) as HTMLInputElement

  if (!container) return

  // Fetch stats data
  let data: StatsData
  try {
    const response = await fetch("/static/data/stats/councillor-stats.json")
    data = await response.json()
  } catch (e) {
    container.innerHTML = "<p>Unable to load councillor data</p>"
    return
  }

  let currentMetric = "attendance"

  function render() {
    const showCurrentOnly = currentOnlyCheckbox?.checked ?? true

    // Get councillors based on filter
    let councillors = Object.values(data.councillorStats).filter((c) => {
      if (showCurrentOnly) {
        return CURRENT_COUNCIL.has(c.slug)
      }
      // Only show councillors with meaningful data
      return c.voting.totalVotes > 50
    })

    // Get metric value and sort
    const getValue = (c: CouncillorStats): number => {
      switch (currentMetric) {
        case "attendance":
          return c.attendance.attendanceRate
        case "participation":
          return c.voting.participationRate
        case "dissent":
          return 100 - c.voting.yeaRate
        default:
          return 0
      }
    }

    councillors.sort((a, b) => getValue(b) - getValue(a))

    // Limit to top 15
    councillors = councillors.slice(0, 15)

    // Clear container
    container.innerHTML = ""

    if (councillors.length === 0) {
      container.innerHTML = "<p>No data available</p>"
      return
    }

    // Get max value for scaling
    const maxValue = Math.max(...councillors.map(getValue))

    // Create bars
    councillors.forEach((c, index) => {
      const value = getValue(c)
      const width = (value / maxValue) * 100

      const bar = document.createElement("div")
      bar.className = "ranking-bar"
      bar.innerHTML = `
        <span class="ranking-position">${index + 1}</span>
        <a href="/councillors/${CURRENT_COUNCIL.has(c.slug) ? "current" : "former"}/${c.slug}" class="ranking-name">
          ${c.councillor}
        </a>
        <div class="ranking-bar-container">
          <div class="ranking-bar-fill" style="width: ${width}%"></div>
        </div>
        <span class="ranking-value">${value.toFixed(1)}%</span>
      `
      container.appendChild(bar)
    })
  }

  // Initial render
  render()

  // Handle tab clicks
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"))
      tab.classList.add("active")
      currentMetric = (tab as HTMLElement).dataset.metric || "attendance"
      render()
    })
  })

  // Handle filter change
  currentOnlyCheckbox?.addEventListener("change", render)
}

document.addEventListener("nav", () => {
  renderRankings()
})
