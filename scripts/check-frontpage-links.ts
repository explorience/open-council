/**
 * Guard: every internal link the built front page emits must resolve to a
 * real file in ./public, under the SAME cleanUrls rule vercel.json applies
 * (`/foo` is served by `foo.html`). A plain static server 404s on those
 * extensionless URLs, which is a harness artifact - this check resolves
 * them the way production does, so a 404 here is a real broken link.
 *
 * Run (after `npm run build`): npx tsx scripts/check-frontpage-links.ts
 * Exit 0 = every internal href on the homepage resolves.
 */
import { existsSync } from "fs"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const publicDir = path.join(repoRoot, "public")
const homepage = path.join(publicDir, "index.html")

if (!existsSync(homepage)) {
  console.error("FAIL - public/index.html missing; run `npm run build` first.")
  process.exit(1)
}

const html = await fs.readFile(homepage, "utf8")

/** Resolve a URL path the way vercel.json's cleanUrls does. */
function resolves(urlPath: string): boolean {
  const clean = decodeURIComponent(urlPath.split("#")[0].split("?")[0])
  if (clean === "" || clean === "/") return existsSync(homepage)
  const rel = clean.replace(/^\.?\//, "")
  const direct = path.join(publicDir, rel)
  return (
    existsSync(direct + ".html") || // cleanUrls: /foo -> foo.html
    existsSync(path.join(direct, "index.html")) || // /foo -> foo/index.html
    (path.extname(rel) !== "" && existsSync(direct)) // /static/x.css
  )
}

const hrefs = new Set<string>()
for (const m of html.matchAll(/href="([^"]+)"/g)) {
  const href = m[1]
  if (/^(https?:|mailto:|tel:|#|data:)/.test(href)) continue
  hrefs.add(href)
}

const broken = [...hrefs].filter((h) => !resolves(h))

console.log(`checked ${hrefs.size} internal link(s) on the built homepage`)
if (broken.length > 0) {
  console.error(`\nFAIL - ${broken.length} broken link(s):`)
  for (const b of broken.sort()) console.error(`  - ${b}`)
  process.exit(1)
}
console.log("PASS - every internal homepage link resolves under cleanUrls.")
