import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: {
      GitHub: "https://github.com/explorience/open-council",
    },
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.ConditionalRender({
      component: Component.OpenCouncilHeader(),
      condition: (page) => page.fileData.slug === "index",
    }),
    Component.ConditionalRender({
      component: Component.ArticleTitle(),
      condition: (page) => page.fileData.slug !== "index",
    })
  ],
  afterBody: [
    Component.ConditionalRender({
      component: Component.Explorer({
        folderDefaultState: "collapsed",

        // use default sorting, but compare with slugs instead of displayNames and reverse (newest first)
        sortFn: (a, b) => {
          if ((!a.isFolder && !b.isFolder) || (a.isFolder && b.isFolder)) {
            // numeric: true: Whether numeric collation should be used, such that "1" < "2" < "10"
            // sensitivity: "base": Only strings that differ in base letters compare as unequal. Examples: a ≠ b, a = á, a = A
            return -a.slug.localeCompare(b.slug, undefined, {
              numeric: true,
              sensitivity: "base",
            })
          }

          return (!a.isFolder && b.isFolder) ? 1 : -1
        },
        mapFn: (node) => {
          if (node.isFolder) return

          const dateStr = node.slugSegments[1].slice(0, "YYYY-MM-DD".length)
          const fmtOptions = {
            year: "numeric",
            month: "short",
            day: "numeric"
          }
          // switch `-` to `/` to force it to parse in the current time zone
          const date = new Date(dateStr.replace("-", "/")).toLocaleDateString("en-CA", fmtOptions)
          node.displayName = `${node.displayName} (${date})`
        }
      }),
      condition: (page) => page.fileData.slug === "index",
    }),
  ],
  left: [
    Component.ConditionalRender({
      component: Component.OpenCouncilHeader(),
      condition: (page) => page.fileData.slug !== "index"
    }),
    Component.ConditionalRender({
      component: Component.ArticleTitle(),
      condition: (page) => page.fileData.slug !== "index"
    }),
    Component.TableOfContents()
  ],
  right: [],
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.ArticleTitle(), Component.ContentMeta()],
  left: [
    Component.OpenCouncilHeader(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
      ],
    }),
    Component.Explorer()
  ],
  right: [],
}
