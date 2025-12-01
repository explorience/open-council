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

  // Browse All Files - toggle explorer visibility
  browseAllBtn?.addEventListener("click", () => {
    const explorer = document.querySelector(".explorer") as HTMLElement
    if (explorer) {
      const isVisible = explorer.classList.contains("visible")
      explorer.classList.toggle("visible", !isVisible)

      if (!isVisible) {
        // Expand the explorer tree
        const explorerUl = explorer.querySelector("#explorer-ul") as HTMLElement
        const button = explorer.querySelector("#explorer") as HTMLButtonElement

        if (explorerUl && button && explorerUl.classList.contains("collapsed")) {
          button.click()
        }

        // Scroll to explorer
        setTimeout(() => {
          explorer.scrollIntoView({ behavior: "smooth", block: "start" })
        }, 100)
      }
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
