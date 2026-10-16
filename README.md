# honeybee

Bug bounty opportunity intelligence for mid-level hunters.

Most tools rank programs by **reward** and **freshness**. Research on 159 hunters says
saturation ranks 10th and age 13th in their own decisions — while the two biggest
challenges they report are **poor responsiveness** and **payout disputes**.

honeybee ranks on **whether the program will actually pay you**, and personalises the
ranking to the stack and constraints you actually have.

## Two tabs

| Tab | Promise | Data |
|---|---|---|
| **Ranked** | Programs we can score, ranked for you, with reasons | HackerOne: 220 programs × 10 signals |
| **Catalog** | Every program we can find, with everything known, and honest gaps | lissy93 + rix4uni + arkadiyt |

Catalog rows are **never** scored. Missing data cannot become a good score.

## Why it is free

No server, no database, no LLM in the loop.

```
GitHub Actions (cron 6h)  →  static JSON  →  GitHub Pages
                                              ↓
                                    personalization in the browser
                                    (localStorage, no accounts)
```

Scoring is arithmetic. Personalization is client-side. Alerts go from Actions
straight to Telegram. Total infrastructure cost: €0.

## Quick start

```bash
python -m pipeline.run          # crawl + score + emit to public/data
python -m http.server -d public # preview the UI locally
```

## Layout

```
pipeline/
  sources/hackerone.py   # GraphQL: 10 scoring signals (220 programs, 3 requests)
  sources/arkadiyt.py    # scope dumps, 30-min fresh
  normalize.py           # unified schema + dedup
  score.py               # population-level scores
  badges.py              # "Will They Pay?" + AI-slop proxy
  emit.py                # writes public/data/*.json
public/
  index.html
  app.js                 # tabs, filters, table
  engine.js              # personalization module (framework-agnostic)
docs/SCORING.md          # formulas + research citations
```

## Honest limitations

- **AI-slop detection is a proxy in v1.** It needs 2–4 weeks of snapshots to measure
  report-velocity spikes against a program's own baseline.
- **Only HackerOne is scored.** Intigriti and YesWeHack join in v1.1.
- **Report counts are not published by every source.** The UI says so per row.
- **Deduplication is conservative.** Same company on two platforms may appear twice
  rather than be silently merged.
- Crawl cadence is 6h, and GitHub Actions cron can drift 5–15 minutes.

## Research basis

- Maillart et al., *Given Enough Eyeballs, All Bugs Are Shallow?* (arXiv:1608.03445) —
  bug-discovery probability decays as `t^-0.40` after launch; per-program payoff decays
  as `k^-0.45`, but across programs rises as `k^+0.19`.
- Akgul et al., *Bug Hunters' Perspectives* (arXiv:2301.04781) — 159 hunters; saturation
  ranks 10th, age 13th; responsiveness and payout disputes are the top two challenges.
- Zheng et al., *From Reviewers' Lens* (arXiv:2511.18608) — 9,942 H1 reports; in 59.85%
  of near-identical pairs, the higher-reputation reporter got the better outcome.
