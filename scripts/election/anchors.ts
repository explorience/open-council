/**
 * Election Hub — evidence link anchors
 *
 * Quartz assigns heading ids the same way its own TOC transformer does:
 * parse the heading's markdown to plain text (mdast-util-to-string, which
 * decodes HTML entities like &nbsp; and drops link URLs but keeps link
 * text) and run it through github-slugger, per-page, in document order
 * (so repeated headings get -1/-2 suffixes). See quartz/plugins/transformers/toc.ts.
 *
 * This module replicates that exactly against the real meeting markdown
 * files so evidence links land on the right item heading, instead of
 * guessing at Quartz's slug algorithm from memory.
 */

import fs from "fs"
import path from "path"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { toString as mdastToString } from "mdast-util-to-string"
import GithubSlugger from "github-slugger"
import type { Root, Heading } from "mdast"

const CONTENT_DIR = path.join(process.cwd(), "content")
const parser = unified().use(remarkParse)

// meetingSlug -> item number (leading digits+dots on the heading, e.g.
// "8.1.11") -> anchor slug, or null if no markdown file was found.
const fileAnchorCache = new Map<string, Map<string, string> | null>()

function findMarkdownFile(meetingSlug: string): string | null {
  const direct = path.join(CONTENT_DIR, `${meetingSlug}.md`)
  if (fs.existsSync(direct)) return direct

  const dir = path.dirname(direct)
  const base = path.basename(meetingSlug)
  const dateMatch = base.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!dateMatch || !fs.existsSync(dir)) return null

  const candidates = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f.startsWith(dateMatch[1]))
  if (candidates.length === 1) return path.join(dir, candidates[0])

  const exact = `${base}.md`
  if (candidates.includes(exact)) return path.join(dir, exact)

  return null
}

/** Item-number label leading a heading, e.g. "8.1.11" from
 * "### 8.1.11&nbsp;&nbsp;&nbsp;[(2.7)](...) Award of ...". Trailing "." stripped. */
function extractItemNumber(headingText: string): string | null {
  const m = headingText.match(/^(\d+(?:\.\d+)*)\.?(?:\s|$)/)
  return m ? m[1] : null
}

function buildAnchorIndex(mdPath: string): Map<string, string> {
  const raw = fs.readFileSync(mdPath, "utf-8")
  const lines = raw.split("\n")
  const slugger = new GithubSlugger()
  const index = new Map<string, string>()

  for (const line of lines) {
    if (!/^#{1,6}\s/.test(line)) continue
    const tree = parser.parse(line) as Root
    const headingNode = tree.children.find((c): c is Heading => c.type === "heading")
    if (!headingNode) continue
    const text = mdastToString(headingNode)
    const slug = slugger.slug(text)
    const itemNumber = extractItemNumber(text)
    if (itemNumber && !index.has(itemNumber)) {
      index.set(itemNumber, slug)
    }
  }

  return index
}

/**
 * Best-effort evidence link for a motion: `/<meetingSlug>#<anchor>` or null
 * if the source file couldn't be located or no heading matched the item
 * number. Multiple motion parts under the same item (a, b, c...) share one
 * heading and therefore one anchor — that's how the source pages are laid
 * out, so a reader lands on the item and reads down to their part.
 */
export function motionAnchor(meetingSlug: string, itemNumber: string): string | null {
  let index = fileAnchorCache.get(meetingSlug)
  if (index === undefined) {
    const mdPath = findMarkdownFile(meetingSlug)
    index = mdPath ? buildAnchorIndex(mdPath) : null
    fileAnchorCache.set(meetingSlug, index)
  }
  if (!index) return null

  const slug = index.get(itemNumber)
  if (!slug) return null

  return `/${meetingSlug}#${slug}`
}
