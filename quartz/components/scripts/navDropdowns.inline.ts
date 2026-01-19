// Navigation dropdowns functionality

document.addEventListener("nav", () => {
  const navDropdowns = document.querySelector(".nav-dropdowns") as HTMLElement
  if (!navDropdowns) return

  const hamburgerBtn = navDropdowns.querySelector(".nav-hamburger") as HTMLButtonElement
  const navItems = navDropdowns.querySelector(".nav-items") as HTMLElement
  const dropdowns = navDropdowns.querySelectorAll(".nav-dropdown")
  const recentMeetingsBtn = navDropdowns.querySelector(".nav-recent-meetings") as HTMLButtonElement
  const suggestedQuestionsBtn = navDropdowns.querySelector(".nav-suggested-questions") as HTMLButtonElement

  // Handle hamburger menu toggle on mobile
  hamburgerBtn?.addEventListener("click", () => {
    const isExpanded = hamburgerBtn.getAttribute("aria-expanded") === "true"
    hamburgerBtn.setAttribute("aria-expanded", isExpanded ? "false" : "true")
    navItems?.classList.toggle("expanded", !isExpanded)
  })

  // Handle dropdown toggles with arrow key navigation
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

      // Focus first menu item when opening
      if (!isOpen && menu) {
        const firstItem = menu.querySelector(".nav-dropdown-item") as HTMLElement
        setTimeout(() => firstItem?.focus(), 10)
      }
    })

    // Arrow key navigation for dropdown trigger
    trigger?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        if (e.key === "ArrowDown") e.preventDefault()
        const isOpen = trigger.getAttribute("aria-expanded") === "true"

        if (!isOpen) {
          // Close all other dropdowns
          dropdowns.forEach((d) => {
            const t = d.querySelector(".nav-dropdown-trigger") as HTMLButtonElement
            t?.setAttribute("aria-expanded", "false")
          })
          trigger.setAttribute("aria-expanded", "true")
        }

        if (menu) {
          const firstItem = menu.querySelector(".nav-dropdown-item") as HTMLElement
          setTimeout(() => firstItem?.focus(), 10)
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        const isOpen = trigger.getAttribute("aria-expanded") === "true"

        if (isOpen && menu) {
          const items = menu.querySelectorAll(".nav-dropdown-item")
          const lastItem = items[items.length - 1] as HTMLElement
          lastItem?.focus()
        }
      }
    })

    // Arrow key navigation within the menu
    menu?.addEventListener("keydown", (e) => {
      const items = Array.from(menu.querySelectorAll(".nav-dropdown-item")) as HTMLElement[]
      const currentIndex = items.indexOf(document.activeElement as HTMLElement)

      if (e.key === "ArrowDown") {
        e.preventDefault()
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0
        items[nextIndex]?.focus()
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        if (currentIndex <= 0) {
          // Move focus back to trigger
          trigger?.focus()
        } else {
          items[currentIndex - 1]?.focus()
        }
      } else if (e.key === "Home") {
        e.preventDefault()
        items[0]?.focus()
      } else if (e.key === "End") {
        e.preventDefault()
        items[items.length - 1]?.focus()
      } else if (e.key === "Escape") {
        trigger?.setAttribute("aria-expanded", "false")
        trigger?.focus()
      }
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

  // Recent Meetings - toggle recent notes section
  recentMeetingsBtn?.addEventListener("click", () => {
    const recentNotes = document.querySelector(".recent-notes") as HTMLElement
    if (recentNotes) {
      const isExpanded = recentMeetingsBtn.getAttribute("aria-expanded") === "true"
      recentMeetingsBtn.setAttribute("aria-expanded", isExpanded ? "false" : "true")
      recentNotes.classList.toggle("expanded", !isExpanded)

      if (!isExpanded) {
        // Scroll to recent notes when expanding
        setTimeout(() => {
          recentNotes.scrollIntoView({ behavior: "smooth", block: "start" })
        }, 100)
      }
    }
  })

  // Suggested Questions - toggle prefill questions section
  suggestedQuestionsBtn?.addEventListener("click", () => {
    const prefillQuestions = document.querySelector(".prefill-questions") as HTMLElement
    if (prefillQuestions) {
      const isExpanded = suggestedQuestionsBtn.getAttribute("aria-expanded") === "true"
      suggestedQuestionsBtn.setAttribute("aria-expanded", isExpanded ? "false" : "true")
      prefillQuestions.classList.toggle("expanded", !isExpanded)
    }
  })
})
