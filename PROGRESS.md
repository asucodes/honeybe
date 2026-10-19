# HONEYBEE - Build Progress

> Bug bounty opportunity intelligence for mid-level hunters.
> Three pages: **Home** (what it solves), **Ranked + Catalog** (the index) and **Method and research**.
> Light and dark themes, no accounts, no tracking.

**Name:** honeybee
**Crawl cadence:** every 6 hours (`17 */6 * * *`)
**Cost target:** €0/month (GitHub Actions + GitHub Pages)
**Working dir:** `D:\bounty\honeybee`

---

## Status

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Repo scaffold, schema, progress log | 🟢 done |
| 1 | HackerOne crawler → normalized JSON (220 programs) | 🟢 done |
| 2 | Tab A UI: table, filters, reasons, confidence chips | 🟢 done |
| 3 | Profile questionnaire + `engine.js` personalization | 🟢 done |
| 4 | Catalog merge (arkadiyt platforms + lissy93) + Tab B | 🟢 done |
| 5 | "Will They Pay?" + AI-slop badges | 🟢 done |
| 6 | Snapshot history + events feed | ⚪ pending |
| 7 | Telegram alerts (optional) | ⚪ pending |
| 8 | Docs + CI + git history | 🟢 done |

Legend: 🟢 done · 🟡 in progress · ⚪ pending · 🔴 blocked

---

## Verified facts (measured, not assumed)

Live probe of HackerOne public GraphQL, 2026-10-20:

```
Paid + open programs:  220
Requests to fetch all:  3  (100/page)
Payload:  126 KB
Wall time:  ~10 s
Median program age:  49.6 months (4.1 years)
Median reports / 90d:  201  (p90 = 1,155 · max = 5,684)
Paid something in 90d:  201 / 220
Response indicator:  ok 155 · missed 59 · failed 5 · null 1
Programs with no scope:  2 / 220
Scope assets collected:  4,836 across 17 asset types
```

Confirmed working fields (the scoring signals):

`launched_at` · `reports_received_last_90_days` · `resolved_report_count` ·
`response_efficiency_percentage` · `response_efficiency_indicator` ·
`formatted_total_bounties_paid_amount` · `formatted_bounties_paid_last_90_days` ·
`last_report_resolved_at` · `average_bounty_lower/upper_amount` ·
`structured_scopes.total_count`

Fields that do **not** work unauthenticated (do not re-add):
- `bounty_competitiveness_percentile` - requires an input object; it is a calculator
- `first_response_time` / `resolution_time` / `bounty_time` / `triage_time` - all `null`
- `bounties_total` - returns the string `"0"`

Known source defects (handled, not hidden):
- `rix4uni/BugBountyData` is not a program list. Its `index.json` is a domain to
  scope-file map (`name`, `URL`, `count`), with no platform, bounty flag or program
  page. Excluded from the catalog rather than relabelled as programs.
- `lissy93` has **no dates at all** - cannot power freshness or change detection.
- `arkadiyt` H1 dump has **no report counts** despite response-efficiency fields.
- `arkadiyt` H1 dump listed 451 programs at the last crawl, not 950. The count
  moves upstream; the pipeline reads it live and never hardcodes it.

---

## Log

### 2026-10-20 - Phase 0
- Scaffolded `D:\bounty\honeybee`.
- Python 3.12.10, Node v24.20.0, git 2.50.1.

### 2026-10-20 - Phase 1
- Wrote `pipeline/sources/hackerone.py` (paginated GraphQL, retries, polite delay).
- Wrote `pipeline/sources/arkadiyt.py` (scope only; skips the 19 MB download unless
  the upstream commit SHA changed).
- First successful run: 220 programs, 4,836 scope assets, 45.6 s cold.

### 2026-10-20 - Phase 5 (early, because scoring depends on it)
- Corrected a wrong assumption: `response_efficiency_indicator` is **not** binary.
  Real distribution: `ok` 155 · `missed` 59 · `failed` 5 · `null` 1.
- Added a distinct `missed` penalty (−10) and a `Missed targets` badge tier.
- Added percentile so the absolute score is readable (`68.7` alone means nothing).

### 2026-10-20 - Phase 2
- Built `public/index.html`, `styles.css`, `app.js`.
- Sorting: best fit, lowest competition, newest, highest paid, largest scope.
- Filters: payout tier + full-text search across program name and scope assets.
- Expandable rows: reasons, per-component contribution bars, full scope list.
- Debugged the responsive grid at a real 912 px viewport (8-col → 6-col → 4-col).

### 2026-10-20 - Phase 3
- Wrote `public/engine.js` - framework-agnostic personalization module (`window.HBE`).
- 10 skill-surface sliders, hours/session, goal, tools. Stored in localStorage only.
- Profile re-ranks instantly; 15% of the score becomes stack match.
- Cold start verified: no profile ⇒ personal score equals population score exactly.

### 2026-10-20 - UI restyle
- Rebuilt the visual system to match the supplied reference (scriptmyads.com):
  warm paper `#14120e`, surface `#1c1913`, ink `#f0ebe0`, sage accent `#7dc894`,
  Archivo display + Instrument Sans body + Space Mono numerals + Instrument Serif
  italic accents, graph-paper grid, stamp/ticket-notch primary button.
- Fixed dead nav links (now switch tabs) and softened the grid.

### 2026-10-20 - Phase 8
- Added `.github/workflows/crawl.yml` (6-hourly cron, caches the scope dump, commits data).
- Added `docs/SCORING.md` with every formula, weight, penalty and citation.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | HackerOne-first for Tab A | Only platform with 10 free signals; 220 programs proves the model |
| 2 | arkadiyt for scope, H1 GraphQL for signals | Avoids 220 extra scope requests; arkadiyt is 30-min fresh |
| 3 | Catalog-only rows are never scored | Missing data must not silently become a good score |
| 4 | Personalization runs in the browser | No server, no accounts, no compute cost, no privacy problem |
| 5 | OpenBugBounty excluded by default | 2,289 recognition-only entries would dominate and add no signal |
| 6 | AI-slop badge labelled `experimental` | Proxy only; becomes real after 2-4 weeks of snapshot history |
| 7 | `engine.js` kept dependency-free | Reusable in Weven without a framework or build step |

### 2026-10-20 - UI v2: top-10 board, comparison, quick filters
- Added a "Your top 10" board above the tabs: rank, payout badge, score bar,
  percentile and the three numbers that matter (reports/90d, response, paid).
  It re-renders with the profile, so it is personalised, not a static leaderboard.
- Added program comparison: tick up to 4 rows (or use the card buttons), a sticky
  tray appears, and the modal diffs score, crowding, scope, response, payout, age,
  slop and surface mix. Winners are only highlighted when the margin is meaningful,
  so a 0.02 vs 0.02 slop tie is not presented as a win. CSV export of the selection.
- Quick filter chips replace the payout dropdown: pays reliably / missed targets /
  risky / low crowding / fresh / large scope.
- Clicking a top-10 card clears filters, expands that row and scrolls to it.
- Will-They-Pay distribution bar + legend under the stats.
- Keyboard: `/` focuses search, `Esc` closes modals.

### 2026-10-20 - UI v3: Google Developers docs layout
- Replaced the scriptmyads skin with a Google Developers docs layout: sticky white
  app bar (logo, section tabs, search, "Tune for me"), full-width blue value-prop
  banner, then a three-column shell - left nav (sort, quick filters with counts,
  views, data links), main doc column, right rail (on-page TOC, at-a-glance stats,
  compare panel).
- Search moved into the app bar with a `/` shortcut hint. Typing while on Catalog
  switches back to Ranked automatically.
- Top 10 and the program list restyled as Material: 1px #dadce0 borders, 8px radius,
  Roboto, blue accents, status chips (green/amber/red tinted), tabular numbers.
- Compare now lives in the right rail on wide screens; the bottom tray only appears
  below 1240px where the rail is hidden. Both drive the same selection state.
- Added a real Method section (anchor + nav target) and a Download JSON action.
- Verified: no console errors, no horizontal overflow at 985px, all 9 row cells fit
  at every breakpoint, compare/tabs/profile dialog working.

### 2026-10-20 - Personalisation engine v2
- Removed the blue banner under the app bar.
- Engine rewritten (`public/engine.js`, schema v2): experience level (scales all
  self-assessments: beginner ×0.5, intermediate ×0.85, advanced ×1.0), bounded
  influence (personalisation moves a score by at most ±12 points), completeness
  ramp (personal weight = 15% × profile completeness), tools that amplify
  existing surfaces instead of inventing skill, time gating for short sessions
  on huge scopes, top-2 share-weighted surface penalties.
- First-visit onboarding: skill-level question (Beginner / Intermediate /
  Advanced) seeds a full v2 profile. Beginners get a "very crowded" marker on
  the top third of competition (crowding ≥ 5/asset/mo or ≥ 900 reports/90d -
  Stripe, GitHub, Shopify territory). Warning, not a filter.
- Explainability: every expanded row now shows a "Your fit" block with
  per-surface shares, effective proficiency, mismatch penalty, stack match and
  the capped delta vs population. Rows carry compact match notes
  ("web 98% outside"). The profile dialog shows the exact weight shift per goal.
- Skill gap analysis in the right rail: for each weak surface, how many
  programs would enter the top 50 if practiced to 3/5, with median score.
- Migration and hardening: `migrateProfile()` clamps every field, upgrades v1,
  tolerates corrupt localStorage. 27 assertions in `public/engine.test.js`
  (run: `node public/engine.test.js`) covering bounds, monotonicity, cold start,
  ramp, tool logic, level factor, breakdown sums, gaps, beginner guard, time gate.
- Profile pill shows level and strength ("Beginner · 80% strength").

### 2026-10-20 - Splash, logo, explicit Method, Catalog layer
- Splash: full-screen dark blue (`#0b3d91`) with the honeycomb logo, `honeybee`
  and `bug bounty intelligence` in white. Fades after 3.2 s; a click or any key
  skips it; `prefers-reduced-motion` shortens it to 0.9 s. A CSS keyframe also
  hides it at 3.4 s, so a JS failure can never trap the page behind it.
- Logo: `public/logo.svg`, a seven-cell honeycomb in three blues with a bee in
  the centre cell. Used in the app bar, the splash and as the favicon.
- Method section rewritten and made explicit: the ten signals with their exact
  HackerOne fields, the full formula block, every penalty with its points, the
  badge conditions, the four personalisation rules, the catalog ordering formula,
  and a limits list that names what is missing. The program count is filled from
  the live payload.
- Removed all 57 em dashes from UI copy, engine strings, docs and README.
  Replaced with commas, colons or hyphens. Verified none remain in rendered text.
- Catalog pipeline: `pipeline/sources/catalog.py` merges the arkadiyt platform
  dumps (HackerOne 451, Bugcrowd 298, Intigriti 144, YesWeHack 56) with lissy93's
  two YAML lists (1,780 platform-listed, 224 direct). Dedupe on `platform:slug`.
  Result: 2,953 rows, 1,439 with published scope, 427 with a stated max payout.
- Catalog ordering, not scoring: 45 bounty status + 30 scope breadth + 15 type
  diversity + 10 disclosure terms + 10 max payout, normalised over the fields
  that are known so a missing field neither helps nor hurts. Every row carries
  `coverage_pct`.
- Catalog tab: platform chips with counts, an "Include scored" toggle (off by
  default, so the tab complements Ranked instead of repeating it), a catalog
  top 10 that excludes scored programs, and a full table with coverage.
  Search filters the catalog as well.
- Reformat: `prettier` re-indented `public/*` after a scripted dash replacement
  collapsed the existing indentation.

### 2026-10-20 - Splash, dropdown nav, research Method, match cards, catalog latest
- Splash now holds for 5 seconds, then fades over 0.9 s. The honeycomb cells
  pop in with a staggered scale, the bee lands, and the wordmark rises. Click
  or any key skips it; `prefers-reduced-motion` shows a 1.2 s static version.
  The CSS timeout is a fallback so a JS failure cannot trap the page.
- Left nav sections are collapsible `<details>` dropdowns: Sort by, Quick
  filters, Views, Data. Each keeps its counts. On Catalog the ranked Sort by
  block hides instead of leaving an empty header.
- Page summary is collapsed by default; the "On this page" box now lists
  Snapshot, top 10, All programs and Method and research.
- Method rewritten as a document rather than a markdown dump: a trust bar, a
  pipeline diagram, a t^-0.40 decay chart, a weight chart, a live catalog
  coverage chart, three research cards linking arXiv, the full signal, formula,
  penalty and badge tables, the bounded personalisation rules, a worked example,
  five verification steps, references and explicit limits.
- Clicking any ranked row or top-10 card opens a match card: rank, payout badge,
  a "Why this is a good match" block with surface share, effective skill, stack
  match, personal delta and profile strength, a six-metric strip, the score
  anatomy bars, the scope list, and add-to-compare / show-in-list / open actions.
  Inline row expansion was removed, so rows carry no hidden detail markup.
- Catalog: toolbar with an Order select (catalog order, latest additions,
  largest scope, highest payout, name), platform chips, an "Include scored"
  toggle, and a Latest additions block. First-seen dates are tracked in
  `data/cache/catalog_seen.json`, so the first crawl is labelled a baseline and
  later crawls produce a real change feed.
- Catalog intro now names its sources and the dedupe key.

### 2026-10-20 - Split pages, home, dark mode
- Split the single document into three pages:
  - `index.html` is now a home page, not the docs shell.
  - `app.html` is the index: Ranked and Catalog stay as two views of the same
    tool, with search, filters, compare and match cards.
  - `method.html` is the standalone Method and research document.
  The app bar is shared across all three, and the Method link navigates instead
  of scrolling.
- Home page: dark blue honeycomb hero, a live stat strip, an example match card,
  the six data sources with their real marks, a three-part "what we solve"
  section with UI fragments (badges, crowding bars, skill rows), the research
  cards, a live top five from `programs.json`, a closing CTA and a footer.
  Counts and the top five are fetched from the published JSON at runtime.
- Dark mode: full token override for every surface, status colour and figure.
  The theme follows the OS, is toggled from the app bar, persists in
  `localStorage` under `honeybee.theme`, and can be deep-linked with
  `?theme=light` or `?theme=dark`. A tiny inline script applies it before paint
  to avoid a flash.
- Splash moved to the home page only and extracted into `splash.js`, so a JS
  failure or reduced-motion setting can no longer leave the overlay stuck.
- The method page keeps its figures, tables, research cards and verification
  steps, and loads live counts plus the coverage figure from `page.js`.
- Source logos are committed as PNGs in `public/logos/`, shown on light tiles so
  dark marks remain visible in both themes.
- Removed the Method entry from "On this page" lists, since it is now a
  separate page. The rail block is labelled "Sections".

---

### 2026-10-20 - Splash v2, socials, open data, asset filters, change feed
- Splash cut to 3 seconds and made a deeper navy (#051733). The big honeycomb
  logo was removed. The name is now "honeybee" in Dancing Script 700 and the
  subtitle is Roboto 300 at 66% white. Click or any key still skips it; the
  reduced-motion path holds 1.2 s.
- Footer on home and Method: X (@asupasuyo), a GitHub placeholder marked
  "soon", and Buy Me a Coffee with the cup mark at
  buymeacoffee.com/onepetaflop.
- Home: removed the "Example match card" label. Added "What the index shows
  you", four cards covering why a program fits, comparison, asset filtering and
  the change feed, plus an open-data band linking programs.json, catalog.json
  and llms.txt.
- The 6-hour cadence is now a larger pill in the hero. home.js fills in the age
  of the last crawl and a countdown to the next rebuild from generated_at.
- Ranked sidebar: new "Asset types" group with checkboxes for Web, API, Mobile,
  Network, Cloud, Hardware / IoT, Smart contracts, Source code, AI and Other.
  Checked categories are OR-ed, counts are per program, and a clear button
  appears only when a filter is active. Verified: API 14 rows, Cloud 0 rows
  with the honest empty state, clear returns 221.
- App bar: the bee avatar is replaced by a "What's new" bell with an unread dot
  and a #news deep link. The panel lists new programs, new catalog rows, new
  scope assets, scope updates and removed assets.
- pipeline/events.py: each run writes data/cache/snapshot.json (program ids,
  scope asset keys, catalog ids) and diffs the next crawl against it. Events
  merge into public/data/events.json, newest first, capped at 200. The first
  run is labelled a baseline instead of calling 2,956 rows new. Scope changes
  are capped at 4 asset events per program per run.
- public/llms.txt documents the JSON files, the honest limits, the scoring in
  one paragraph and the rules for using the data with a model.
- public/data/events.json was removed from .gitignore so the Action commits it.
  data/cache stays ignored and is restored by actions/cache.
- Verified with the built-in browser: asset filter counts and empty state,
  What's new baseline state and sample rendering, footer links, light and dark
  home, catalog, and the 29-assertion engine test.

---

## Next

1. Phase 6 is done (snapshot diff and events.json shipped, see above).
2. Phase 7 - Telegram alerts from the same Actions job, keyed on the new event
   types.
3. Wire the repo to a GitHub remote and enable Pages plus the 6-hourly Action.
4. Run a second crawl after the baseline so real scope or catalog changes start
   appearing in What's new.
