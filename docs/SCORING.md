# Scoring

Everything here is arithmetic. No ML, no LLM, no black box. The published JSON
contains every input and every weight, and the UI shows the contribution of each
component per program.

## Signals

Only HackerOne exposes these for free, unauthenticated. Verified 2026-10-20.

| Signal | Field | Used for |
|---|---|---|
| Age | `launched_at` | novelty |
| Reports in 90d | `reports_received_last_90_days` | crowding |
| Resolved total | `resolved_report_count` | slop pressure |
| Response efficiency | `response_efficiency_percentage` | payout reliability, triage |
| Response status | `response_efficiency_indicator` (`ok` / `missed` / `failed`) | triage, penalties |
| Lifetime paid | `formatted_total_bounties_paid_amount` | context |
| Paid in 90d | `formatted_bounties_paid_last_90_days` | payout reliability |
| Last resolved | `last_report_resolved_at` | recency |
| Average bounty | `average_bounty_lower/upper_amount` | value |
| Scope size | `structured_scopes.total_count` | crowding denominator, breadth |

### Fields that do not work unauthenticated

These look promising and are traps:

- `bounty_competitiveness_percentile` - requires a `BountyCompetitivenessPercentileInput`
  object with four bounty amounts. It is a **calculator**, not a stored value.
- `first_response_time`, `resolution_time`, `bounty_time`, `triage_time` - all `null`.
- `bounties_total` - returns the string `"0"`.

## Sub-scores (each 0..1)

```
novelty  = (age_months + 1) ^ -0.40
crowding  = (reports_90d / 3) / max(scope_count, 1)
inverse_crowd  = 1 / (1 + (crowding / 1.0) ^ 1.2)
payout_reliability = 0.5·(efficiency/100) + 0.3·(paid_90d > 0) + 0.2·exp(−days_since_resolved/90)
value_per_comp  = min(1, log1p(avg_bounty_high) / log1p(20000)) / (1 + crowding)
triage_quality  = (efficiency/100) × {1.0 ok, 0.75 missed, 0.5 failed}
scope_breadth  = min(1, log1p(scope_count) / log1p(500))
```

The `-0.40` exponent is not invented. Maillart et al. measured bug-discovery
probability decaying as `t^-0.40` after program launch across 35 public
HackerOne programs (arXiv:1608.03445, R² = 0.79).

## Population score

```
base = 100 × (
  0.22 · novelty
  + 0.22 · inverse_crowd
  + 0.22 · payout_reliability
  + 0.16 · value_per_competition
  + 0.11 · triage_quality
  + 0.07 · scope_breadth
)

score = clamp(base + penalties, 0, 100)
```

### Penalties

| Condition | Points |
|---|---|
| Response indicator `failed` | −25 |
| Response indicator `missed` | −10 |
| `reports_90d` > 1,000 (crowd wall) | −20 |
| `reports_90d` > 3,000 (premium crowding) | −10 |
| Nothing resolved in 180 days (dormant) | −15 |
| Slop risk ≥ 0.6 | −10 |

## Badges

### Will They Pay?

| Tier | Condition |
|---|---|
| 🔴 Risky | `failed`, or efficiency < 50, or dormant > 180d |
| 🟡 Missed targets | indicator `missed` - blowing its own stated SLAs |
| 🟢 Pays reliably | `ok` + efficiency ≥ 80 + paid in 90d + resolved ≤ 30d |
| 🟡 Pays slowly | everything else with sufficient signals |
| ⚪ Unknown | no efficiency and no payout data |

Population 2026-10-20: 100 green · 100 yellow · 20 red.

### AI-slop risk (experimental)

```
density  = reports_90d / max(scope_count, 1)
pressure = reports_90d / max(resolved_total, 1)
slop  = 0.6·min(1, density/50) + 0.4·min(1, pressure/10)
```

This is a **single-snapshot proxy**. The real signal is the derivative - a
volume spike against a program's own baseline - which needs 2-4 weeks of
snapshots. The UI labels it experimental and it carries only a −10 penalty.

## Personalisation (engine v2)

Runs client-side in `public/engine.js`, schema v2. Guarantees, in order:
honest, bounded, explainable, monotonic. `engine.test.js` enforces all of them.

### Experience level

On first visit the user picks a level. It scales every self-assessed skill:

```
effective_proficiency = self_rating × { beginner 0.5, intermediate 0.85, advanced 1.0 }
```

A beginner who rates web 5/5 is treated as 2.5/5. This is why a beginner does
not get pointed at elite programs: their effective skill is below the bar that
the top third of programs actually require.

### Bounded influence

Personalisation is a **delta, capped at ±12 points**, applied to the population
score:

```
personal_total = weighted parts + population penalties + surface penalties
score  = clamp(population + clamp(personal_total − population, −12, +12), 0, 100)
```

Opinions can reorder; they cannot fabricate a 90.

### Strength ramp

The personal share of the weights is not fixed at 15% - it scales with profile
completeness (surfaces 0.3, goal 0.25, time 0.25, tools 0.2):

```
personal_weight = 0.15 × completeness
```

A half-filled profile applies half-strength personalisation. The pill in the
header shows the current strength.

### Effective skill and tools

```
effective = self_rating × level_factor + Σ tool_bumps
```

Tools only amplify a surface the user already practices (rating > 0), and are
capped at 5:

| Tool | Bumps |
|---|---|
| Burp Pro | web +1, api +1 |
| OOB / Collaborator | network +1, other +1 |
| Mobile proxy | mobile +1 |
| VPS | cloud +1, network +1 |

### Time gate

Short sessions cannot sweep huge scopes, so the scope-breadth component is
discounted for low-time users on very large programs: session ≤ 2h with ≥ 200
assets → ×0.75; session ≤ 3h with ≥ 400 assets → ×0.85. Monotonic: more time
never hurts.

### Surface mismatch penalty

Share-weighted over the top 2 surfaces (dominant surface full weight, second
at 0.5): effective ≤ 1 → −18 × share; effective = 2 → −8 × share. A program
that is half web, half mobile still pays for the mobile half.

### Preferences adjust the population weights

| Goal | Effect |
|---|---|
| First bounty | crowding ×1.35, breadth ×0.65, value ×0.85 |
| Steady income | payout reliability ×1.45, crowding ×1.10 |
| Learning | value ×0.80, triage ×1.10 |

The exact shift is shown in the profile dialog next to the goal chips.

### Skill gap analysis

For each surface rated ≤ 1: simulate the user learning it to 3/5, re-rank, and
count how many new programs enter their top 50 (with median score). The top 3
opportunities appear in the right rail. This is a recommendation to *learn*,
not to hunt - the ranking still only rewards what you can already test.

### Beginner guard (UI only, no score change)

Level 1 users see a "very crowded" marker on programs with crowding/asset/
month ≥ 5 or ≥ 900 reports in 90 days - the top third of competition, where
Stripe, GitHub and Shopify sit. It is a warning, not a filter: hiding programs
would violate principle 1.

### Cold start

With no profile, `stack_match = 0`, weights sum to 1, and the personal score
equals the population score exactly - verified by test.

### Profile schema

```
{ version: 2, capability: { level: 1-3, surfaces: {web: 0-5, ...} },
  constraints: { hours_per_week, session_hours, tools },
  preferences: { goal, variance_tolerance }, outcomes: [] }
```

Stored in `localStorage` only. `migrateProfile()` clamps every field and
upgrades v1 profiles; corrupt input degrades to no profile. The engine is
dependency-free and reusable (Weven).

## Catalog ordering (not scoring)

The Catalog holds every program we can find beyond the scored HackerOne set:
HackerOne VDPs and unpaid programs plus Bugcrowd, Intigriti, YesWeHack and
direct or platform-listed programs. Catalog rows are ordered, never scored.

```
points  = 45 · bounty_known
        + 30 · min(1, log1p(scope_count) / log1p(400))
        + 15 · min(1, scope_types / 6)
        + 10 · safe_harbor            (full = 1.0, partial = 0.5)
        + 10 · min(1, log1p(max_payout) / log1p(1_000_000))

weights = sum of the weights above whose field is known
order   = 100 · points / weights
```

Bounty known means the source states it: `True` scores 45, `False` (a VDP)
scores 15. Points are normalised over known fields, so a missing payout figure
neither helps nor hurts. Every row carries `coverage_pct` over four checks
(bounty, payout, scope, disclosure terms) and the UI prints it.

This ordering is a reading aid for an incomplete dataset. It is not evidence
that a program pays, and it never feeds the population score.

### Latest additions

None of the catalog sources publish a launch date, so "latest" cannot mean
"newest program". Instead the pipeline stores the first crawl that saw each
`platform:slug` in `data/cache/catalog_seen.json` and writes `first_seen` and
`new` onto every row. The Catalog exposes a "Latest additions" ordering on that
date. It means first seen by honeybee, the UI says so, and the first crawl is a
baseline where every row shares one date.

## Design principles

1. **Missing data is never a good score.** Every program reports
  `quality.signals_present` and a confidence tier. Catalog-only rows are shown
  but never ranked.
2. **Percentile next to the absolute score.** The population is not normalised
  to 100, so `68.7` needs `top 6%` to mean anything.
3. **Every row explains itself.** Reasons and per-component contributions are
  in the payload, not computed in a hidden service.
