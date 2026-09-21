import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Quartz 4 Configuration
 *
 * See https://quartz.jzhao.xyz/configuration for more information.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "London City Council",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    analytics: {
      provider: "plausible",
    },
    locale: "en-US",
    baseUrl: "opencouncil.xyz",
    ignorePatterns: ["private", "templates", ".obsidian"],
    defaultDateType: "modified",
    theme: {
      // Front Page v3: Archivo (header + body), IBM Plex Mono unchanged
      // (code, plus the "mono" role frontpage.scss uses for kickers,
      // stats, nav, and every tabular-nums numeral). Quartz's googleFonts
      // loader only ever requests a wght axis (see util/theme.ts
      // formatFontSpecification) -- it cannot deliver Archivo's wdth
      // (width) axis as a true continuous range, only chunked static
      // width instances that font-variation-settings can't interpolate.
      // The condensed broadsheet look (h1, masthead wordmark, ghost
      // numeral, section kickers) therefore self-hosts the real variable
      // Archivo[wdth,wght].ttf (converted to woff2) at
      // quartz/static/fonts/Archivo-Variable.woff2, under its own family
      // name 'Archivo Variable' declared in frontpage.scss -- see that
      // file's @font-face comment. This googleFonts Archivo (fixed wdth
      // 100) stays the everyday header/body face used everywhere else on
      // the site (tables, prose, chat UI) via the normal --headerFont/
      // --bodyFont mechanism; nothing here changes for existing pages
      // beyond the typeface itself.
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Archivo",
        body: "Archivo",
        code: "IBM Plex Mono",
      },
      // Front Page v3 validated palette (design/frontpage-v3-spec.md
      // "Design tokens"). Quartz's 9-field ColorScheme drives the whole
      // site's base styling (base.scss) — mapped here so every existing
      // page (tables, sidebars, search, chat) inherits the Front Page
      // look and stays readable, not just the homepage. The wall's own
      // yea/nay split-fill colors and the always-graphite masthead are
      // NOT part of this scheme (they don't vary with page content
      // color) — those live as their own --yea-m/--nay-m/--graphite*
      // custom properties in frontpage.scss, per the spec.
      colors: {
        lightMode: {
          light: "#F4F3EF", // --paper
          lightgray: "#D9D6CD", // --line
          gray: "#6E6A60", // --muted
          darkgray: "#26251F", // --ink
          dark: "#26251F", // --ink
          secondary: "#7D2027", // --accent
          tertiary: "#9C3038", // --accent-fill
          highlight: "rgba(38, 37, 31, 0.06)",
          textHighlight: "#fff23688",
        },
        darkMode: {
          light: "#211F1C", // --paper
          lightgray: "#3B3934", // --line
          gray: "#A8A399", // --muted
          darkgray: "#E9E6DF", // --ink
          dark: "#E9E6DF", // --ink
          secondary: "#D8918B", // --accent (deutan-shifted)
          tertiary: "#9C3038", // --accent-fill
          highlight: "rgba(216, 145, 139, 0.1)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "filesystem"],  // removed "git" - too slow with 1700+ files
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description()
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
      // Comment out CustomOgImages to speed up build time
      // Plugin.CustomOgImages(),
    ],
  },
}

export default config
