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

- `bounty_competitiveness_percentile` — requires a `BountyCompetitivenessPercentileInput`
  object with four bounty amounts. It is a **calculator**, not a stored value.
- `first_response_time`, `resolution_time`, `bounty_time`, `triage_time` — all `null`.
- `bounties_total` — returns the string `"0"`.

## Sub-scores (each 0..1)

```
novelty            = (age_months + 1) ^ -0.40
crowding           = (reports_90d / 3) / max(scope_count, 1)
inverse_crowd      = 1 / (1 + (crowding / 1.0) ^ 1.2)
payout_reliability = 0.5·(efficiency/100) + 0.3·(paid_90d > 0) + 0.2·exp(−days_since_resolved/90)
value_per_comp     = min(1, log1p(avg_bounty_high) / log1p(20000)) / (1 + crowding)
triage_quality     = (efficiency/100) × {1.0 ok, 0.75 missed, 0.5 failed}
scope_breadth      = min(1, log1p(scope_count) / log1p(500))
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
| 🟡 Missed targets | indicator `missed` — blowing its own stated SLAs |
| 🟢 Pays reliably | `ok` + efficiency ≥ 80 + paid in 90d + resolved ≤ 30d |
| 🟡 Pays slowly | everything else with sufficient signals |
| ⚪ Unknown | no efficiency and no payout data |

Population 2026-10-20: 100 green · 100 yellow · 20 red.

### AI-slop risk (experimental)

```
density  = reports_90d / max(scope_count, 1)
pressure = reports_90d / max(resolved_total, 1)
slop     = 0.6·min(1, density/50) + 0.4·min(1, pressure/10)
```

This is a **single-snapshot proxy**. The real signal is the derivative — a
volume spike against a program's own baseline — which needs 2–4 weeks of
snapshots. The UI labels it experimental and it carries only a −10 penalty.

## Personalisation

Runs client-side in `public/engine.js`. 15% of the score becomes stack match
when a profile exists.

```
w_i = base_i × preference_i ;  renormalised to (1 − 0.15)
score = 100 · ( Σ w_i·s_i + 0.15·stack_match )
```

`stack_match` maps each scope asset type to a skill surface (web, api, mobile,
cloud, network, source, hardware, smart_contract, ai) and averages the user's
self-rated proficiency weighted by asset count.

Preferences adjust the population weights:

| Goal | Effect |
|---|---|
| First bounty | crowding ×1.35, breadth ×0.65, value ×0.85 |
| Steady income | payout reliability ×1.45, crowding ×1.10 |
| Learning | value ×0.80, triage ×1.10 |

A program whose dominant surface the user rates 0 gets −18; rated 1 gets −8.

Cold start works: with no profile, `stack_match = 0` and the weights sum to 1,
so the personal score equals the population score exactly.

## Design principles

1. **Missing data is never a good score.** Every program reports
   `quality.signals_present` and a confidence tier. Catalog-only rows are shown
   but never ranked.
2. **Percentile next to the absolute score.** The population is not normalised
   to 100, so `68.7` needs `top 6%` to mean anything.
3. **Every row explains itself.** Reasons and per-component contributions are
   in the payload, not computed in a hidden service.
