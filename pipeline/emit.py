"""Emit static JSON for GitHub Pages."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path("public/data")


def _money(value: float | None) -> str:
    if value is None:
        return "—"
    if value >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:.0f}k"
    return f"${value:.0f}"


def _count(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{int(value):,}"


def build_reasons(program: dict[str, Any]) -> list[dict[str, str]]:
    """Short, human-readable evidence for and against a program."""
    signals = program.get("signals") or {}
    derived = program.get("derived") or {}
    reasons: list[dict[str, str]] = []

    paid_90d = signals.get("paid_90d")
    if paid_90d:
        reasons.append(
            {
                "sign": "good",
                "text": f"paid {_money(paid_90d)} in the last 90 days",
            }
        )

    efficiency = signals.get("response_efficiency")
    if efficiency is not None and efficiency >= 80:
        reasons.append(
            {"sign": "good", "text": f"{efficiency:.0f}% response efficiency"}
        )
    elif efficiency is not None and efficiency < 50:
        reasons.append(
            {"sign": "bad", "text": f"response efficiency only {efficiency:.0f}%"}
        )

    reports = signals.get("reports_90d")
    assets = signals.get("scope_count")
    if reports is not None:
        scope_bit = f" across {_count(assets)} assets" if assets else ""
        reasons.append(
            {
                "sign": "bad" if reports > 1000 else "neutral",
                "text": f"{_count(reports)} reports in 90 days{scope_bit}",
            }
        )

    days = signals.get("days_since_resolved")
    if days is not None:
        if days <= 30:
            reasons.append({"sign": "good", "text": "resolved a report in the last month"})
        elif days > 180:
            reasons.append(
                {"sign": "bad", "text": f"nothing resolved for {days:.0f} days"}
            )

    age = signals.get("age_months")
    if age is not None:
        years = age / 12
        if years >= 1:
            reasons.append({"sign": "neutral", "text": f"running {years:.1f} years"})
        else:
            reasons.append({"sign": "neutral", "text": f"launched {age:.0f} months ago"})

    if derived.get("slop_risk", 0) >= 0.6:
        reasons.append(
            {"sign": "bad", "text": "report flood vs resolution — slop risk (experimental)"}
        )

    return reasons[:5]


def _stats(programs: list[dict[str, Any]]) -> dict[str, Any]:
    if not programs:
        return {}
    scores = sorted(p["score"]["total"] for p in programs)
    tiers = {"green": 0, "yellow": 0, "red": 0, "unknown": 0}
    for program in programs:
        tiers[program["badges"]["will_pay"]["tier"]] += 1

    return {
        "count": len(programs),
        "score": {
            "min": scores[0],
            "median": scores[len(scores) // 2],
            "max": scores[-1],
        },
        "will_pay": tiers,
        "high_confidence": sum(
            1 for p in programs if p["quality"]["confidence"] == "high"
        ),
    }


def write_outputs(programs: list[dict[str, Any]], meta: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Percentile makes the absolute score readable: the population is not
    # normalised to 100, so "68.7" needs "top 6%" next to it to mean anything.
    total = len(programs)
    for index, program in enumerate(programs):
        program["score"]["percentile"] = round((1 - index / total) * 100, 1) if total else 0.0

    now = datetime.now(timezone.utc)
    payload = {
        "generated_at": now.isoformat(),
        "count": len(programs),
        "stats": _stats(programs),
        "programs": programs,
    }

    (DATA_DIR / "programs.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    meta_out = {
        **meta,
        "generated_at": now.isoformat(),
        "stats": payload["stats"],
        "files": {"programs": "data/programs.json"},
    }
    (DATA_DIR / "meta.json").write_text(
        json.dumps(meta_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
