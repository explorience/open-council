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

function isWatching(slug: string): boolean {
  return getWatchlist().some((item) => item.slug === slug)
}

function toggleWatch(slug: string, title: string): boolean {
  const list = getWatchlist()
  const idx = list.findIndex((item) => item.slug === slug)
  if (idx >= 0) {
    list.splice(idx, 1)
    saveWatchlist(list)
    return false
  } else {
    list.push({
      slug,
      title,
      dateAdded: new Date().toISOString(),
      lastChecked: new Date().toISOString(),
    })
    saveWatchlist(list)
    return true
  }
}

document.addEventListener("nav", () => {
  const container = document.querySelector(".watch-button-container") as HTMLElement
  if (!container) return

  const btn = container.querySelector(".watch-btn") as HTMLButtonElement
  const iconOff = container.querySelector(".watch-icon-off") as SVGElement
  const iconOn = container.querySelector(".watch-icon-on") as SVGElement
  const label = container.querySelector(".watch-label") as HTMLSpanElement

  const slug = container.dataset.slug ?? ""
  const title = container.dataset.title ?? ""

  // Skip watchlist/alerts pages themselves
  if (slug === "watchlist" || slug === "alerts") {
    container.style.display = "none"
    return
  }

  function updateUI(watching: boolean) {
    btn.setAttribute("aria-pressed", String(watching))
    btn.classList.toggle("watching", watching)
    iconOff.style.display = watching ? "none" : "inline"
    iconOn.style.display = watching ? "inline" : "none"
    label.textContent = watching ? "Watching" : "Watch"
  }

  updateUI(isWatching(slug))

  function handleClick() {
    const nowWatching = toggleWatch(slug, title)
    updateUI(nowWatching)
    // Dispatch event for other components
    window.dispatchEvent(new CustomEvent("oc-watchlist-changed"))
  }

  btn.addEventListener("click", handleClick)
  window.addCleanup(() => btn.removeEventListener("click", handleClick))
})
