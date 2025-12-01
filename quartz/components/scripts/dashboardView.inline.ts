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

  // Browse All Files - open search
  browseAllBtn?.addEventListener("click", () => {
    triggerSearch()
  })

  // Full Search - open search
  searchBtn?.addEventListener("click", () => {
    triggerSearch()
  })

  // View all meetings link - also opens search
  browseAllLink?.addEventListener("click", (e) => {
    e.preventDefault()
    triggerSearch()
  })
})
