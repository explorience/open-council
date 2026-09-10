// Front Page v3 — The Division Wall
//
// Builds the wall's cells + in-flow year chapter breaks from the compact
// tuple payload embedded at build time (#wallData — see
// scripts/generate-frontpage-data.ts), wires the shared fixed tooltip via
// two delegated listener pairs on the wall container (never one listener
// per cell — the wall can hold up to ~2,000 cells), drives the ghost
// numeral's reduced-motion-aware count-up, and forwards the "ask the
// record" card's chips/input into the real chat already on the page
// (HomepageHero's #hero-chat-input / .chat-send-btn) rather than
// building a second chat client.

type WallRecord = [
  date: string,
  yea: number,
  nay: number,
  passed: 0 | 1,
  title: string,
  issue: string,
  url: string,
]

const ISSUE_NAMES: Record<string, string> = {
  housing: "Housing",
  budget: "Budget",
  encampments: "Homelessness & Encampments",
  transit: "Transit",
  climate: "Climate",
  downtown: "Downtown",
  policing: "Policing",
  bikes: "Bike Infrastructure",
  other: "Other",
}

function formatDate(yyyymmdd: string): string {
  const y = yyyymmdd.slice(0, 4)
  const m = yyyymmdd.slice(4, 6)
  const d = yyyymmdd.slice(6, 8)
  const date = new Date(`${y}-${m}-${d}T00:00:00`)
  return date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })
}

function buildWall(section: HTMLElement) {
  const wall = section.querySelector("#fpWall") as HTMLElement | null
  const dataEl = section.querySelector("#wallData") as HTMLScriptElement | null
  if (!wall || !dataEl || wall.dataset.built === "true") return
  wall.dataset.built = "true"

  let records: WallRecord[] = []
  try {
    records = JSON.parse(dataEl.textContent || "[]") as WallRecord[]
  } catch {
    return
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const frag = document.createDocumentFragment()
  let lastYear = ""

  records.forEach((r, i) => {
    const [date, yea, nay, passed, title, issue, url] = r
    const year = date.slice(0, 4)
    if (year !== lastYear) {
      const yr = document.createElement("div")
      yr.className = "yr"
      yr.setAttribute("role", "presentation")
      yr.textContent = year
      frag.appendChild(yr)
      lastYear = year
    }

    const total = yea + nay
    const yeaH = total > 0 ? Math.round((yea / total) * 24) : 12
    const nayH = Math.max(0, 24 - yeaH - 1)

    const cell = document.createElement("a")
    cell.href = url
    cell.className = "c"
    cell.setAttribute("role", "listitem")
    cell.setAttribute(
      "aria-label",
      `${year}-${date.slice(4, 6)}-${date.slice(6, 8)}: ${title}, ` +
        `${passed ? "passed" : "failed"} ${yea} to ${nay}`,
    )
    cell.dataset.date = date
    cell.dataset.yea = String(yea)
    cell.dataset.nay = String(nay)
    cell.dataset.passed = String(passed)
    cell.dataset.title = title
    cell.dataset.issue = issue

    // Staggered fade-in delay, capped at 1400ms — the whole animation
    // this feeds is nested under @media(prefers-reduced-motion:
    // no-preference) in frontpageWall.scss, so setting it under reduced
    // motion would be inert anyway; skipped regardless, per spec.
    if (!reducedMotion) {
      cell.style.animationDelay = `${Math.min(i * 2, 1400)}ms`
    }

    const y = document.createElement("span")
    y.className = "y"
    y.style.height = `${yeaH}px`
    const n = document.createElement("span")
    n.className = "n"
    n.style.height = `${nayH}px`
    cell.appendChild(y)
    cell.appendChild(n)

    frag.appendChild(cell)
  })

  wall.appendChild(frag)

  // Opacity backstop: every cell is guaranteed fully visible and
  // animation-free 1.9s after the wall is built, independent of any
  // individual cell's own animation/JS state.
  setTimeout(() => wall.classList.add("done"), 1900)
}

function wireTooltip(section: HTMLElement) {
  const wall = section.querySelector("#fpWall") as HTMLElement | null
  const tipEl = section.querySelector("#wallTip") as HTMLElement | null
  if (!wall || !tipEl || wall.dataset.tipWired === "true") return
  wall.dataset.tipWired = "true"
  // Re-bound to a non-nullable const so the closures below (defined once,
  // called many times per hover/focus) don't need a null check on every
  // access — TS narrows a nullable variable at the guard above, but that
  // narrowing doesn't carry into functions declared afterward.
  const tip: HTMLElement = tipEl

  function show(cell: HTMLElement) {
    const { date, title, issue, passed, yea, nay } = cell.dataset
    if (!date) return
    tip.innerHTML = ""

    const titleEl = document.createElement("div")
    titleEl.className = "wall-tip-title"
    titleEl.textContent = title || ""

    const metaEl = document.createElement("div")
    metaEl.className = "wall-tip-meta fp-mono"
    const issueLabel = ISSUE_NAMES[issue || "other"] ?? ISSUE_NAMES.other
    metaEl.textContent = `${formatDate(date)}, ${issueLabel}`

    const resultEl = document.createElement("div")
    resultEl.className = "wall-tip-result fp-mono"
    resultEl.textContent = `${passed === "1" ? "Passed" : "Failed"} ${yea}-${nay}`

    tip.appendChild(titleEl)
    tip.appendChild(metaEl)
    tip.appendChild(resultEl)
    tip.hidden = false

    const cellRect = cell.getBoundingClientRect()
    const tipRect = tip.getBoundingClientRect()
    let left = cellRect.left + cellRect.width / 2 - tipRect.width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8))
    let top = cellRect.top - tipRect.height - 8
    if (top < 8) top = cellRect.bottom + 8
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
  }

  function hide() {
    tip.hidden = true
  }

  function cellFrom(e: Event): HTMLElement | null {
    return (e.target as HTMLElement).closest(".c") as HTMLElement | null
  }

  wall.addEventListener("mouseover", (e) => {
    const cell = cellFrom(e)
    if (cell) show(cell)
  })
  wall.addEventListener("mouseout", (e) => {
    const related = (e as MouseEvent).relatedTarget as Node | null
    if (!related || !wall.contains(related)) hide()
  })
  wall.addEventListener("focusin", (e) => {
    const cell = cellFrom(e)
    if (cell) show(cell)
  })
  wall.addEventListener("focusout", (e) => {
    const related = (e as FocusEvent).relatedTarget as Node | null
    if (!related || !wall.contains(related)) hide()
  })
}

function wireGhostCountUp(section: HTMLElement) {
  const ghostEl = section.querySelector(".fp-ghost") as HTMLElement | null
  if (!ghostEl || ghostEl.dataset.counted === "true") return
  ghostEl.dataset.counted = "true"
  const ghost: HTMLElement = ghostEl

  const target = Number(ghost.dataset.target || "0")
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (reducedMotion || !target) {
    ghost.textContent = target.toLocaleString("en-CA")
    return
  }

  const duration = 1100
  const start = performance.now()
  function tick(now: number) {
    const elapsed = now - start
    const k = Math.min(1, elapsed / duration)
    const eased = 1 - Math.pow(1 - k, 3)
    ghost.textContent = Math.round(target * eased).toLocaleString("en-CA")
    if (k < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// Forwards into the real chat already on the page (HomepageHero) instead
// of building a second chat client — same mechanism PrefillQuestions
// uses, corrected to the chat's actual selectors (id="hero-chat-input"
// with class "chat-input", not a class named "hero-chat-input").
function wireAssistant(section: HTMLElement) {
  const card = section.querySelector(".fp-assistant") as HTMLElement | null
  if (!card || card.dataset.wired === "true") return
  card.dataset.wired = "true"

  function ask(question: string) {
    if (!question) return
    const heroInput = document.querySelector("#hero-chat-input") as HTMLTextAreaElement | null
    const heroSend = document.querySelector(".chat-send-btn") as HTMLButtonElement | null
    if (!heroInput || !heroSend) return
    heroInput.value = question
    heroInput.dispatchEvent(new Event("input", { bubbles: true }))
    heroSend.click()
    heroInput.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  card.querySelectorAll(".fp-assistant-chip").forEach((chip) => {
    chip.addEventListener("click", () => ask((chip as HTMLElement).dataset.question || ""))
  })

  const input = card.querySelector(".fp-assistant-input") as HTMLInputElement | null
  const send = card.querySelector(".fp-assistant-send") as HTMLButtonElement | null
  send?.addEventListener("click", () => ask(input?.value.trim() || ""))
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      ask(input.value.trim())
    }
  })
}

document.addEventListener("nav", () => {
  const section = document.querySelector(".fp-wall-section") as HTMLElement | null
  if (!section) return
  buildWall(section)
  wireTooltip(section)
  wireGhostCountUp(section)
  wireAssistant(section)
})
