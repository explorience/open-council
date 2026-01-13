// Scorecard click handlers for comparison charts (Issue #128)

function setupScorecardClickHandlers() {
  const scorecard = document.querySelector(".scorecard") as HTMLElement | null
  if (!scorecard) return

  const councillorSlug = scorecard.dataset.councillorSlug || ""
  const metricCards = scorecard.querySelectorAll(".scorecard-metric.clickable")

  metricCards.forEach((card) => {
    const metric = (card as HTMLElement).dataset.metric

    const handleClick = () => {
      if (!metric) return

      // Dispatch custom event for the comparison modal to listen to
      const event = new CustomEvent("openComparisonChart", {
        detail: {
          metric: metric,
          councillorSlug: councillorSlug,
        },
        bubbles: true,
      })
      document.dispatchEvent(event)
    }

    // Handle click events
    card.addEventListener("click", handleClick)

    // Handle keyboard events for accessibility
    card.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
        e.preventDefault()
        handleClick()
      }
    })

    // Cleanup handlers on navigation
    window.addCleanup(() => {
      card.removeEventListener("click", handleClick)
    })
  })
}

document.addEventListener("nav", () => {
  setupScorecardClickHandlers()
})
