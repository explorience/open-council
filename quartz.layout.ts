import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: {}
  })
}

// Explorer configuration for browse all functionality
const explorer = Component.Explorer({
  folderDefaultState: "collapsed",

  // use default sorting, but compare with slugs instead of displayNames and reverse (newest first)
  sortFn: (a, b) => {
    if ((!a.isFolder && !b.isFolder) || (a.isFolder && b.isFolder)) {
      return -a.slug.localeCompare(b.slug, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    }
    return (!a.isFolder && b.isFolder) ? 1 : -1
  },
  mapFn: (node) => {
    if (node.isFolder) return
    // Only process meeting files in months/YYYY-MM folders
    const slugParts = node.slug.split("/")
    if (slugParts[0] !== "months") return
    const monthFolder = slugParts[1]
    if (!monthFolder || !/^\d{4}-\d{2}$/.test(monthFolder)) return
    if (!slugParts[2] || slugParts[2].length < 10) return

    const dateStr = slugParts[2].slice(0, "YYYY-MM-DD".length)
    const fmtOptions = {
      year: "numeric" as const,
      month: "short" as const,
      day: "numeric" as const
    }
    const date = new Date(dateStr.replace(/-/g, "/")).toLocaleDateString("en-CA", fmtOptions)
    node.displayName = `${node.displayName} (${date})`
  }
})

// Search and explorer for non-homepage pages
const searchAndExplorer = Component.Flex({
  direction: "column",
  components: [
    {
      Component: Component.Flex({
        components: [
          { Component: Component.Search() },
          { Component: Component.Darkmode() },
        ],
      })
    },
    { Component: explorer }
  ]
})

// Homepage header with mode toggle (left) and dark mode (right)
const homepageHeader = Component.Flex({
  components: [
    { Component: Component.ModeToggle(), grow: true, justify: "start" },
    { Component: Component.Darkmode(), justify: "end" },
  ]
})

// Recent notes for simple mode on homepage
const recentNotes = Component.RecentNotes({
  title: "Recent Meetings",
  limit: 10,
  showTags: false,
  filter: (f) => {
    // Only show meeting files, not index or generated pages
    return f.slug !== "index" &&
           !f.slug?.startsWith("committees/") &&
           !f.slug?.startsWith("years/") &&
           !f.slug?.startsWith("councillors/")
  }
})

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    // Homepage layout
    Component.ConditionalRender({
      component: homepageHeader,
      condition: (page) => page.fileData.slug === "index",
    }),
    Component.ConditionalRender({
      component: Component.HomepageHero({
        title: "Open Council",
        tagline: "London's council meetings, on the record and searchable",
        chatPlaceholder: "Ask anything about council meetings...",
        apiUrl: "https://open-council-production.up.railway.app"
      }),
      condition: (page) => page.fileData.slug === "index",
    }),
    Component.ConditionalRender({
      component: Component.NavDropdowns(),
      condition: (page) => page.fileData.slug === "index",
    }),
    Component.ConditionalRender({
      component: Component.PrefillQuestions({
        title: "Try asking:",
        questions: [
          "What major decisions did council make this year?",
          "How has the budget changed over time?",
          "What's the most debated topic in recent years?",
          "What zoning changes were approved recently?",
          "How did council vote on transit issues?",
        ]
      }),
      condition: (page) => page.fileData.slug === "index",
    }),

    // Non-homepage: show header and article title
    Component.ConditionalRender({
      component: Component.OpenCouncilHeader(),
      condition: (page) => page.fileData.slug !== "index"
    }),
    Component.ConditionalRender({
      component: Component.ArticleTitle(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    // Councillor page components (self-filter by page type)
    Component.Scorecard(),
    Component.VotingRecord(),
    // Alignment matrix visualization (self-filters by page type)
    Component.AlignmentMatrix(),
    // Councillor rankings chart (self-filters by page type)
    Component.CouncillorRankings(),
    // Topics grid view (for /topics page)
    Component.ConditionalRender({
      component: Component.TopicsView(),
      condition: (page) => page.fileData.slug === "topics" || page.fileData.slug === "topics/index",
    }),
  ],
  afterBody: [
    // Homepage: Recent notes (simple mode) and Dashboard (advanced mode)
    Component.ConditionalRender({
      component: recentNotes,
      condition: (page) => page.fileData.slug === "index",
    }),
    Component.ConditionalRender({
      component: Component.DashboardView(),
      condition: (page) => page.fileData.slug === "index",
    }),
    // Explorer for Browse All button (hidden by default, shown when button clicked)
    Component.ConditionalRender({
      component: explorer,
      condition: (page) => page.fileData.slug === "index",
    }),
    // Hidden search component for homepage (enables Ctrl+K and search buttons)
    Component.ConditionalRender({
      component: Component.Search(),
      condition: (page) => page.fileData.slug === "index",
    }),

    // Full page chat for non-homepage pages (homepage has chat built into HomepageHero)
    Component.ConditionalRender({
      component: Component.FullPageChat({
        title: "Open Council",
        placeholder: "Ask anything about council meetings...",
        apiUrl: "https://open-council-production.up.railway.app"
      }),
      condition: (page) => page.fileData.slug !== "index",
    }),
  ],
  // No sidebars on homepage, sidebars on other pages
  left: [
    Component.ConditionalRender({
      component: Component.TableOfContents(),
      condition: (page) => page.fileData.slug !== "index"
    })
  ],
  right: [
    Component.ConditionalRender({
      component: searchAndExplorer,
      condition: (page) => page.fileData.slug !== "index"
    })
  ],
}

// components for pages that display lists of pages (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.OpenCouncilHeader(), Component.ArticleTitle(), Component.ContentMeta()],
  afterBody: [
    Component.FullPageChat({
      title: "Open Council",
      placeholder: "Ask anything about council meetings...",
      apiUrl: "https://open-council-production.up.railway.app"
    }),
  ],
  left: [],
  right: [searchAndExplorer]
}
