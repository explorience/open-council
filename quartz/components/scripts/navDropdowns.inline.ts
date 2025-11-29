// Navigation dropdowns functionality

document.addEventListener("nav", () => {
  const navDropdowns = document.querySelector(".nav-dropdowns") as HTMLElement
  if (!navDropdowns) return

  const dropdowns = navDropdowns.querySelectorAll(".nav-dropdown")
  const browseAllBtn = navDropdowns.querySelector(".nav-browse-all") as HTMLButtonElement
  const searchTrigger = navDropdowns.querySelector(".nav-search-trigger") as HTMLButtonElement

  // Handle dropdown toggles
  dropdowns.forEach((dropdown) => {
    const trigger = dropdown.querySelector(".nav-dropdown-trigger") as HTMLButtonElement
    const menu = dropdown.querySelector(".nav-dropdown-menu") as HTMLElement

    trigger?.addEventListener("click", (e) => {
      e.stopPropagation()
      const isOpen = trigger.getAttribute("aria-expanded") === "true"

      // Close all other dropdowns
      dropdowns.forEach((d) => {
        const t = d.querySelector(".nav-dropdown-trigger") as HTMLButtonElement
        t?.setAttribute("aria-expanded", "false")
      })

      // Toggle this dropdown
      trigger.setAttribute("aria-expanded", isOpen ? "false" : "true")
    })
  })

  // Close dropdowns when clicking outside
  document.addEventListener("click", () => {
    dropdowns.forEach((dropdown) => {
      const trigger = dropdown.querySelector(".nav-dropdown-trigger") as HTMLButtonElement
      trigger?.setAttribute("aria-expanded", "false")
    })
  })

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dropdowns.forEach((dropdown) => {
        const trigger = dropdown.querySelector(".nav-dropdown-trigger") as HTMLButtonElement
        trigger?.setAttribute("aria-expanded", "false")
      })
    }
  })

  // Browse All - toggle explorer
  browseAllBtn?.addEventListener("click", () => {
    const explorer = document.querySelector(".explorer") as HTMLElement
    if (explorer) {
      // Show/expand the explorer
      const explorerUl = explorer.querySelector("#explorer-ul") as HTMLElement
      const button = explorer.querySelector("#explorer") as HTMLButtonElement

      if (explorerUl && button) {
        // If explorer is hidden, show it
        if (explorerUl.classList.contains("collapsed")) {
          button.click()
        }
        // Scroll to explorer
        explorer.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    }
  })

  // Search trigger - open Quartz search
  searchTrigger?.addEventListener("click", () => {
    const searchButton = document.querySelector(".search-button") as HTMLButtonElement
    searchButton?.click()
  })
})
