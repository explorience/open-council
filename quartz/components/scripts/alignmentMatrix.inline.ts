import * as d3 from "d3"

interface Councillor {
  slug: string
  name: string
}

interface AlignmentData {
  councillors: Councillor[]
  matrix: Record<string, Record<string, number>>
  generatedAt: string
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

async function renderMatrix() {
  const container = document.getElementById("alignment-matrix")
  const tooltip = document.getElementById("alignment-tooltip")
  const filterSelect = document.getElementById("alignment-filter") as HTMLSelectElement
  const sortSelect = document.getElementById("alignment-sort") as HTMLSelectElement

  if (!container || !tooltip) return

  // Fetch alignment data
  let data: AlignmentData
  try {
    const response = await fetch("/static/data/stats/alignment-matrix.json")
    data = await response.json()
  } catch (e) {
    container.innerHTML = "<p>Unable to load alignment data</p>"
    return
  }

  function render() {
    container.innerHTML = ""

    const showCurrent = filterSelect?.value === "current"
    const sortBy = sortSelect?.value || "name"

    // Filter councillors
    let councillors = data.councillors.filter((c) => {
      if (showCurrent) {
        return CURRENT_COUNCIL.has(c.slug)
      }
      // For "all", only show councillors with alignment data
      return Object.keys(data.matrix[c.slug] || {}).length > 0
    })

    // Sort councillors
    if (sortBy === "cluster") {
      // Cluster by voting similarity using simple hierarchical grouping
      councillors = clusterCouncillors(councillors, data.matrix)
    } else {
      councillors.sort((a, b) => a.name.localeCompare(b.name))
    }

    const n = councillors.length
    if (n === 0) {
      container.innerHTML = "<p>No councillor data available</p>"
      return
    }

    // Calculate dimensions
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
    const colorScale = d3
      .scaleSequential(d3.interpolateRdYlGn)
      .domain([70, 100]) // Most alignments are 80-98%

    // Create cells
    councillors.forEach((row, i) => {
      councillors.forEach((col, j) => {
        if (i === j) {
          // Diagonal - self alignment (100%)
          svg
            .append("rect")
            .attr("x", j * cellSize)
            .attr("y", i * cellSize)
            .attr("width", cellSize - 1)
            .attr("height", cellSize - 1)
            .attr("fill", "#e5e5e5")
            .attr("rx", 2)
        } else {
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
                tooltip.style.display = "block"
                tooltip.style.left = event.pageX + 10 + "px"
                tooltip.style.top = event.pageY + 10 + "px"
                tooltip.innerHTML = `
                  <strong>${row.name}</strong> & <strong>${col.name}</strong><br>
                  Alignment: <strong>${alignment.toFixed(1)}%</strong>
                `
              })
              .on("mouseout", function () {
                d3.select(this).attr("stroke", "none")
                tooltip.style.display = "none"
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
      .attr("y", (d, i) => i * cellSize + cellSize / 2)
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
      .attr("x", (d, i) => i * cellSize + cellSize / 2)
      .attr("y", -5)
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "middle")
      .attr("font-size", Math.min(11, cellSize - 4))
      .attr("transform", (d, i) => `rotate(-45, ${i * cellSize + cellSize / 2}, -5)`)
      .text((d) => d.name.split(" ").pop() || d.name) // Last name only
  }

  // Initial render
  render()

  // Re-render on filter/sort change
  filterSelect?.addEventListener("change", render)
  sortSelect?.addEventListener("change", render)
}

// Simple clustering based on voting similarity
function clusterCouncillors(
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
