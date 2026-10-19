"""Change feed.

Each run writes a compact snapshot of the scored programs (id, name, scope
assets) and the catalog ids. The next run diffs against it and emits events:

* new_program: a scored HackerOne program that was not there before
* new_catalog_program: a catalog row seen for the first time
* new_asset: a scope asset added to a scored program
* removed_asset: a scope asset removed from a scored program

The snapshot lives in data/cache, which the Action restores between runs.
Events accumulate in public/data/events.json, newest first, capped at 200.
On the very first run there is no snapshot, so the file is written with an
empty list and `baseline: true` instead of pretending everything is new.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CACHE = Path("data/cache")
SNAPSHOT = CACHE / "snapshot.json"
EVENTS = Path("public/data/events.json")
MAX_EVENTS = 200
MAX_ASSETS_PER_PROGRAM = 4


def _scope_keys(program: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for asset in program.get("scope") or []:
        key = f"{asset.get('asset') or ''}|{asset.get('type') or ''}"
        if key.strip("|"):
            out.append(key)
    return sorted(set(out))


def _asset_detail(key: str) -> tuple[str, str]:
    asset, _, kind = key.partition("|")
    return asset, kind or "asset"


def _event(
    kind: str,
    program: dict[str, Any],
    detail: str,
    at: str,
) -> dict[str, Any]:
    return {
        "type": kind,
        "id": program.get("id"),
        "name": program.get("name"),
        "platform": program.get("platform"),
        "url": program.get("url"),
        "detail": detail,
        "at": at,
    }


def _load(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _prior_events() -> list[dict[str, Any]]:
    payload = _load(EVENTS)
    if not isinstance(payload, dict):
        return []
    return list(payload.get("events") or [])


def build(
    programs: list[dict[str, Any]],
    catalog: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    at = now.isoformat()
    prior = _load(SNAPSHOT)
    baseline = not isinstance(prior, dict)
    events: list[dict[str, Any]] = []

    if not baseline:
        prev_programs = prior.get("programs") or {}
        prev_catalog = set(prior.get("catalog") or [])

        for program in programs:
            pid = program.get("id")
            if not pid:
                continue
            before = prev_programs.get(pid)
            if before is None:
                events.append(
                    _event("new_program", program, "new scored program", at)
                )
                continue

            old_scope = set(before.get("scope") or [])
            new_scope = set(_scope_keys(program))
            added = sorted(new_scope - old_scope)
            removed = sorted(old_scope - new_scope)

            for key in added[:MAX_ASSETS_PER_PROGRAM]:
                asset, kind = _asset_detail(key)
                events.append(
                    _event("new_asset", program, f"{asset} ({kind})", at)
                )
            if len(added) > MAX_ASSETS_PER_PROGRAM:
                events.append(
                    _event(
                        "scope_updated",
                        program,
                        f"{len(added)} assets added in this crawl",
                        at,
                    )
                )
            for key in removed[:MAX_ASSETS_PER_PROGRAM]:
                asset, kind = _asset_detail(key)
                events.append(
                    _event("removed_asset", program, f"{asset} ({kind})", at)
                )

        if catalog:
            for row in catalog.get("programs") or []:
                cid = row.get("id")
                if not cid or cid in prev_catalog:
                    continue
                events.append(
                    {
                        "type": "new_catalog_program",
                        "id": cid,
                        "name": row.get("name"),
                        "platform": row.get("platform"),
                        "url": row.get("url"),
                        "detail": "first seen in the catalog",
                        "at": at,
                    }
                )

    # Newest first, then keep older events that are not duplicated.
    seen = set()
    merged: list[dict[str, Any]] = []
    for event in events + _prior_events():
        key = (
            event.get("type"),
            event.get("id"),
            event.get("detail"),
            event.get("at"),
        )
        if key in seen:
            continue
        seen.add(key)
        merged.append(event)
        if len(merged) >= MAX_EVENTS:
            break

    payload = {
        "generated_at": at,
        "baseline": baseline,
        "count": len(events),
        "total": len(merged),
        "events": merged,
    }
    EVENTS.parent.mkdir(parents=True, exist_ok=True)
    EVENTS.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    snapshot = {
        "at": at,
        "programs": {
            p["id"]: {"name": p.get("name"), "scope": _scope_keys(p)}
            for p in programs
            if p.get("id")
        },
        "catalog": [r.get("id") for r in (catalog or {}).get("programs", []) if r.get("id")],
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(
        json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return payload
