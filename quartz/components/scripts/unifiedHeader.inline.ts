document.addEventListener("nav", () => {
  const header = document.querySelector(".unified-header") as HTMLElement
  const hamburger = document.querySelector(".header-hamburger") as HTMLButtonElement
  const mobileMenu = document.querySelector(".header-mobile-menu") as HTMLElement
  const searchBtn = document.querySelector(".header-search-btn") as HTMLButtonElement
  const chatTriggerMobile = document.querySelector(".chat-trigger-mobile") as HTMLButtonElement
  const browseTriggerMobile = document.querySelector(".browse-trigger-mobile") as HTMLButtonElement

  if (!header) return

  // ============================================
  // Scroll handler for transparent → solid transition
  // ============================================
  const isHomepage = document.body.dataset.slug === "index"
  let ticking = false

  function updateHeaderState() {
    if (isHomepage && window.scrollY < 50) {
      header.classList.remove("scrolled")
    } else {
      header.classList.add("scrolled")
    }
    ticking = false
  }

  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(updateHeaderState)
      ticking = true
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true })
  window.addCleanup(() => window.removeEventListener("scroll", onScroll))

  // Set initial state
  updateHeaderState()

  // ============================================
  // Hamburger menu toggle
  // ============================================
  function closeMobileMenu() {
    hamburger?.setAttribute("aria-expanded", "false")
    mobileMenu?.classList.remove("open")
    hamburger?.classList.remove("active")
  }

  hamburger?.addEventListener("click", () => {
    const expanded = hamburger.getAttribute("aria-expanded") === "true"
    hamburger.setAttribute("aria-expanded", String(!expanded))
    mobileMenu?.classList.toggle("open")
    hamburger.classList.toggle("active")
  })

  // Close mobile menu when clicking outside
  document.addEventListener("click", (e) => {
    if (
      mobileMenu?.classList.contains("open") &&
      !mobileMenu.contains(e.target as Node) &&
      !hamburger?.contains(e.target as Node)
    ) {
      closeMobileMenu()
    }
  })

  // Close mobile menu on escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mobileMenu?.classList.contains("open")) {
      closeMobileMenu()
      hamburger?.focus()
    }
  })

  // ============================================
  // Search button → trigger existing search modal
  // ============================================
  searchBtn?.addEventListener("click", () => {
    const searchContainer = document.querySelector(".search-container") as HTMLElement
    const searchBar = document.querySelector(".search-bar") as HTMLInputElement
    const sidebar = document.querySelector(".sidebar.right") as HTMLElement

    if (searchContainer) {
      // Mimic showSearch behavior from search.inline.ts
      if (sidebar) sidebar.style.zIndex = "1"
      searchContainer.classList.add("active")
      searchBar?.focus()
    }
  })

  // ============================================
  // Mobile menu actions
  // ============================================

  // Chat trigger (mobile menu)
  chatTriggerMobile?.addEventListener("click", () => {
    closeMobileMenu()
    // Find and click the existing chat trigger button
    const existingChatTrigger = document.querySelector(
      ".chat-trigger-btn:not(.chat-trigger-mobile)",
    ) as HTMLButtonElement
    if (existingChatTrigger) {
      existingChatTrigger.click()
    } else {
      // Fallback: directly open the full page chat
      const chat = document.querySelector(".full-page-chat") as HTMLElement
      if (chat) {
        chat.style.display = "flex"
        document.body.style.overflow = "hidden"
        const input = chat.querySelector(".fpc-input") as HTMLInputElement
        input?.focus()
      }
    }
  })

  // Browse trigger (mobile menu)
  browseTriggerMobile?.addEventListener("click", () => {
    closeMobileMenu()
    // Toggle explorer visibility
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

  // Close mobile menu when clicking any link
  const menuLinks = mobileMenu?.querySelectorAll("a")
  menuLinks?.forEach((link) => {
    link.addEventListener("click", closeMobileMenu)
  })
})
