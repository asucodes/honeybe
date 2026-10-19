"""Unified program schema and normalisation helpers.

Every program in honeybe, from any source, ends up in the shape produced by
``normalize_hackerone`` below. Sources that cannot fill a field leave it ``None``
and say so in ``quality`` — missing data must never silently look like a bad score.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

SECONDS_PER_DAY = 86_400.0
SECONDS_PER_MONTH = 30.4375 * SECONDS_PER_DAY

# The full set of signals the score consumes. Used to report confidence.
SIGNAL_KEYS = (
    "launched_at",
    "reports_90d",
    "resolved_total",
    "response_efficiency",
    "response_indicator",
    "paid_total",
    "paid_90d",
    "last_resolved_at",
    "avg_bounty_high",
    "scope_count",
)


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def months_since(moment: datetime | None, now: datetime) -> float | None:
    if moment is None:
        return None
    return max(0.0, (now - moment).total_seconds() / SECONDS_PER_MONTH)


def days_since(moment: datetime | None, now: datetime) -> float | None:
    if moment is None:
        return None
    return max(0.0, (now - moment).total_seconds() / SECONDS_PER_DAY)


def _confidence(present: int) -> str:
    if present >= 9:
        return "high"
    if present >= 6:
        return "medium"
    if present >= 3:
        return "low"
    return "none"


def normalize_hackerone(
    node: dict[str, Any],
    scope_by_handle: dict[str, list[dict[str, Any]]],
    now: datetime,
) -> dict[str, Any]:
    """Turn one HackerOne GraphQL node into the unified honeybe record."""
    handle = node["handle"]
    scope = scope_by_handle.get(handle, [])

    launched_at = parse_dt(node.get("launched_at"))
    last_resolved_at = parse_dt(node.get("last_report_resolved_at"))

    scope_count = (node.get("structured_scopes") or {}).get("total_count")
    if not scope_count:
        scope_count = len(scope) or None

    signals = {
        "launched_at": node.get("launched_at"),
        "age_months": months_since(launched_at, now),
        "reports_90d": node.get("reports_received_last_90_days"),
        "resolved_total": node.get("resolved_report_count"),
        "response_efficiency": node.get("response_efficiency_percentage"),
        "response_indicator": node.get("response_efficiency_indicator"),
        "paid_total": node.get("formatted_total_bounties_paid_amount"),
        "paid_90d": node.get("formatted_bounties_paid_last_90_days"),
        "last_resolved_at": node.get("last_report_resolved_at"),
        "days_since_resolved": days_since(last_resolved_at, now),
        "avg_bounty_low": node.get("average_bounty_lower_amount"),
        "avg_bounty_high": node.get("average_bounty_upper_amount"),
        "min_bounty": node.get("minimum_bounty"),
        "scope_count": scope_count,
    }

    present = sum(1 for key in SIGNAL_KEYS if signals.get(key) is not None)
    missing = [key for key in SIGNAL_KEYS if signals.get(key) is None]

    return {
        "id": f"hackerone:{handle}",
        "platform": "hackerone",
        "slug": handle,
        "name": node.get("name") or handle,
        "url": f"https://hackerone.com/{handle}",
        "meta": {
            "reward_min": signals.get("min_bounty"),
            "reward_max": signals.get("avg_bounty_high"),
            "tags": [],
            "vdp": False,
            "submission_state": node.get("submission_state"),
            "team_state": node.get("state"),
        },
        "signals": signals,
        "scope": scope,
        "quality": {
            "confidence": _confidence(present),
            "signals_present": present,
            "signals_expected": len(SIGNAL_KEYS),
            "missing": missing,
            "sources": ["hackerone"],
        },
    }
