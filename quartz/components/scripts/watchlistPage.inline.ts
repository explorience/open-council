import { escapeHTML } from "../../util/escape"

interface WatchItem {
  slug: string
  title: string
  dateAdded: string
  lastChecked: string
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

function saveWatchlist(items: WatchItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
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

function renderWatchlist() {
  const container = document.getElementById("watchlist-items")
  const emptyState = document.getElementById("watchlist-empty")
  const tabCount = document.querySelector(".tab-count")
  if (!container || !emptyState) return

  const items = getWatchlist()

  if (tabCount) tabCount.textContent = String(items.length)

  if (items.length === 0) {
    container.style.display = "none"
    emptyState.style.display = "flex"
    return
  }

  container.style.display = "grid"
  emptyState.style.display = "none"

  container.innerHTML = items
    .sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime())
    .map((item) => {
      const tag = getTopicTag(item.slug)
      // item.slug/item.title ultimately trace back to scraped meeting titles
      // (and can round-trip through a user's own Supabase row) — escape both
      // before they're interpolated into HTML *and* into the aria-label
      // attribute below, where an unescaped `"` could otherwise break out of
      // the attribute and inject markup/event handlers.
      const safeSlug = escapeHTML(item.slug)
      const safeTitle = escapeHTML(item.title)
      return `
        <div class="watchlist-card" data-slug="${safeSlug}">
          <div class="card-top">
            <span class="topic-tag ${tag.className}">${tag.label}</span>
            <button class="unwatch-btn" data-slug="${safeSlug}" aria-label="Unwatch ${safeTitle}">Unwatch</button>
          </div>
          <h3 class="card-title">
            <a href="/${safeSlug}">${safeTitle}</a>
          </h3>
          <div class="card-meta">
            Watching since ${formatDate(item.dateAdded)}
          </div>
        </div>
      `
    })
    .join("")

  // Bind unwatch buttons
  container.querySelectorAll(".unwatch-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const slug = (e.currentTarget as HTMLElement).dataset.slug
      if (!slug) return
      const list = getWatchlist().filter((i) => i.slug !== slug)
      saveWatchlist(list)
      renderWatchlist()
      window.dispatchEvent(new CustomEvent("oc-watchlist-changed"))
    })
  })
}

document.addEventListener("nav", () => {
  const page = document.querySelector(".watchlist-page")
  if (!page) return

  renderWatchlist()

  function onWatchlistChanged() {
    renderWatchlist()
  }

  window.addEventListener("oc-watchlist-changed", onWatchlistChanged)
  window.addCleanup(() => window.removeEventListener("oc-watchlist-changed", onWatchlistChanged))
})
