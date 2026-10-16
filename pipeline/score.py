"""Population-level scoring.

All arithmetic, no ML, no network. Every sub-score is 0..1 and every weight is
declared here so the UI can show exactly why a program ranks where it does.

Research basis
--------------
Maillart et al. (arXiv:1608.03445) measured bug-discovery probability decaying as
``t^-0.40`` after program launch. We use that exponent directly for ``novelty``
rather than an invented bell curve.

The *personal* component (stack match, user preferences, learned multipliers) is
deliberately NOT computed here. It runs client-side in ``public/engine.js`` so that
the published JSON stays user-agnostic and no server is required.
"""

from __future__ import annotations

import math
from typing import Any

FRESHNESS_EXPONENT = 0.40   # empirical, Maillart et al.
CROWDING_PIVOT = 1.0        # reports per asset per month that reads as "neutral"
VALUE_REFERENCE = 20_000    # log1p reference, so $20k avg bounty scores 1.0
SCOPE_REFERENCE = 500       # log1p reference for scope breadth

WEIGHTS = {
    "novelty": 0.22,
    "inverse_crowd": 0.22,
    "payout_reliability": 0.22,
    "value_per_competition": 0.16,
    "triage_quality": 0.11,
    "scope_breadth": 0.07,
}

# Deductions, applied after the weighted sum.
PENALTY_FAILED_TRIAGE = 25
PENALTY_MISSED_TRIAGE = 10
PENALTY_CROWD_WALL = 20
PENALTY_DORMANT = 15
PENALTY_SLOP = 10
PENALTY_PREMIUM = 10

CROWD_WALL_REPORTS_90D = 1000
PREMIUM_REPORTS_90D = 3000
DORMANT_DAYS = 180


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def novelty(age_months: float | None) -> float:
    """(age + 1)^-0.40, normalised so a brand-new program scores 1.0."""
    if age_months is None:
        return 0.0
    return _clamp((age_months + 1.0) ** -FRESHNESS_EXPONENT)


def crowding(signals: dict[str, Any]) -> float:
    """Reports per asset per month. This is the real competition metric."""
    reports = _num(signals.get("reports_90d")) or 0.0
    per_month = reports / 3.0
    assets = max(_num(signals.get("scope_count")) or 1.0, 1.0)
    return per_month / assets


def inverse_crowd(density: float) -> float:
    return 1.0 / (1.0 + (density / CROWDING_PIVOT) ** 1.2)


def payout_reliability(signals: dict[str, Any]) -> float:
    efficiency = _num(signals.get("response_efficiency"))
    paid_90d = _num(signals.get("paid_90d")) or 0.0
    days = _num(signals.get("days_since_resolved"))

    efficiency_part = _clamp((efficiency if efficiency is not None else 50.0) / 100.0)
    paid_part = 1.0 if paid_90d > 0 else 0.0
    recency_part = _clamp(math.exp(-(days if days is not None else 365.0) / 90.0))

    return _clamp(0.5 * efficiency_part + 0.3 * paid_part + 0.2 * recency_part)


def value_per_competition(signals: dict[str, Any], density: float) -> float:
    high = _num(signals.get("avg_bounty_high")) or 0.0
    normalised = _clamp(math.log1p(high) / math.log1p(VALUE_REFERENCE))
    return _clamp(normalised / (1.0 + density))


def triage_quality(signals: dict[str, Any]) -> float:
    efficiency = _num(signals.get("response_efficiency"))
    if efficiency is None:
        return 0.5
    score = efficiency / 100.0
    indicator = signals.get("response_indicator")
    if indicator == "failed":
        score *= 0.5
    elif indicator == "missed":
        # Blew their own stated response targets.
        score *= 0.75
    return _clamp(score)


def scope_breadth(signals: dict[str, Any]) -> float:
    count = _num(signals.get("scope_count")) or 0.0
    return _clamp(math.log1p(count) / math.log1p(SCOPE_REFERENCE))


def penalties(signals: dict[str, Any], slop_risk: float) -> list[dict[str, Any]]:
    """Return human-readable deductions so the UI can explain them."""
    applied: list[dict[str, Any]] = []

    if signals.get("response_indicator") == "failed":
        applied.append({"reason": "triage failing", "points": -PENALTY_FAILED_TRIAGE})
    elif signals.get("response_indicator") == "missed":
        applied.append({"reason": "missing response targets", "points": -PENALTY_MISSED_TRIAGE})

    reports = _num(signals.get("reports_90d")) or 0.0
    if reports > CROWD_WALL_REPORTS_90D:
        applied.append({"reason": "crowd wall", "points": -PENALTY_CROWD_WALL})
    if reports > PREMIUM_REPORTS_90D:
        applied.append({"reason": "premium crowding", "points": -PENALTY_PREMIUM})

    days = _num(signals.get("days_since_resolved"))
    if days is not None and days > DORMANT_DAYS:
        applied.append({"reason": "dormant", "points": -PENALTY_DORMANT})

    if slop_risk >= 0.6:
        applied.append({"reason": "slop risk", "points": -PENALTY_SLOP})

    return applied


def score_program(program: dict[str, Any], slop_risk: float) -> dict[str, Any]:
    """Attach ``derived`` and ``score`` blocks to a normalized program."""
    signals = program.get("signals") or {}

    density = crowding(signals)
    parts = {
        "novelty": novelty(_num(signals.get("age_months"))),
        "inverse_crowd": inverse_crowd(density),
        "payout_reliability": payout_reliability(signals),
        "value_per_competition": value_per_competition(signals, density),
        "triage_quality": triage_quality(signals),
        "scope_breadth": scope_breadth(signals),
    }

    weighted = sum(WEIGHTS[key] * parts[key] for key in WEIGHTS)
    deductions = penalties(signals, slop_risk)
    total = _clamp(weighted * 100.0 + sum(d["points"] for d in deductions), 0.0, 100.0)

    program["derived"] = {
        **{key: round(value, 4) for key, value in parts.items()},
        "crowding_per_asset_month": round(density, 4),
        "slop_risk": round(slop_risk, 3),
    }
    program["score"] = {
        "total": round(total, 1),
        "parts": {key: round(value, 3) for key, value in parts.items()},
        "weights": WEIGHTS,
        "penalties": deductions,
    }
    return program
