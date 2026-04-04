// Vote Explorer - client-side filtering, search, and infinite scroll

interface Motion {
  id: string
  d: string   // date
  ms: string  // meetingSlug
  mt: string  // meetingTitle
  tp: string  // meetingType
  in: string  // itemNumber
  it: string  // itemTitle
  tx: string  // motionText (truncated)
  r: string   // result
  p: boolean  // passed
  u: boolean  // unanimous
  y: string[] // yeas
  n: string[] // nays
  a: string[] // absent
  m: number   // margin
}

interface YearIndex {
  years: Record<string, { count: number; file: string; sizeKB: number }>
  totalSubstantive: number
}

// Councillor slug mapping for links
const COUNCILLOR_SLUGS: Record<string, string> = {
  "Josh Morgan": "j-morgan",
  "Hadleigh McAlister": "h-mcalister",
  "Shawn Lewis": "s-lewis",
  "Peter Cuddy": "p-cuddy",
  "Susan Stevenson": "s-stevenson",
  "Jerry Pribil": "j-pribil",
  "Sam Trosow": "s-trosow",
  "Corrine Rahman": "c-rahman",
  "Steve Lehman": "s-lehman",
  "Anna Hopkins": "a-hopkins",
  "David Ferreira": "d-ferreira",
  "Elizabeth Peloza": "e-peloza",
  "Skylar Franke": "s-franke",
  "Steve Hillier": "s-hillier",
  "Paul Van Meerbergen": "p-van-meerbergen",
}

// State
let allMotions: Motion[] = []
let filteredMotions: Motion[] = []
let displayedCount = 0
const BATCH_SIZE = 50
let loadingMore = false
let loadedYears = new Set<string>()
let yearIndex: YearIndex | null = null

// Current term years
const CURRENT_TERM = ["2022", "2023", "2024", "2025", "2026"]

async function loadYearData(year: string): Promise<Motion[]> {
  if (loadedYears.has(year)) return []
  try {
    const resp = await fetch(`/votes/votes-${year}.json`)
    if (!resp.ok) return []
    const data: Motion[] = await resp.json()
    loadedYears.add(year)
    return data
  } catch {
    return []
  }
}

async function loadYears(years: string[]): Promise<void> {
  const promises = years.filter(y => !loadedYears.has(y)).map(y => loadYearData(y))
  const results = await Promise.all(promises)
  for (const motions of results) {
    allMotions.push(...motions)
  }
  // Sort all by date desc
  allMotions.sort((a, b) => b.d.localeCompare(a.d))
}

function councillorLink(name: string): string {
  const slug = COUNCILLOR_SLUGS[name]
  if (slug) {
    return `<a href="/councillors/current/${slug}">${name}</a>`
  }
  return name
}

function renderMotion(motion: Motion): string {
  const passedClass = motion.p ? "ve-passed" : "ve-failed"
  const closeClass = !motion.u && motion.m <= 3 ? "ve-close" : ""
  const badge = motion.p ? "✅ " + motion.r : "❌ " + motion.r
  const closeIcon = !motion.u && motion.m <= 3 ? " 🔥" : ""

  // Meeting link
  const meetingLink = `/${motion.ms}`
  const dateStr = new Date(motion.d + "T12:00:00").toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  let rollcall = ""
  if (motion.u) {
    rollcall = `<div class="ve-unanimous">Unanimous (${motion.y.length}-0)</div>`
  } else {
    const yeas = motion.y.map(councillorLink).join(", ")
    const nays = motion.n.map(councillorLink).join(", ")
    const absent = motion.a.length > 0
      ? `<div class="ve-vote-group ve-absent"><span class="ve-vote-label">Absent (${motion.a.length}):</span> ${motion.a.map(councillorLink).join(", ")}</div>`
      : ""

    rollcall = `<details class="ve-rollcall">
      <summary>View roll call</summary>
      <div class="ve-rollcall-body">
        <div class="ve-vote-group ve-yeas"><span class="ve-vote-label">Yea (${motion.y.length}):</span> ${yeas}</div>
        <div class="ve-vote-group ve-nays"><span class="ve-vote-label">Nay (${motion.n.length}):</span> ${nays}</div>
        ${absent}
      </div>
    </details>`
  }

  const itemLabel = motion.in ? `${motion.in}. ` : ""

  return `<div class="ve-vote ${passedClass} ${closeClass}">
    <div class="ve-vote-header">
      <div>
        <div class="ve-vote-meta">
          <a href="${meetingLink}">${dateStr} — ${motion.mt}</a>
        </div>
        <div class="ve-item-title">${itemLabel}${motion.it}</div>
      </div>
      <span class="ve-result-badge">${badge}${closeIcon}</span>
    </div>
    <div class="ve-motion-text">${motion.tx}</div>
    ${rollcall}
  </div>`
}

function applyFilters(): void {
  const searchEl = document.getElementById("ve-search") as HTMLInputElement
  const yearEl = document.getElementById("ve-year") as HTMLSelectElement
  const typeEl = document.getElementById("ve-type") as HTMLSelectElement
  const resultEl = document.getElementById("ve-result") as HTMLSelectElement
  const splitEl = document.getElementById("ve-split") as HTMLSelectElement

  if (!searchEl || !yearEl || !typeEl || !resultEl || !splitEl) return

  const search = searchEl.value.toLowerCase().trim()
  const yearFilter = yearEl.value
  const typeFilter = typeEl.value
  const resultFilter = resultEl.value
  const splitFilter = splitEl.value

  filteredMotions = allMotions.filter((m) => {
    // Year filter
    if (yearFilter === "current") {
      if (!CURRENT_TERM.includes(m.d.slice(0, 4))) return false
    } else if (yearFilter !== "all") {
      if (!m.d.startsWith(yearFilter)) return false
    }

    // Meeting type filter
    if (typeFilter !== "all" && !m.tp.includes(typeFilter)) return false

    // Result filter
    if (resultFilter === "passed" && !m.p) return false
    if (resultFilter === "failed" && m.p) return false

    // Split filter
    if (splitFilter === "contested" && m.u) return false
    if (splitFilter === "close" && (m.u || m.m > 3)) return false

    // Search
    if (search) {
      const haystack = (m.it + " " + m.tx + " " + m.mt + " " + m.y.join(" ") + " " + m.n.join(" ")).toLowerCase()
      // Support multi-word search
      const words = search.split(/\s+/)
      if (!words.every(w => haystack.includes(w))) return false
    }

    return true
  })

  // Update stats
  const statsEl = document.getElementById("ve-stats")
  if (statsEl) {
    const contested = filteredMotions.filter(m => !m.u).length
    statsEl.textContent = `Showing ${filteredMotions.length.toLocaleString()} votes (${contested.toLocaleString()} contested)`
  }

  // Reset display
  displayedCount = 0
  const resultsEl = document.getElementById("ve-results")
  if (resultsEl) resultsEl.innerHTML = ""

  renderBatch()
}

function renderBatch(): void {
  const resultsEl = document.getElementById("ve-results")
  if (!resultsEl) return

  const batch = filteredMotions.slice(displayedCount, displayedCount + BATCH_SIZE)
  if (batch.length === 0) {
    if (displayedCount === 0) {
      resultsEl.innerHTML = '<div class="ve-loading">No votes match your filters.</div>'
    }
    return
  }

  const html = batch.map(renderMotion).join("")
  resultsEl.insertAdjacentHTML("beforeend", html)
  displayedCount += batch.length
}

async function init(): Promise<void> {
  const container = document.querySelector(".vote-explorer")
  if (!container) return

  const loadingEl = document.getElementById("ve-loading")

  try {
    // Load index
    const indexResp = await fetch("/votes/index.json")
    yearIndex = await indexResp.json()

    // Load current term by default
    if (loadingEl) loadingEl.textContent = "Loading current term votes..."
    await loadYears(CURRENT_TERM)

    // Remove loading indicator
    if (loadingEl) loadingEl.remove()

    // Apply initial filters
    applyFilters()

    // Set up event listeners
    const searchEl = document.getElementById("ve-search") as HTMLInputElement
    let searchTimeout: ReturnType<typeof setTimeout>
    searchEl?.addEventListener("input", () => {
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(applyFilters, 250)
    })

    const yearEl = document.getElementById("ve-year") as HTMLSelectElement
    yearEl?.addEventListener("change", async () => {
      const val = yearEl.value
      if (val === "all") {
        // Load all years
        const allYears = Object.keys(yearIndex!.years)
        if (loadingEl) {
          const newLoading = document.createElement("div")
          newLoading.className = "ve-loading"
          newLoading.id = "ve-loading"
          newLoading.textContent = "Loading all years..."
          document.getElementById("ve-results")?.prepend(newLoading)
        }
        await loadYears(allYears)
        document.getElementById("ve-loading")?.remove()
      } else if (val !== "current") {
        await loadYears([val])
      }
      applyFilters()
    })

    document.getElementById("ve-type")?.addEventListener("change", applyFilters)
    document.getElementById("ve-result")?.addEventListener("change", applyFilters)
    document.getElementById("ve-split")?.addEventListener("change", applyFilters)

    // Infinite scroll
    const sentinel = document.getElementById("ve-sentinel")
    if (sentinel) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !loadingMore && displayedCount < filteredMotions.length) {
            loadingMore = true
            renderBatch()
            loadingMore = false
          }
        },
        { rootMargin: "200px" }
      )
      observer.observe(sentinel)
    }

  } catch (err) {
    if (loadingEl) loadingEl.textContent = "Failed to load vote data."
    console.error("Vote explorer init error:", err)
  }
}

document.addEventListener("nav", () => {
  // Reset state on navigation
  allMotions = []
  filteredMotions = []
  displayedCount = 0
  loadedYears = new Set()
  yearIndex = null
  init()
})
