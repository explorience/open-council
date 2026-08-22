import { escapeHTML } from "../../util/escape"

interface WatchItem {
  slug: string
  title: string
  dateAdded: string
  lastChecked: string
}

interface ContentIndexEntry {
  title: string
  links: string[]
  tags: string[]
  content: string
  richContent?: string
  date?: string
  description?: string
}

const STORAGE_KEY = "oc-watchlist"

function getWatchlist(): WatchItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })
}

function getTopicTag(slug: string): { label: string; className: string } {
  if (slug.includes("planning") || slug.includes("zoning")) return { label: "Planning", className: "tag-zoning" }
  if (slug.includes("budget")) return { label: "Budget", className: "tag-budget" }
  if (slug.includes("civic-works") || slug.includes("transit")) return { label: "Civic Works", className: "tag-transit" }
  if (slug.includes("community") || slug.includes("protective")) return { label: "Community", className: "tag-community" }
  if (slug.includes("strategic")) return { label: "Strategic Priorities", className: "tag-strategic" }
  if (slug.includes("councillor")) return { label: "Councillor", className: "tag-councillor" }
  return { label: "Council", className: "tag-council" }
}

function getAlertIcon(slug: string): string {
  if (slug.includes("planning") || slug.includes("zoning")) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
  }
  if (slug.includes("budget")) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
}

async function loadContentIndex(): Promise<Map<string, ContentIndexEntry> | null> {
  try {
    const baseUrl = document.querySelector<HTMLMetaElement>('meta[name="base-url"]')?.content ?? ""
    const response = await fetch(`${baseUrl}/static/contentIndex.json`)
    if (!response.ok) return null
    const data = await response.json()
    return new Map(Object.entries(data))
  } catch {
    return null
  }
}

async function renderAlerts() {
  const list = document.getElementById("alerts-list")
  const emptyState = document.getElementById("alerts-empty")
  const filtersContainer = document.getElementById("alerts-filters")
  if (!list || !emptyState) return

  const watchlist = getWatchlist()
  if (watchlist.length === 0) {
    list.style.display = "none"
    emptyState.style.display = "flex"
    return
  }

  const contentIndex = await loadContentIndex()
  if (!contentIndex) {
    list.innerHTML = '<p class="alerts-loading">Loading council data...</p>'
    return
  }

  // Find recent content that matches watched slugs or relates to watched topics
  const watchedSlugs = new Set(watchlist.map((w) => w.slug))
  const alerts: Array<{ slug: string; title: string; date: string; tag: ReturnType<typeof getTopicTag> }> = []

  for (const [slug, entry] of contentIndex.entries()) {
    // Direct match or slug contains a watched topic
    const isWatched = watchedSlugs.has(slug)
    const relatedWatch = watchlist.find((w) => {
      // Check if this content page is under a watched committee/councillor
      const wParts = w.slug.split("/")
      const sParts = slug.split("/")
      return wParts.length > 0 && sParts.length > 1 && sParts[0] === wParts[0]
    })

    if (isWatched || relatedWatch) {
      const date = entry.date ?? ""
      if (date) {
        alerts.push({
          slug,
          title: entry.title || slug,
          date,
          tag: getTopicTag(slug),
        })
      }
    }
  }

  // Sort by date descending, limit to 50
  alerts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const recentAlerts = alerts.slice(0, 50)

  if (recentAlerts.length === 0) {
    list.style.display = "none"
    emptyState.style.display = "flex"
    return
  }

  // Build filter buttons
  const categories = new Set(recentAlerts.map((a) => a.tag.label))
  if (filtersContainer && categories.size > 1) {
    const filterBtns = [`<button class="filter-btn active" data-filter="all">All</button>`]
    for (const cat of categories) {
      filterBtns.push(`<button class="filter-btn" data-filter="${cat}">${cat}</button>`)
    }
    filtersContainer.innerHTML = filterBtns.join("")

    filtersContainer.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        filtersContainer.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"))
        btn.classList.add("active")
        const filter = (btn as HTMLElement).dataset.filter
        list.querySelectorAll(".alert-card").forEach((card) => {
          const cardEl = card as HTMLElement
          if (filter === "all" || cardEl.dataset.category === filter) {
            cardEl.style.display = ""
          } else {
            cardEl.style.display = "none"
          }
        })
      })
    })
  }

  // Render alerts
  list.style.display = "flex"
  emptyState.style.display = "none"
  list.innerHTML = recentAlerts
    .map((alert) => {
      // alert.slug/alert.title come from contentIndex.json, generated from
      // scraped meeting content — untrusted. Escape before interpolating.
      const safeSlug = escapeHTML(alert.slug)
      const safeTitle = escapeHTML(alert.title)
      return `
    <div class="alert-card" data-category="${alert.tag.label}">
      <div class="alert-icon ${alert.tag.className}">
        ${getAlertIcon(alert.slug)}
      </div>
      <div class="alert-body">
        <div class="alert-top">
          <span class="topic-tag ${alert.tag.className}">${alert.tag.label}</span>
          <span class="alert-date">${formatDate(alert.date)}</span>
        </div>
        <h4 class="alert-title">
          <a href="/${safeSlug}">${safeTitle}</a>
        </h4>
        <div class="alert-meta">
          <a href="/${safeSlug}" class="alert-link">View meeting &rarr;</a>
        </div>
      </div>
    </div>
  `
    })
    .join("")
}

document.addEventListener("nav", () => {
  const feed = document.querySelector(".alerts-feed")
  if (!feed) return

  renderAlerts()

  function onWatchlistChanged() {
    renderAlerts()
  }

  window.addEventListener("oc-watchlist-changed", onWatchlistChanged)
  window.addCleanup(() => window.removeEventListener("oc-watchlist-changed", onWatchlistChanged))
})
