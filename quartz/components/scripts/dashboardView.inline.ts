// Dashboard view button handlers

document.addEventListener("nav", () => {
  const dashboardView = document.querySelector(".dashboard-view") as HTMLElement
  if (!dashboardView) return

  const browseAllBtn = dashboardView.querySelector(".browse-all-btn") as HTMLButtonElement
  const searchBtn = dashboardView.querySelector(".search-btn") as HTMLButtonElement
  const browseAllLink = dashboardView.querySelector(".browse-all-link") as HTMLAnchorElement

  // Helper function to trigger search (dispatches Ctrl+K keyboard shortcut)
  function triggerSearch() {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)
  }

  // Browse All Files - reveal the homepage's own copy of the Explorer
  // browse-tree in place. browseAllBtn is a real <a href="/months"> (a
  // working fallback if this listener never runs), so it needs
  // preventDefault() to actually enhance into an in-page reveal instead
  // of always just navigating away before the toggle below is visible -
  // verified design-gate finding: without it, the browser starts
  // navigating to /months in the same tick as the click, so nothing this
  // handler does was ever observable.
  browseAllBtn?.addEventListener("click", (e) => {
    const explorer = document.querySelector(".explorer") as HTMLElement
    if (!explorer) return // no explorer on this render - let the /months link work normally
    e.preventDefault()

    const isVisible = explorer.classList.contains("visible")
    explorer.classList.toggle("visible", !isVisible)

    if (!isVisible) {
      // Expand the explorer tree (its own toggle sits on .explorer
      // itself and flips .collapsed - see explorer.inline.ts's
      // toggleExplorer - not the stale #explorer/#explorer-ul ids this
      // used to look for, which nothing in Explorer.tsx's markup sets).
      const toggleBtn = explorer.querySelector(".desktop-explorer") as HTMLButtonElement
      if (toggleBtn && explorer.classList.contains("collapsed")) {
        toggleBtn.click()
      }

      // Scroll to explorer
      setTimeout(() => {
        explorer.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 100)
    }
  })

  // Full Search - open search
  searchBtn?.addEventListener("click", () => {
    triggerSearch()
  })

  // View all meetings link - open search
  browseAllLink?.addEventListener("click", (e) => {
    e.preventDefault()
    triggerSearch()
  })
})
