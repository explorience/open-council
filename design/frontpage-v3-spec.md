# Front Page v3 — build spec

Source of truth: `/Users/heenal/tej-workspace/vault/projects/open-council/reskins/reskin-A2-frontpage-v3.html` (approved prototype, read-only — do not re-open it; this spec is self-sufficient).

Standing rules this build must satisfy (Heenal, see task brief):
1. **Enhance, don't replace.** Everything the real site already does on the homepage — primary nav, search, chatbot (`ChatBot.tsx`/`FullPageChat.tsx`), watchlist (`WatchlistPage.tsx`), alerts (`AlertsFeed.tsx`), browse-by-committee/councillor/month (`Explorer.tsx`, `VoteExplorer.tsx`), recent-meetings rail — stays live and reachable. The prototype's masthead nav (`Meetings / Councillors / Committees / Vote Explorer / My Watchlist / Alerts / About`) is the *minimum* link set; real hrefs must route to the existing pages, not `#`.
2. **No generic AI-slop.** The division wall is the signature device — it is not decorative, don't simplify it away.
3. Phone-first, both themes, accessible.
4. Recent Meetings must list real meeting pages. `lib/meetings/filter-real-meetings.js` (`filterRealMeetingFiles`) already exists in this worktree and is already wired into `DashboardView.tsx`'s recent-meetings rail and into `quartz.layout.ts`'s `recentNotes` wrapper — **reuse it**, don't rebuild filtering logic.

## Existing Quartz hooks (repo-verified, use these — don't invent new ones)
- Current homepage component: `quartz/components/DashboardView.tsx` (+ `styles/dashboardView.scss`, `scripts/dashboardView.inline.ts`). It already owns `committees[]` (name/slug/count) and `councillors[]` (name/slug/role) option arrays and a `recentMeetingsLimit`. The v3 stats column and committee grid should source from these, not duplicate them.
- `content/index.md` is the homepage content file (currently just `title: London City Council Meetings` frontmatter).
- Fonts today: `quartz.config.ts` → `theme.fontOrigin: "googleFonts"`, `cdnCaching: true`, `typography: { header: "Plus Jakarta Sans", body: "Plus Jakarta Sans", code: "IBM Plex Mono" }`. IBM Plex Mono is already correct. Header/body must become **Archivo** (variable, `wght` + `wdth` axes — the prototype's `font-stretch: 62% 125%` in its `@font-face` confirms the same variable range Google Fonts serves). **Verify** Quartz's googleFonts loader requests the `wdth` axis in the CSS URL (`family=Archivo:wght,wdth@...`); if it only requests `wght`, `font-variation-settings:'wdth' N` in the CSS below will silently no-op and the condensed broadsheet look will be lost — self-host the variable woff2 (as the prototype does) if so.

## Design tokens (CSS custom properties)

Paper/light (`:root`):
```
--paper:#F4F3EF; --ink:#26251F; --muted:#6E6A60; --line:#D9D6CD; --card:#FCFBF8;
--graphite:#33312D; --graphite-deep:#2B2A27; --graphite-ink:#ECE9E2; --graphite-muted:#B3AEA4; --graphite-line:#4A4740;
--accent:#7D2027; --accent-fill:#9C3038; --accent-ink:#FBF6F1;
--plate:rgba(38,37,31,.16);
--yea:#2E5A3C; --yea-bg:#E7EFE5; --nay:#7D2027; --nay-bg:#F3E4E2; --off:#6E6A60; --off-bg:#ECEAE4;
--ghost:rgba(38,37,31,.14);
--yea-m:#3E8556; --nay-m:#9C3038; --wall-gap:#F4F3EF;
```
Dark (both `@media (prefers-color-scheme:dark)` under `:root:not([data-theme="light"])`, AND `:root[data-theme="dark"]` — must be defined in both places so an explicit toggle overrides OS preference in either direction):
```
--paper:#211F1C; --ink:#E9E6DF; --muted:#A8A399; --line:#3B3934; --card:#2B2A27;
--accent:#D8918B; --accent-fill:#9C3038; --accent-ink:#FBF6F1;
--plate:rgba(0,0,0,.45);
--yea:#94C29F; --yea-bg:#26332B; --nay:#D8918B; --nay-bg:#3B2725; --off:#A39E93; --off-bg:#2E2C28;
--ghost:rgba(233,230,223,.13);
--yea-m:#2FA893; --nay-m:#C96A5E; --wall-gap:#211F1C;
```
Note dark-mode `--yea-m`/`--nay-m` are the deutan-shifted teal/terracotta pair, NOT the same hues as light mode's `--yea-m:#3E8556`/`--nay-m:#9C3038` — this shift is intentional (validated for deuteranopia contrast on dark backgrounds), don't "fix" it to match light mode.

Graphite (`--graphite*`) stays constant across both themes — the masthead and footer are always dark, by design, regardless of page theme.

Theme mechanism: three states — no `data-theme` attr + OS light = light tokens (bare `:root`); no attr + OS dark = dark tokens via the media-query block; explicit `data-theme="light"|"dark"` on `<html>` (or whatever root Quartz uses) wins in both directions. Toggle button (`#themeToggle`) logic:
```js
var cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
root.dataset.theme = (cur === 'dark') ? 'light' : 'dark';
```
Persist the explicit choice (prototype doesn't — it resets on reload; check whether the real site's existing theme toggle already persists, and reuse that mechanism rather than adding a second one).

## Typography scale
- Display/headings: Archivo, weight up to 900, `font-variation-settings:'wdth' N'` where N ranges 76-92 (tighter = bigger: h1 uses 76, section h2 uses 92). Fallback stack: `system-ui, sans-serif`.
- Mono (kickers, labels, stat numbers, nav, footer, tooltip metadata): `'IBM Plex Mono', ui-monospace, monospace`.
- Body: Archivo 400, `font-size:16px; line-height:1.55`.
- `font-variant-numeric: tabular-nums` on every numeric readout (stats, cell counts, dates).

## Masthead
`.masthead` — background `var(--graphite)`, text `var(--graphite-ink)`, **always** graphite regardless of page theme. A `::after` pseudo-element lays a subtle grain texture over the whole header at `opacity:.055` via an inline SVG `feTurbulence` data URI (baseFrequency 0.9, 2 octaves, alpha-only color matrix):
```
url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.6 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")
```
Wordmark: weight 850, `wdth 88`, oxblood underline drawn via `::after` — `position:absolute; left:0; bottom:0; width:58%; height:4px; background:var(--accent-fill)`. Beta pill: mono, bordered, `graphite-line` border. Nav row (`.mast-nav`): horizontally scrollable on overflow (`scrollbar-width:none`), active link gets `aria-current="page"` + oxblood 2px bottom border.

## Hero
`.hero` — 3px solid `--ink` bottom rule (the "broadsheet" edge). Ghost numeral (`.hero .ghost`): giant outline-only numeral, `position:absolute; right:-10px; top:2px`, weight 900, `wdth 78`, `font-size:clamp(120px,24vw,290px)`, `color:transparent`, `-webkit-text-stroke:1.5px var(--ghost)`, `aria-hidden="true"`. **In the prototype this numeral is the total-meetings count (1,752, matching the "Meetings" row in the stats column below) — NOT the divided-vote count (662, which is the wall's own `#wallCount`).** Preserve this exact pairing (ghost = total meetings) unless Heenal says otherwise; it reads as "the whole record" framing the front page, distinct from the wall's own count below it. On viewports <=820px the ghost drops out of absolute position and becomes a static right-aligned block above the h1.

H1: weight 900, `wdth 76`, `font-size:clamp(46px,9.5vw,104px)`, `line-height:.94`, uppercase, `max-width:12ch`. The accent word (`.ox` span) is oxblood-colored and gets an animated underline draw-in (see Load animation below).

## Stats column ("What's on file" + "Ask the record")
Two-column grid (`.paper-cols`, `2.1fr 1fr`, collapses to 1 column <=820px, divider `border-left` on the right column only). Left: `.card.assistant` — the AI-chat entry point (lead sentence, 3 example-question chips that populate the input on click, text input + Ask button, "AI-generated - may be inaccurate" disclaimer). **This must wire to the real chatbot (`ChatBot.tsx`/`FullPageChat.tsx`), not remain decorative.** Right: `.numcol` — a stack of stat rows, first row has a heavier 2px top rule, `.big` values in mono 30px, `.n` secondary values in mono 13px muted. Prototype rows: Meetings / Committees / Councillors (big), then per-committee counts (n) — source these from `DashboardView`'s `committees[]`/`councillors[]` arrays, not hardcoded numbers.

## The division wall
**Container**: `.wall { display:grid; grid-template-columns:repeat(auto-fill, minmax(11px,1fr)); gap:3px; }` — a responsive wrap, no JS layout math, columns-per-row falls out of container width / 11px.

**Cell** (`.wall .c`, one per divided vote, in chronological order): a `<button role="listitem">` (list container has `role="list"`), `height:26px`, `background:var(--wall-gap)` (the gap color = paper, so unfilled cell reads as a thin seam). Two absolutely-positioned inner spans do the split-fill:
- `.y` — `top:0`, background `var(--yea-m)`, rounded top corners, height = `round((yea / (yea+nay)) * 24)` px.
- `.n` — `bottom:0`, background `var(--nay-m)`, rounded bottom corners, height = `(24 - yeaHeight) - 1` px (the -1 leaves a 1px seam between the two fills so the split is always visible even at extreme ratios).
`aria-label` per cell: `"{YYYY-MM-DD}: {title} — {passed ? 'passed' : 'failed'} {yea} to {nay}"`. `:hover`/`:focus-visible` gets a 2px `--ink` outline and `z-index:2`.

**Year chapter breaks**: a full-width (`grid-column:1/-1`) `.yr` row is inserted in-flow immediately before the first cell of each new year (compare `date.slice(0,4)` to the previous record's year while iterating the already-chronologically-sorted array — no separate "is this a chapter start" flag needed in the data). Row: mono, `10px`, letter-spaced, muted, with a `::after` flex-grown 1px rule filling the rest of the row.

**Tooltip** (`#wallTip`, `role="status" aria-live="polite"`, one shared node, not per-cell): `position:fixed`, populated on `mouseenter`/`focus`, cleared on `mouseleave`/`blur`. Content: title (bold), `date - issue display-name` (mono, muted), `Passed/Failed {yea}-{nay}` (mono, bold). Position algorithm — horizontally centered on the cell, clamped to `[8px, innerWidth - tipWidth - 8px]`; vertically prefers *above* the cell (`cellTop - tipHeight - 8`), flips *below* (`cellBottom + 8`) if that would put it above `8px` from viewport top.

**Closest-20 table** (inside a `<details class="closest">`, collapsed by default — "The twenty closest votes, as a table"): rows are the 20 records with the smallest `|yea-nay|` margin, tie-broken by **larger total votes cast first** (`yea+nay` descending — a 7-7 tie ranks as "closer" than a 2-2 tie despite both having margin 0, because more councillors were engaged), then by date ascending, **take top 20**. Verified against the prototype's embedded table: this exact sort key (`margin asc, total desc, date asc`) reproduces its 20 rows precisely, including which 21st near-tie gets dropped. Columns: date (mono), title, `Failed/Passed Y-N` (mono).

**Load animation** (`@media (prefers-reduced-motion: no-preference)` — the *entire* animation ruleset is nested inside this query, so under reduced-motion the cells simply render at `opacity:1` with no animation and no JS dependency — this is the reduced-motion-safe + opacity-backstop design, not a separate code path):
- Cells start `opacity:0`, each fades in via a `cellIn` keyframe (`to{opacity:1}`, `.3s ease-out forwards`), staggered `animation-delay: min(index * 2, 1400)ms` (JS sets this per-cell inline style, and skips setting it at all when `matchMedia('(prefers-reduced-motion:reduce)').matches`).
- A `setTimeout(1900ms)` adds `.done` to `.wall`; CSS rule `.wall.done .c{opacity:1;animation:none}` is the **opacity backstop** — guarantees every cell is fully visible and animation-free 1.9s after load even if a given cell's own animation timing/JS state is off.
- H1/kicker/sub rise in (`riseIn`, staggered `.05/.15/.45s` delays); the `.ox` accent word's underline draws in via a `background-size` keyframe (`underlineIn`, `.6s` duration, `.75s` delay) — same technique as the masthead's static underline but animated.
- Ghost numeral count-up: `requestAnimationFrame` loop, 1100ms, cubic ease-out (`1 - (1-k)^3`), target = total meetings count, formatted `toLocaleString('en-CA')`. Skipped entirely (numeral renders at final value immediately) when reduced-motion is set.

## Data contract — what the build-time generator must emit

One JSON array, embedded as `<script type="application/json" id="wallData">...</script>` (or an equivalent Quartz data-loader — either is fine as long as it's build-time-generated, not client-fetched), **sorted chronologically ascending (oldest first)** — the year-chapter and tooltip-adjacent logic both assume this order and do not re-sort.

Each record is a 6-tuple (not an object — matches the prototype exactly, keeps payload small over 600+ records):
```
[dateYYYYMMDD: string (8-digit, no separators), yea: int, nay: int, passed: 0|1, title: string (<=80 chars, hard-truncated, no ellipsis), issueSlug: string]
```
- `passed` = `1` iff `yea > nay` (a tie always fails — don't take a separate "did it pass" field from source data if it disagrees with this derivation; recompute it).
- `issueSlug` must be one of the known keys so `issueNames` can display-map it: `housing, budget, encampments, transit, climate, downtown, policing, bikes, other` (`other` is the fallback bucket in the display map — the prototype's real data never emits it, but the generator must support any vote that doesn't cleanly classify falling into `other` rather than crashing or being dropped).
- Title truncation: raw meeting-agenda-item title, cut to 80 chars. If the real title source already has a natural truncation/summary field, prefer that; otherwise hard-cut at 80.

**Derive, don't duplicate**: `wallCount` (the divided-vote total shown in `.wall-head .count` and in the `.wall-sub` sentence), the "`N` decided by two votes or fewer" legend line, and the closest-20 rows are all computable from the records array at template-render time. Do not have the generator also write these as separate stored scalars — a second source of truth for a count that's trivially `records.length` (or a margin filter) will drift the moment the underlying vote data is corrected without the scalar being regenerated.

## A11y requirements
- `.skip` links to `#main` and `#ask` (chat entry) before the masthead.
- Wall: `role="list"` / `role="listitem"`, full `aria-label` per cell (see above) since the visual split-fill conveys nothing to a screen reader on its own.
- Tooltip: `aria-live="polite"`, `role="status"`.
- All animation gated behind `@media (prefers-reduced-motion: no-preference)` with the opacity backstop described above — nothing before or after that media query may rely on JS to reach a final visible/legible state.
- Focus-visible outlines on wall cells, nav links, chips, theme button, ask input.
- Contrast: use the validated palette values above as given — don't re-derive or "round" them.

## Prototype elements that must survive into the Quartz build, verbatim in spirit
1. Graphite masthead with grain texture + oxblood wordmark underline, beta pill, scrollable nav with `aria-current`.
2. Hero: ghost outline numeral (total meetings, count-up), condensed giant h1 with oxblood accent word + underline draw-in, subhead.
3. Stats column: chat-entry assistant card (chips + input, wired live) beside the "What's on file" mono stat stack.
4. The division wall in full: split-fill cells, chronological wrap grid, in-flow year chapter breaks, shared fixed tooltip with the above/below flip, the closest-20 `<details>` table with its exact sort key.
5. Staggered cell fade-in capped at 1400ms + 1900ms opacity-backstop done-class + reduced-motion no-op path.
6. Both palettes (light paper / dark) including the light->dark teal-shift on yea/nay wall colors.
7. Recent Meetings rail, Committees grid, and all primary-nav destinations (search, chatbot, watchlist, alerts, browse) — live and real, per standing rule 1.
