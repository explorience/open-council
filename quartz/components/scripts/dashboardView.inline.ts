// Dashboard view button handlers

document.addEventListener("nav", () => {
  const dashboardView = document.querySelector(".dashboard-view") as HTMLElement
  if (!dashboardView) return

  const browseAllBtn = dashboardView.querySelector(".browse-all-btn") as HTMLButtonElement
  const searchBtn = dashboardView.querySelector(".search-btn") as HTMLButtonElement
  const browseAllLink = dashboardView.querySelector(".browse-all-link") as HTMLAnchorElement

  // Browse All Files - open Quartz search with empty query to browse
  browseAllBtn?.addEventListener("click", () => {
    const searchButton = document.querySelector(".search-button") as HTMLButtonElement
    searchButton?.click()
  })

  // Full Search - open Quartz search
  searchBtn?.addEventListener("click", () => {
    const searchButton = document.querySelector(".search-button") as HTMLButtonElement
    searchButton?.click()
  })

  // View all meetings link - also opens search
  browseAllLink?.addEventListener("click", (e) => {
    e.preventDefault()
    const searchButton = document.querySelector(".search-button") as HTMLButtonElement
    searchButton?.click()
  })
})
