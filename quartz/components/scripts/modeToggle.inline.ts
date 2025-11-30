// Mode toggle - switch between simple and advanced views

const STORAGE_KEY = "open-council-view-mode"

function getStoredMode(): "simple" | "advanced" {
  if (typeof localStorage === "undefined") return "simple"
  return (localStorage.getItem(STORAGE_KEY) as "simple" | "advanced") || "simple"
}

function setStoredMode(mode: "simple" | "advanced") {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(STORAGE_KEY, mode)
}

function applyMode(mode: "simple" | "advanced") {
  const body = document.body
  const toggleBtn = document.querySelector(".mode-toggle-btn") as HTMLButtonElement

  if (mode === "advanced") {
    body.classList.add("advanced-mode")
    body.classList.remove("simple-mode")
    toggleBtn?.setAttribute("aria-pressed", "true")
    toggleBtn?.setAttribute("title", "Switch to simple view")
  } else {
    body.classList.add("simple-mode")
    body.classList.remove("advanced-mode")
    toggleBtn?.setAttribute("aria-pressed", "false")
    toggleBtn?.setAttribute("title", "Switch to advanced view")
  }
}

document.addEventListener("nav", () => {
  const toggleBtn = document.querySelector(".mode-toggle-btn") as HTMLButtonElement
  if (!toggleBtn) return

  // Apply stored mode on load
  const storedMode = getStoredMode()
  applyMode(storedMode)

  // Handle toggle click
  toggleBtn.addEventListener("click", () => {
    const currentMode = getStoredMode()
    const newMode = currentMode === "simple" ? "advanced" : "simple"
    setStoredMode(newMode)
    applyMode(newMode)
  })
})

// Apply mode immediately on page load (before nav event)
// This prevents flash of wrong mode
;(function () {
  const storedMode = getStoredMode()
  if (storedMode === "advanced") {
    document.documentElement.classList.add("advanced-mode")
  } else {
    document.documentElement.classList.add("simple-mode")
  }
})()
