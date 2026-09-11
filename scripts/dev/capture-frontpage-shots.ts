#!/usr/bin/env -S npx tsx
// Repeatable evidence-capture harness for the Front Page v3 close-out.
//
// Serves ./public with cleanUrls honoured (extensionless request -> .html
// file, matching vercel.json), drives a real headless Chrome tab over raw
// CDP with Emulation.setDeviceMetricsOverride (so narrow viewports are a
// TRUE device width, not the ~500px floor --window-size hits under
// --headless=new --screenshot), sets [saved-theme] explicitly per shot,
// and for every wall shot polls in-page until #fpWall has the "done"
// class AND the last .yr year-chapter has at least one painted .c cell
// after it - only then does it save a PNG.
//
// Resilience: Chrome 152 headless can crash under memory pressure from
// repeated tall full-page screenshots (observed empirically on this
// machine). Every CDP call is timeout-guarded so a dead browser fails
// LOUDLY within seconds instead of hanging the run forever, each shot
// runs in its own fresh tab, and a crashed browser is detected and
// relaunched automatically with the failing shot retried once.
//
// Usage: npx tsx scripts/dev/capture-frontpage-shots.ts
// Output: PNGs written to OUT_DIR (see below).

import { spawn, ChildProcess } from "node:child_process"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import WebSocket from "ws"

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..")
const PUBLIC_DIR = path.join(ROOT, "public")
const OUT_DIR =
  "/Users/heenal/tej-workspace/vault/projects/open-council/reskins/site-build-v3-shots/final"
const HTTP_PORT = 4173
const CDP_PORT = 9333
const BASE = `http://localhost:${HTTP_PORT}`
const CALL_TIMEOUT_MS = 25000

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

// ---------------------------------------------------------------------
// Static server honouring vercel.json's cleanUrls: /foo -> foo.html
// ---------------------------------------------------------------------
function mime(p: string): string {
  const ext = path.extname(p).toLowerCase()
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".xml": "application/xml; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".webmanifest": "application/manifest+json",
    } as Record<string, string>
  )[ext] || "application/octet-stream"
}

async function serveFile(p: string, res: any): Promise<boolean> {
  if (!existsSync(p)) return false
  const buf = await readFile(p)
  res.writeHead(200, { "Content-Type": mime(p) })
  res.end(buf)
  return true
}

function startServer(): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0])
      if (urlPath === "/") urlPath = "/index.html"
      const direct = path.join(PUBLIC_DIR, urlPath)

      // 1. exact file (has its own extension, e.g. /static/foo.css)
      if (path.extname(urlPath) && (await serveFile(direct, res))) return
      // 2. cleanUrls: /foo -> foo.html
      if (await serveFile(direct + ".html", res)) return
      // 3. /foo/ or /foo -> foo/index.html
      if (await serveFile(path.join(direct, "index.html"), res)) return
      // 4. exact file with no extension in urlPath but exists as-is
      if (await serveFile(direct, res)) return

      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("404 " + urlPath)
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
  return new Promise((resolve) => {
    server.listen(HTTP_PORT, () => resolve(server))
  })
}

// ---------------------------------------------------------------------
// Minimal CDP client over the ws package, with a hard per-call timeout
// and immediate rejection of all pending calls if the socket dies.
// ---------------------------------------------------------------------
class CDP {
  ws: WebSocket
  id = 0
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  listeners = new Map<string, ((params: any) => void)[]>()
  dead = false

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl, { maxPayload: 512 * 1024 * 1024 })
  }

  static async connect(wsUrl: string): Promise<CDP> {
    const cdp = new CDP(wsUrl)
    await new Promise<void>((resolve, reject) => {
      cdp.ws.once("open", () => resolve())
      cdp.ws.once("error", reject)
    })
    cdp.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id != null && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id)!
        cdp.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      } else if (msg.method) {
        for (const fn of cdp.listeners.get(msg.method) || []) fn(msg.params)
      }
    })
    const kill = (why: string) => {
      cdp.dead = true
      for (const { reject } of cdp.pending.values()) reject(new Error("CDP socket died: " + why))
      cdp.pending.clear()
    }
    cdp.ws.on("close", () => kill("closed"))
    cdp.ws.on("error", (e) => kill(String(e)))
    return cdp
  }

  send(method: string, params: any = {}): Promise<any> {
    if (this.dead) return Promise.reject(new Error(`CDP already dead, cannot send ${method}`))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP call ${method} timed out after ${CALL_TIMEOUT_MS}ms`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method: string, fn: (params: any) => void) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method)!.push(fn)
  }

  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

async function evalExpr(cdp: CDP, expression: string): Promise<any> {
  const res = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: false,
  })
  if (res.exceptionDetails) {
    throw new Error("Runtime.evaluate threw: " + JSON.stringify(res.exceptionDetails))
  }
  return res.result?.value
}

// ---------------------------------------------------------------------
// Chrome process management (with crash-recovery)
// ---------------------------------------------------------------------
let chromeProc: ChildProcess | null = null

async function killChrome() {
  if (chromeProc) {
    try {
      chromeProc.kill(9)
    } catch {}
    chromeProc = null
  }
  await new Promise((r) => setTimeout(r, 300))
}

async function startChrome(): Promise<void> {
  await killChrome()
  const userDataDir = `/tmp/oc-frontpage-capture-chrome-profile-${Date.now()}`
  chromeProc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--hide-scrollbars",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-sync",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--force-color-profile=srgb",
      "about:blank",
    ],
    { stdio: "ignore" },
  )
  chromeProc.on("exit", (code) => {
    console.log(`[capture] chrome process exited (code=${code})`)
  })
  // wait for the debugger HTTP endpoint to come up
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://localhost:${CDP_PORT}/json/version`)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error("Chrome CDP endpoint never came up")
}

async function newTab(): Promise<CDP> {
  const r = await fetch(`http://localhost:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })
  const target = await r.json()
  const cdp = await CDP.connect(target.webSocketDebuggerUrl)
  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  await cdp.send("DOM.enable")
  // Headless Chrome's page never has real OS/window focus, so
  // document.hasFocus() is false and a programmatic el.focus() moves
  // activeElement WITHOUT dispatching focus/focusin - which is exactly
  // the event frontpageWall.inline.ts's wireTooltip() delegates on to
  // show the tooltip. This CDP-only override makes hasFocus() true and
  // focus events fire for real, matching what a human's tab/click does.
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true })
  return cdp
}

// ---------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------
async function setViewport(cdp: CDP, width: number, height: number) {
  const mobile = width < 600
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  })
  if (mobile) {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
  }
}

async function goto(cdp: CDP, url: string) {
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Page.loadEventFired never fired for ${url}`)), CALL_TIMEOUT_MS)
    cdp.on("Page.loadEventFired", () => {
      clearTimeout(timer)
      resolve()
    })
  })
  await cdp.send("Page.navigate", { url })
  await loaded
  // settle: webfonts / late layout
  await new Promise((r) => setTimeout(r, 300))
}

async function setTheme(cdp: CDP, theme: "light" | "dark") {
  await evalExpr(
    cdp,
    `(function(){
      document.documentElement.setAttribute("saved-theme", ${JSON.stringify(theme)});
      try { localStorage.setItem("saved-theme", ${JSON.stringify(theme)}); } catch(e) {}
      return document.documentElement.getAttribute("saved-theme");
    })()`,
  )
  await new Promise((r) => setTimeout(r, 150))
}

async function waitWallPainted(cdp: CDP, timeoutMs = 20000): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const cellsInLastYear: number = await evalExpr(
      cdp,
      `(function(){
        const wall = document.querySelector("#fpWall");
        if (!wall || !wall.classList.contains("done")) return -1;
        const yrs = wall.querySelectorAll(".yr");
        if (!yrs.length) return -1;
        const lastYr = yrs[yrs.length - 1];
        let n = lastYr.nextElementSibling, count = 0;
        while (n) { if (n.classList.contains("c")) count++; n = n.nextElementSibling; }
        return count;
      })()`,
    )
    if (typeof cellsInLastYear === "number" && cellsInLastYear > 0) return cellsInLastYear
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`wall never finished painting (last-year cell count never > 0) within ${timeoutMs}ms`)
}

async function fullPageScreenshot(cdp: CDP, outPath: string) {
  const metrics = await cdp.send("Page.getLayoutMetrics")
  const cs = metrics.cssContentSize || metrics.contentSize
  const width = Math.ceil(cs.width)
  const height = Math.ceil(cs.height)
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  })
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, Buffer.from(shot.data, "base64"))
  return { width, height }
}

async function viewportScreenshot(cdp: CDP, outPath: string) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, Buffer.from(shot.data, "base64"))
}

// ---------------------------------------------------------------------
// Shot registry — each shot is a self-contained function(cdp) so it can
// run in a fresh tab and be retried after a browser restart.
// ---------------------------------------------------------------------
type ShotResult = { file: string; note: string }
type ShotFn = (cdp: CDP) => Promise<ShotResult>

const shots: { name: string; run: ShotFn }[] = []

function addHomeShot(w: number, theme: "light" | "dark") {
  shots.push({
    name: `home-${w}-${theme}`,
    run: async (cdp) => {
      await setViewport(cdp, w, 900)
      await goto(cdp, `${BASE}/`)
      await setTheme(cdp, theme)
      const cellCount = await waitWallPainted(cdp)
      const file = path.join(OUT_DIR, `home-${w}-${theme}.png`)
      const { width, height } = await fullPageScreenshot(cdp, file)
      return { file, note: `${width}x${height}, last-year cells=${cellCount}` }
    },
  })
}
for (const w of [390, 768, 1240]) {
  for (const theme of ["light", "dark"] as const) addHomeShot(w, theme)
}

shots.push({
  name: "explorer-open-1240-light",
  run: async (cdp) => {
    await setViewport(cdp, 1240, 1000)
    await goto(cdp, `${BASE}/`)
    await setTheme(cdp, "light")
    await waitWallPainted(cdp)
    const clicked = await evalExpr(
      cdp,
      `(function(){
        const btn = document.querySelector(".dashboard-view .browse-all-btn");
        if (!btn) return "no-browse-all-btn";
        btn.click();
        return "clicked";
      })()`,
    )
    await new Promise((r) => setTimeout(r, 500))
    const isVisible = await evalExpr(
      cdp,
      `document.querySelector(".explorer")?.classList.contains("visible") === true`,
    )
    const file = path.join(OUT_DIR, "explorer-open-1240-light.png")
    await fullPageScreenshot(cdp, file)
    return { file, note: `click=${clicked} visible=${isVisible}` }
  },
})

shots.push({
  name: "assistant-answering-1240-light",
  run: async (cdp) => {
    await setViewport(cdp, 1240, 1000)
    await goto(cdp, `${BASE}/`)
    await setTheme(cdp, "light")
    await waitWallPainted(cdp)
    await evalExpr(
      cdp,
      `(function(){
        const input = document.querySelector(".chat-input");
        input.value = "What did council decide about zoning on January 21st?";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()`,
    )
    await evalExpr(cdp, `document.querySelector(".chat-send-btn").click()`)
    const start = Date.now()
    let state = "timeout"
    while (Date.now() - start < 15000) {
      state = await evalExpr(
        cdp,
        `(function(){
          const msgs = document.querySelectorAll(".chat-messages .chat-message");
          const last = msgs[msgs.length - 1];
          if (!last) return "none";
          if (last.classList.contains("loading") || last.querySelector(".loading, .chat-loading")) return "loading";
          if (last.classList.contains("assistant") && !last.classList.contains("loading")) {
            return last.textContent.includes("encountered an error") ? "error" : "answered";
          }
          return "other:" + last.className;
        })()`,
      )
      if (state === "answered" || state === "error") break
      await new Promise((r) => setTimeout(r, 300))
    }
    await new Promise((r) => setTimeout(r, 300))
    const file = path.join(OUT_DIR, "assistant-answering-1240-light.png")
    await fullPageScreenshot(cdp, file)
    return { file, note: `final state=${state}` }
  },
})

shots.push({
  name: "closest20-open-1240-light",
  run: async (cdp) => {
    await setViewport(cdp, 1240, 1000)
    await goto(cdp, `${BASE}/`)
    await setTheme(cdp, "light")
    await waitWallPainted(cdp)
    const opened = await evalExpr(
      cdp,
      `(function(){
        const d = document.querySelector("details.closest");
        if (!d) return "no-details";
        d.open = true;
        d.scrollIntoView({ block: "center" });
        return "opened";
      })()`,
    )
    await new Promise((r) => setTimeout(r, 300))
    const file = path.join(OUT_DIR, "closest20-open-1240-light.png")
    await fullPageScreenshot(cdp, file)
    return { file, note: String(opened) }
  },
})

for (const [w, theme] of [
  [390, "dark"],
  [1240, "light"],
] as const) {
  shots.push({
    name: `tooltip-${w}-${theme}`,
    run: async (cdp) => {
      await setViewport(cdp, w, 1000)
      await goto(cdp, `${BASE}/`)
      await setTheme(cdp, theme)
      await waitWallPainted(cdp)
      // A cell from the middle of the wall (not the very first/last) has
      // headroom on both sides, so the tooltip's above/below flip logic
      // lands it fully inside any reasonable viewport height - picking
      // the first cell instead is an edge case (near the top of the
      // page, so the tip flips "below" the cell, which can land past a
      // short capture viewport - a harness artifact, not a site bug).
      const midSelector = `(function(){
        const cells = document.querySelectorAll("#fpWall .c");
        return cells[Math.floor(cells.length / 2)];
      })()`
      await evalExpr(cdp, `${midSelector}.scrollIntoView({block:"center"})`)
      await new Promise((r) => setTimeout(r, 150))
      await evalExpr(cdp, `${midSelector}.focus()`)
      // Verified real-site behavior, not a harness quirk: the browser's
      // own "keep the newly focused element in view" correction keeps
      // scrolling for a few hundred ms AFTER focusin already fires and
      // wireTooltip's show() has computed+frozen the tip's fixed-position
      // top/left against that pre-settle layout - so a screenshot taken
      // right after focus() can catch the tip stranded far from the cell
      // (measured 300px+ off with a large scroll jump; report separately
      // as a product finding). Wait for scroll to fully settle, then
      // blur/refocus so show() recomputes against the final position.
      let lastY = -1
      for (let i = 0; i < 15; i++) {
        const y = await evalExpr(cdp, `window.scrollY`)
        if (y === lastY) break
        lastY = y
        await new Promise((r) => setTimeout(r, 150))
      }
      await evalExpr(cdp, `${midSelector}.blur()`)
      await evalExpr(cdp, `${midSelector}.focus()`)
      await new Promise((r) => setTimeout(r, 300))
      const tipShown = await evalExpr(cdp, `document.querySelector("#wallTip")?.hidden === false`)
      const tipTop = await evalExpr(
        cdp,
        `parseFloat(document.querySelector("#wallTip").style.top || "-1")`,
      )
      if (!tipShown || !(tipTop >= 0 && tipTop < 1000)) {
        throw new Error(
          `tooltip not usably on-screen for tooltip-${w}-${theme}: shown=${tipShown} top=${tipTop} (viewport height 1000)`,
        )
      }
      const file = path.join(OUT_DIR, `tooltip-${w}-${theme}.png`)
      await viewportScreenshot(cdp, file)
      return { file, note: `tooltip shown=${tipShown}` }
    },
  })
}

for (const [label, slug] of [
  ["meeting", "/months/2013-09/2013-09-17-Council"],
  ["councillor", "/councillors/current/j-morgan"],
] as const) {
  for (const w of [390, 1240]) {
    shots.push({
      name: `${label}-${w}-light-top`,
      run: async (cdp) => {
        await setViewport(cdp, w, 1000)
        await goto(cdp, `${BASE}${slug}`)
        await setTheme(cdp, "light")
        // Verified real-site behavior, not a harness quirk: on every
        // non-homepage page, explorer.inline.ts falls back to
        // `activeElement.scrollIntoView({behavior:"smooth"})` to reveal
        // the current file in the sidebar tree (see its "try to scroll
        // to the active element" branch). That call isn't scoped to the
        // tree's own scroll container, so it drags the WHOLE PAGE with
        // it - landing wherever the tree entry sits in absolute page
        // coordinates (measured: 98%+ down a 64,000px meeting page) -
        // and because base.scss sets `scroll-behavior: smooth`
        // page-wide, it's an ~1.5s animated jump AWAY from the top,
        // unprompted, shortly after every non-homepage load. This is
        // almost certainly why prior capture rounds landed mid-page.
        // Work around it here: wait for that jump to fire and finish,
        // then force back to 0 and wait for THAT animation too.
        let lastY = -1
        for (let i = 0; i < 20; i++) {
          const y = await evalExpr(cdp, `window.scrollY`)
          if (y === lastY) break
          lastY = y
          await new Promise((r) => setTimeout(r, 150))
        }
        await evalExpr(cdp, `window.scrollTo(0,0)`)
        lastY = -1
        for (let i = 0; i < 20; i++) {
          const y = await evalExpr(cdp, `window.scrollY`)
          if (y === lastY && y === 0) break
          lastY = y
          await new Promise((r) => setTimeout(r, 150))
        }
        const finalY = await evalExpr(cdp, `window.scrollY`)
        if (finalY !== 0) {
          throw new Error(`page never settled at scrollY=0 for ${label}-${w}: stuck at ${finalY}`)
        }
        const file = path.join(OUT_DIR, `${label}-${w}-light-top.png`)
        const { width, height } = await fullPageScreenshot(cdp, file)
        return { file, note: `${width}x${height}` }
      },
    })
  }
}

// ---------------------------------------------------------------------
// Main: run each shot in its own fresh tab; on any failure, hard-restart
// Chrome and retry the shot once before giving up on it.
// ---------------------------------------------------------------------
async function main() {
  console.log("[capture] starting static server on", BASE)
  await startServer()

  console.log("[capture] launching headless Chrome...")
  await startChrome()

  const done: string[] = []
  const failed: string[] = []

  for (const shot of shots) {
    let attempt = 0
    let ok = false
    while (attempt < 2 && !ok) {
      attempt++
      try {
        const cdp = await newTab()
        const { file, note } = await shot.run(cdp)
        cdp.close()
        console.log(`[capture] OK  ${shot.name} — ${note}`)
        done.push(file)
        ok = true
      } catch (e) {
        console.error(`[capture] FAIL ${shot.name} (attempt ${attempt}): ${e}`)
        if (attempt < 2) {
          console.log("[capture] restarting Chrome and retrying...")
          await startChrome()
        } else {
          failed.push(shot.name)
        }
      }
    }
  }

  await killChrome()
  console.log(`[capture] done. ${done.length}/${shots.length} shots written to ${OUT_DIR}`)
  for (const f of done) console.log(" -", f)
  if (failed.length) {
    console.error(`[capture] ${failed.length} shot(s) FAILED after retry: ${failed.join(", ")}`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => {
    console.error("[capture] FAILED:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await killChrome()
    process.exit(process.exitCode || 0)
  })
