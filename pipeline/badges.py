"""Badges.

``will_pay``  — the "Will They Pay?" reliability tier.
``slop_risk`` — an *experimental* AI-report-slop proxy.

The slop proxy is honestly labelled experimental: it uses a single snapshot and
therefore cannot see a *spike*. Detecting a spike needs 2-4 weeks of snapshots so
we can compare a program against its own baseline. Until then this is a density
and resolution-pressure heuristic, and the UI says so.
"""

from __future__ import annotations

from typing import Any


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def will_pay(signals: dict[str, Any]) -> dict[str, Any]:
    """Four-tier payout reliability judgement."""
    efficiency = _num(signals.get("response_efficiency"))
    indicator = signals.get("response_indicator")
    paid_90d = _num(signals.get("paid_90d"))
    days = _num(signals.get("days_since_resolved"))

    if efficiency is None and paid_90d is None:
        return {"tier": "unknown", "label": "Unknown", "why": "not enough payout signals"}

    reasons: list[str] = []

    if indicator == "failed":
        reasons.append("triage marked failed")
    if efficiency is not None and efficiency < 50:
        reasons.append(f"response efficiency {efficiency:.0f}%")
    if days is not None and days > 180:
        reasons.append(f"nothing resolved in {days:.0f} days")

    if reasons:
        return {"tier": "red", "label": "Risky", "why": ", ".join(reasons)}

    if indicator == "missed":
        return {
            "tier": "yellow",
            "label": "Missed targets",
            "why": "blowing its own stated response targets",
        }

    if (
        indicator == "ok"
        and efficiency is not None
        and efficiency >= 80
        and paid_90d
        and paid_90d > 0
        and days is not None
        and days <= 30
    ):
        return {
            "tier": "green",
            "label": "Pays reliably",
            "why": f"{efficiency:.0f}% response, paid recently, resolved {days:.0f}d ago",
        }

    bits: list[str] = []
    if efficiency is not None:
        bits.append(f"{efficiency:.0f}% response")
    if paid_90d:
        bits.append("pays")
    else:
        bits.append("no recent payout seen")
    if days is not None and days > 30:
        bits.append(f"last resolved {days:.0f}d ago")

    return {"tier": "yellow", "label": "Pays, slowly", "why": ", ".join(bits) or "mixed signals"}


def slop_risk(signals: dict[str, Any]) -> float:
    """0..1 proxy for 'is this program drowning in low-quality reports'.

    Two components:
      density   — reports per asset per 90 days (a small scope absorbing a flood)
      pressure  — reports received vs reports resolved (triage falling behind)
    """
    reports = _num(signals.get("reports_90d")) or 0.0
    assets = max(_num(signals.get("scope_count")) or 1.0, 1.0)
    resolved = max(_num(signals.get("resolved_total")) or 0.0, 1.0)

    density = reports / assets
    pressure = reports / resolved

    score = 0.6 * min(1.0, density / 50.0) + 0.4 * min(1.0, pressure / 10.0)
    return max(0.0, min(1.0, score))


def slop_label(risk: float) -> str:
    if risk >= 0.6:
        return "elevated"
    if risk >= 0.35:
        return "watch"
    return "none"


def apply_badges(program: dict[str, Any]) -> dict[str, Any]:
    signals = program.get("signals") or {}
    risk = slop_risk(signals)
    program["badges"] = {
        "will_pay": will_pay(signals),
        "slop": {
            "risk": round(risk, 3),
            "label": slop_label(risk),
            "experimental": True,
        },
    }
    return program
