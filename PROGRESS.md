# HONEYBEE — Build Progress

> Bug bounty opportunity intelligence for mid-level hunters.
> Two tabs: **Ranked** (scored programs) and **Catalog** (everything we can find, honest about gaps).

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
| 4 | Catalog merge (lissy93 + rix4uni + arkadiyt) + Tab B | ⚪ next |
| 5 | "Will They Pay?" + AI-slop badges | 🟢 done |
| 6 | Snapshot history + events feed | ⚪ pending |
| 7 | Telegram alerts (optional) | ⚪ pending |
| 8 | Docs + CI + git history | 🟢 done |

Legend: 🟢 done · 🟡 in progress · ⚪ pending · 🔴 blocked

---

## Verified facts (measured, not assumed)

Live probe of HackerOne public GraphQL, 2026-10-20:

```
Paid + open programs:    220
Requests to fetch all:   3   (100/page)
Payload:                 126 KB
Wall time:               ~10 s
Median program age:      49.6 months (4.1 years)
Median reports / 90d:    201   (p90 = 1,155 · max = 5,684)
Paid something in 90d:   201 / 220
Response indicator:      ok 155 · missed 59 · failed 5 · null 1
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
- `bounty_competitiveness_percentile` — requires an input object; it is a calculator
- `first_response_time` / `resolution_time` / `bounty_time` / `triage_time` — all `null`
- `bounties_total` — returns the string `"0"`

Known source defects (handled, not hidden):
- `rix4uni` `issues_reported` is an empty array in **all 4,316** records — field is dead.
- `rix4uni` is 53% OpenBugBounty (2,289) — mostly recognition-only, excluded by default.
- `lissy93` has **no dates at all** — cannot power freshness or change detection.
- `arkadiyt` H1 dump has **no report counts** despite response-efficiency fields.

---

## Log

### 2026-10-20 — Phase 0
- Scaffolded `D:\bounty\honeybee`.
- Python 3.12.10, Node v24.20.0, git 2.50.1.

### 2026-10-20 — Phase 1
- Wrote `pipeline/sources/hackerone.py` (paginated GraphQL, retries, polite delay).
- Wrote `pipeline/sources/arkadiyt.py` (scope only; skips the 19 MB download unless
  the upstream commit SHA changed).
- First successful run: 220 programs, 4,836 scope assets, 45.6 s cold.

### 2026-10-20 — Phase 5 (early, because scoring depends on it)
- Corrected a wrong assumption: `response_efficiency_indicator` is **not** binary.
  Real distribution: `ok` 155 · `missed` 59 · `failed` 5 · `null` 1.
- Added a distinct `missed` penalty (−10) and a `Missed targets` badge tier.
- Added percentile so the absolute score is readable (`68.7` alone means nothing).

### 2026-10-20 — Phase 2
- Built `public/index.html`, `styles.css`, `app.js`.
- Sorting: best fit, lowest competition, newest, highest paid, largest scope.
- Filters: payout tier + full-text search across program name and scope assets.
- Expandable rows: reasons, per-component contribution bars, full scope list.
- Debugged the responsive grid at a real 912 px viewport (8-col → 6-col → 4-col).

### 2026-10-20 — Phase 3
- Wrote `public/engine.js` — framework-agnostic personalization module (`window.HBE`).
- 10 skill-surface sliders, hours/session, goal, tools. Stored in localStorage only.
- Profile re-ranks instantly; 15% of the score becomes stack match.
- Cold start verified: no profile ⇒ personal score equals population score exactly.

### 2026-10-20 — UI restyle
- Rebuilt the visual system to match the supplied reference (scriptmyads.com):
  warm paper `#14120e`, surface `#1c1913`, ink `#f0ebe0`, sage accent `#7dc894`,
  Archivo display + Instrument Sans body + Space Mono numerals + Instrument Serif
  italic accents, graph-paper grid, stamp/ticket-notch primary button.
- Fixed dead nav links (now switch tabs) and softened the grid.

### 2026-10-20 — Phase 8
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
| 6 | AI-slop badge labelled `experimental` | Proxy only; becomes real after 2–4 weeks of snapshot history |
| 7 | `engine.js` kept dependency-free | Reusable in Weven without a framework or build step |

---

## Next

1. **Phase 4** — merge lissy93 (3,363) + rix4uni (4,316, OpenBugBounty filtered) +
   arkadiyt (950) into `catalog.json`; dedupe on `platform:slug`; build Tab B with
   explicit per-row field coverage and a `catalog only — not scored` badge.
2. **Phase 6** — persist a snapshot per run, diff it, emit `events.json`
   (new program, scope added, bounty raised, VDP→bounty, paused, report spike).
3. **Phase 7** — Telegram alerts from the same Actions job.
