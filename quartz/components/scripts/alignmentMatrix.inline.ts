import * as d3 from "d3"

interface Councillor {
  slug: string
  name: string
}

interface AlignmentData {
  councillors: Councillor[]
  matrix: Record<string, Record<string, number>>
  generatedAt: string
  motionCount?: number
  type?: string
  committeeName?: string
  topicName?: string
}

// Current council members (2022-2026 term)
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

const COMMITTEES = [
  { slug: "budget", label: "Budget & Finance" },
  { slug: "civic-works", label: "Civic Works" },
  { slug: "community-protective", label: "Community & Protective Services" },
  { slug: "corporate-services", label: "Corporate Services" },
  { slug: "council", label: "City Council" },
  { slug: "infrastructure-corporate", label: "Infrastructure & Corporate" },
  { slug: "planning-environment", label: "Planning & Environment" },
  { slug: "strategic-priorities", label: "Strategic Priorities" },
]

const TOPICS = [
  { slug: "budget-taxes", label: "Budget & Taxes" },
  { slug: "climate-environment", label: "Climate & Environment" },
  { slug: "economic-development", label: "Economic Development" },
  { slug: "housing", label: "Housing" },
  { slug: "infrastructure", label: "Infrastructure" },
  { slug: "parks-recreation", label: "Parks & Recreation" },
  { slug: "planning-development", label: "Planning & Development" },
  { slug: "public-safety", label: "Public Safety" },
  { slug: "social-services", label: "Social Services" },
  { slug: "transportation", label: "Transportation" },
]

async function renderMatrix() {
  const container = document.getElementById("alignment-matrix")
  const tooltip = document.getElementById("alignment-tooltip")
  const sortSelect = document.getElementById("alignment-sort") as HTMLSelectElement
  const viewSelect = document.getElementById("alignment-view") as HTMLSelectElement
  const subLabel = document.getElementById("alignment-sub-label") as HTMLElement
  const subSelect = document.getElementById("alignment-sub") as HTMLSelectElement
  const countEl = document.getElementById("alignment-count")

  if (!container || !tooltip) return

  // Cache the last loaded data so sort changes don't need to re-fetch
  let currentData: AlignmentData | null = null

  function populateSubSelect(items: { slug: string; label: string }[]) {
    subSelect.innerHTML = ""
    items.forEach(({ slug, label }) => {
      const opt = document.createElement("option")
      opt.value = slug
      opt.textContent = label
      subSelect.appendChild(opt)
    })
  }

  async function loadData(): Promise<AlignmentData | null> {
    const view = viewSelect?.value || "overall"
    let url: string

    if (view === "committee") {
      const slug = subSelect?.value || COMMITTEES[0].slug
      url = `/static/data/stats/alignment-committee-${slug}.json`
    } else if (view === "topic") {
      const slug = subSelect?.value || TOPICS[0].slug
      url = `/static/data/stats/alignment-topic-${slug}.json`
    } else {
      url = "/static/data/stats/alignment-matrix.json"
    }

    try {
      const response = await fetch(url)
      return await response.json()
    } catch (e) {
      container!.innerHTML = "<p>Unable to load alignment data</p>"
      return null
    }
  }

  function render(data: AlignmentData) {
    if (!container) return
    container.innerHTML = ""

    const view = viewSelect?.value || "overall"
    const sortBy = sortSelect?.value || "name"

    // For overall view, filter to current council only.
    // For committee/topic views, filter out councillors with no co-vote data with
    // anyone else (they're in the file but not actual committee members).
    let councillors =
      view === "overall"
        ? data.councillors.filter((c) => CURRENT_COUNCIL.has(c.slug))
        : data.councillors.filter((c) =>
            data.councillors.some(
              (other) => other.slug !== c.slug && data.matrix[c.slug]?.[other.slug] !== undefined,
            ),
          )

    // Update vote count label
    if (countEl) {
      if (data.motionCount !== undefined) {
        countEl.textContent = `${data.motionCount} votes analyzed`
        countEl.style.display = "block"
      } else {
        countEl.style.display = "none"
      }
    }

    // Sort councillors
    if (sortBy === "cluster") {
      councillors = sortByAverageAlignment(councillors, data.matrix)
    } else {
      councillors.sort((a, b) => a.name.localeCompare(b.name))
    }

    const n = councillors.length
    if (n === 0) {
      container.innerHTML = "<p>No councillor data available</p>"
      return
    }

    // Calculate dimensions for triangle layout
    const cellSize = Math.min(40, Math.floor(600 / n))
    const margin = { top: 120, right: 20, bottom: 20, left: 120 }
    const width = n * cellSize
    const height = n * cellSize

    // Create SVG
    const svg = d3
      .select(container)
      .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`)

    // Color scale (red = low alignment, green = high alignment)
    // Clamp so values outside [50, 98] don't extrapolate into unexpected colors.
    // Domain starts at 50 rather than 77 to handle contentious committee votes.
    const colorScale = d3.scaleSequential(d3.interpolateRdYlGn).domain([50, 98]).clamp(true)

    // Create cells - only lower-left triangle (row > col) plus diagonal
    councillors.forEach((row, i) => {
      // Diagonal cell (gray anchor)
      svg
        .append("rect")
        .attr("x", i * cellSize)
        .attr("y", i * cellSize)
        .attr("width", cellSize - 1)
        .attr("height", cellSize - 1)
        .attr("fill", "#e5e5e5")
        .attr("rx", 2)

      // Lower triangle only (where row index > column index)
      councillors.forEach((col, j) => {
        if (i > j) {
          const alignment = data.matrix[row.slug]?.[col.slug]
          if (alignment !== undefined) {
            svg
              .append("rect")
              .attr("x", j * cellSize)
              .attr("y", i * cellSize)
              .attr("width", cellSize - 1)
              .attr("height", cellSize - 1)
              .attr("fill", colorScale(alignment))
              .attr("rx", 2)
              .attr("class", "matrix-cell")
              .on("mouseover", function (event) {
                d3.select(this).attr("stroke", "#000").attr("stroke-width", 2)
                if (tooltip) {
                  tooltip.style.display = "block"
                  tooltip.style.left = event.pageX + 10 + "px"
                  tooltip.style.top = event.pageY + 10 + "px"
                  tooltip.innerHTML = `
                    <strong>${row.name}</strong> & <strong>${col.name}</strong><br>
                    Alignment: <strong>${alignment.toFixed(1)}%</strong>
                  `
                }
              })
              .on("mouseout", function () {
                d3.select(this).attr("stroke", "none")
                if (tooltip) tooltip.style.display = "none"
              })
          }
        }
      })
    })

    // Add row labels (councillor names on left)
    svg
      .selectAll(".row-label")
      .data(councillors)
      .enter()
      .append("text")
      .attr("class", "row-label")
      .attr("x", -5)
      .attr("y", (_d, i) => i * cellSize + cellSize / 2)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("font-size", Math.min(11, cellSize - 4))
      .text((d) => d.name.split(" ").pop() || d.name) // Last name only

    // Add column labels (councillor names on top)
    svg
      .selectAll(".col-label")
      .data(councillors)
      .enter()
      .append("text")
      .attr("class", "col-label")
      .attr("x", (_d, i) => i * cellSize + cellSize / 2)
      .attr("y", -5)
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "middle")
      .attr("font-size", Math.min(11, cellSize - 4))
      .attr("transform", (_d, i) => `rotate(-45, ${i * cellSize + cellSize / 2}, -5)`)
      .text((d) => d.name.split(" ").pop() || d.name) // Last name only
  }

  async function loadAndRender() {
    const data = await loadData()
    if (data) {
      currentData = data
      render(data)
    }
  }

  // Handle view selector changes: update sub-selector visibility, then reload data
  viewSelect?.addEventListener("change", async () => {
    const view = viewSelect.value
    if (view === "committee") {
      populateSubSelect(COMMITTEES)
      subLabel.style.display = ""
    } else if (view === "topic") {
      populateSubSelect(TOPICS)
      subLabel.style.display = ""
    } else {
      subLabel.style.display = "none"
    }
    await loadAndRender()
  })

  // Handle sub-selector changes: reload data for the new selection
  subSelect?.addEventListener("change", loadAndRender)

  // Re-render on sort change using cached data (no fetch needed)
  sortSelect?.addEventListener("change", () => {
    if (currentData) render(currentData)
  })

  // Initial load
  await loadAndRender()
}

// Sort councillors by their average alignment with all other councillors
// Councillors with higher average alignment (more consensus-oriented) appear first
function sortByAverageAlignment(
  councillors: Councillor[],
  matrix: Record<string, Record<string, number>>
): Councillor[] {
  if (councillors.length <= 2) return councillors

  // Calculate average alignment for each councillor
  const avgAlignment: Record<string, number> = {}
  councillors.forEach((c) => {
    const alignments = councillors
      .filter((other) => other.slug !== c.slug)
      .map((other) => matrix[c.slug]?.[other.slug] || 0)
      .filter((a) => a > 0)

    avgAlignment[c.slug] =
      alignments.length > 0
        ? alignments.reduce((sum, a) => sum + a, 0) / alignments.length
        : 0
  })

  // Sort by average alignment (groups similar voters together)
  return [...councillors].sort((a, b) => avgAlignment[b.slug] - avgAlignment[a.slug])
}

document.addEventListener("nav", () => {
  renderMatrix()
})
