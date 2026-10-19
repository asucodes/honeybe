"""Catalog sources.

The catalog is deliberately separate from the scored ranking:

* Scored programs (HackerOne only) come from the GraphQL pipeline.
* The catalog is every other program we can find, with an explicit coverage
  record per row. Catalog rows are never given a payout score.

Sources:
  arkadiyt/bounty-targets-data  - platform dumps for HackerOne, Bugcrowd,
                                  Intigriti and YesWeHack.
  lissy93/bug-bounties          - community maintained YAML of independent
                                  and platform programs.

Both are commit-SHA gated and cached, so a 6-hourly run does not re-download
tens of megabytes unless upstream actually changed.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
import yaml

CACHE_DIR = Path("data/cache")
TIMEOUT = 120
HEADERS = {"User-Agent": "honeybe/0.2 (+https://github.com/)"}

ARKADIYT = "https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data"
LISSY = "https://raw.githubusercontent.com/lissy93/bug-bounties/main"

PLATFORM_FILES = {
    "hackerone": "hackerone_data.json",
    "bugcrowd": "bugcrowd_data.json",
    "intigriti": "intigriti_data.json",
    "yeswehack": "yeswehack_data.json",
}

MAX_SCOPE_TYPES = 8


def _sha(session: requests.Session, repo: str, path: str) -> str | None:
    url = f"https://api.github.com/repos/{repo}/commits?path={path}&per_page=1"
    try:
        response = session.get(url, headers={**HEADERS, "Accept": "application/vnd.github+json"}, timeout=30)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, list) and payload:
            return payload[0]["sha"]
    except Exception:
        return None
    return None


def _cached_json(name: str) -> Any | None:
    path = CACHE_DIR / name
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _store_json(name: str, payload: Any) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (CACHE_DIR / name).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _get(session: requests.Session, url: str) -> requests.Response:
    return session.get(url, headers=HEADERS, timeout=TIMEOUT)


# ---------- scope helpers ----------

def _scope_types(targets: dict[str, Any] | None) -> list[str]:
    seen: list[str] = []
    for item in (targets or {}).get("in_scope") or []:
        raw = (item.get("type") or item.get("asset_type") or "").strip().lower()
        if not raw:
            continue
        mapped = _map_type(raw)
        if mapped not in seen:
            seen.append(mapped)
    return seen[:MAX_SCOPE_TYPES]


def _map_type(raw: str) -> str:
    raw = raw.replace("_", "-")
    if "api" in raw:
        return "api"
    if "mobile" in raw or "android" in raw or "ios" in raw:
        return "mobile"
    if "ip" in raw or "cidr" in raw or "network" in raw:
        return "network"
    if "cloud" in raw:
        return "cloud"
    if "source" in raw or "code" in raw:
        return "source"
    if "hardware" in raw:
        return "hardware"
    if "smart" in raw or "contract" in raw or "blockchain" in raw:
        return "smart_contract"
    if "ai" in raw or "model" in raw:
        return "ai"
    if "web" in raw or "url" in raw or "domain" in raw or "wildcard" in raw:
        return "web"
    return "other"


def _slug_from_url(url: str) -> str:
    path = re.sub(r"https?://[^/]+/", "", url or "").strip("/")
    path = path.split("?")[0].split("#")[0]
    parts = [p for p in path.split("/") if p]
    return (parts[-1] if parts else "").lower()


def _domain(url: str) -> str:
    match = re.match(r"https?://([^/]+)", url or "")
    if not match:
        return (url or "").strip().lower()
    host = match.group(1).lower()
    return host[4:] if host.startswith("www.") else host


# ---------- platform adapters ----------

def _arkadiyt(session: requests.Session, platform: str) -> list[dict[str, Any]]:
    filename = PLATFORM_FILES[platform]
    cache_name = f"catalog_{platform}.json"
    sha = _sha(session, "arkadiyt/bounty-targets-data", f"data/{filename}")
    sha_file = CACHE_DIR / f"catalog_{platform}.sha"

    cached = _cached_json(cache_name)
    if cached is not None:
        known = sha_file.read_text(encoding="utf-8").strip() if sha_file.exists() else None
        if sha and known == sha:
            return cached

    try:
        response = _get(session, f"{ARKADIYT}/{filename}")
        response.raise_for_status()
        records = response.json()
    except Exception:
        return cached or []

    out: list[dict[str, Any]] = []
    for record in records:
        name = (record.get("name") or "").strip()
        url = (record.get("url") or "").strip()
        if platform == "yeswehack" and not url:
            url = f"https://yeswehack.com/programs/{record.get('id')}"
        if not name or not url:
            continue

        if platform == "hackerone":
            slug = (record.get("handle") or "").strip().lower()
            bounty = record.get("offers_bounties")
            max_payout = None
            harbor = None
        elif platform == "bugcrowd":
            slug = _slug_from_url(url)
            bounty = True  # every Bugcrowd engagement listed here is a bounty program
            max_payout = record.get("max_payout")
            harbor = (record.get("safe_harbor") or "").lower() or None
        elif platform == "intigriti":
            slug = (record.get("handle") or "").strip().lower()
            max_payout = record.get("max_bounty")
            bounty = bool(max_payout) or bool(record.get("min_bounty"))
            harbor = None
        else:  # yeswehack
            slug = str(record.get("id") or "").strip().lower()
            max_payout = record.get("max_bounty")
            bounty = bool(max_payout) or bool(record.get("min_bounty"))
            harbor = None
            if not url:
                url = f"https://yeswehack.com/programs/{slug}"

        targets = record.get("targets") or {}
        in_scope = targets.get("in_scope") or []
        out.append({
            "platform": platform,
            "slug": slug or _slug_from_url(url),
            "name": name,
            "url": url,
            "offers_bounty": bounty if isinstance(bounty, bool) else None,
            "max_payout": max_payout if isinstance(max_payout, (int, float)) else None,
            "safe_harbor": harbor,
            "scope_count": len(in_scope),
            "scope_types": _scope_types(targets),
            "source": "arkadiyt",
        })

    _store_json(cache_name, out)
    if sha:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        sha_file.write_text(sha, encoding="utf-8")
    return out


def _lissy93(session: requests.Session) -> list[dict[str, Any]]:
    cache_name = "catalog_lissy93.json"
    cached = _cached_json(cache_name)
    sha = _sha(session, "lissy93/bug-bounties", "platform-programs.yml")
    sha_file = CACHE_DIR / "catalog_lissy93.sha"

    if cached is not None:
        known = sha_file.read_text(encoding="utf-8").strip() if sha_file.exists() else None
        if sha and known == sha:
            return cached

    out: list[dict[str, Any]] = []
    for filename, kind in (("platform-programs.yml", "platform"), ("independent-programs.yml", "independent")):
        try:
            response = _get(session, f"{LISSY}/{filename}")
            response.raise_for_status()
            payload = yaml.safe_load(response.text) or {}
        except Exception:
            continue

        for item in payload.get("companies") or []:
            name = (item.get("company") or "").strip()
            url = (item.get("url") or "").strip()
            if not name or not url:
                continue

            rewards = [str(r) for r in (item.get("rewards") or [])]
            bounty = any("bounty" in r for r in rewards) or bool(item.get("max_payout"))
            scope = item.get("scope") or []
            if isinstance(scope, dict):
                scope = scope.get("in_scope") or []
            domains = item.get("domains") or []

            out.append({
                "platform": "direct" if kind == "independent" else "platform",
                "slug": _domain(url),
                "name": name,
                "url": url,
                "offers_bounty": bounty if rewards or item.get("max_payout") else None,
                "max_payout": item.get("max_payout") if isinstance(item.get("max_payout"), (int, float)) else None,
                "safe_harbor": (item.get("safe_harbor") or "").lower() or None,
                "scope_count": len(scope) or len(domains),
                "scope_types": _scope_types({"in_scope": scope}) if scope else (["web"] if domains else []),
                "source": "lissy93",
            })

    _store_json(cache_name, out)
    if sha:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        sha_file.write_text(sha, encoding="utf-8")
    return out


# ---------- merge + rank ----------

PLATFORM_LABELS = {
    "hackerone": "HackerOne",
    "bugcrowd": "Bugcrowd",
    "intigriti": "Intigriti",
    "yeswehack": "YesWeHack",
    "platform": "Platform",
    "direct": "Direct",
}


def build_catalog(scored_ids: set[str] | None = None) -> dict[str, Any]:
    session = requests.Session()
    rows: dict[str, dict[str, Any]] = {}

    for platform in PLATFORM_FILES:
        for row in _arkadiyt(session, platform):
            key = f"{row['platform']}:{row['slug']}"
            row["id"] = key
            rows[key] = row

    for row in _lissy93(session):
        key = f"{row['platform']}:{row['slug']}"
        if key in rows:
            # Merge: keep the platform record, note the second source.
            existing = rows[key]
            existing.setdefault("_sources", set()).add("lissy93")
            if not existing.get("max_payout") and row.get("max_payout"):
                existing["max_payout"] = row["max_payout"]
            if not existing.get("safe_harbor") and row.get("safe_harbor"):
                existing["safe_harbor"] = row["safe_harbor"]
        else:
            row["id"] = key
            rows[key] = row

    scored_ids = scored_ids or set()

    # First-seen tracking. This is the only honest basis for a "latest"
    # ordering, because none of the catalog sources publish a launch date.
    seen_path = CACHE_DIR / "catalog_seen.json"
    prior: dict[str, str] = {}
    if seen_path.exists():
        try:
            prior = json.loads(seen_path.read_text(encoding="utf-8"))
        except Exception:
            prior = {}
    baseline = not prior
    today = datetime.now(timezone.utc).date().isoformat()

    programs = []
    for row in rows.values():
        sources = set(row.pop("_sources", set()) or set())
        source = row.pop("source", None)
        if source:
            sources.add(source)
        sources.add("arkadiyt" if row.get("platform") in PLATFORM_FILES else "lissy93")
        row["sources"] = sorted(sources)
        row["scored"] = row["id"] in scored_ids
        row["catalog_score"] = catalog_score(row)
        row["coverage"] = {
            "bounty": row.get("offers_bounty") is not None,
            "payout": row.get("max_payout") is not None,
            "scope": (row.get("scope_count") or 0) > 0,
            "harbor": row.get("safe_harbor") is not None,
        }
        row["coverage_pct"] = coverage_pct(row)
        row["first_seen"] = prior.get(row["id"], today)
        row["new"] = (not baseline) and row["id"] not in prior
        programs.append(row)

    seen = {row["id"]: row["first_seen"] for row in programs}
    for stale_id, date in prior.items():
        seen.setdefault(stale_id, date)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    seen_path.write_text(json.dumps(seen, ensure_ascii=False), encoding="utf-8")

    programs.sort(key=lambda r: (-r["catalog_score"], -(r.get("scope_count") or 0), r["name"].lower()))
    for index, row in enumerate(programs):
        row["catalog_rank"] = index + 1

    by_platform: dict[str, int] = {}
    for row in programs:
        by_platform[row["platform"]] = by_platform.get(row["platform"], 0) + 1

    return {
        "generated_at": None,  # filled by the caller
        "counts": {
            "total": len(programs),
            "by_platform": by_platform,
            "with_scope": sum(1 for r in programs if (r.get("scope_count") or 0) > 0),
            "with_payout": sum(1 for r in programs if r.get("max_payout") is not None),
            "new_since_last": sum(1 for r in programs if r.get("new")),
            "baseline": baseline,
        },
        "programs": programs,
    }


def catalog_score(row: dict[str, Any]) -> float:
    """0..100. Explicit, documented in docs/SCORING.md.

    This is a catalog ordering, not a payout prediction. Points are normalised
    over the fields we actually know, so a missing payout figure neither helps
    nor hurts; the row's coverage flags say what was missing.
    """
    points = 0.0
    weights = 0.0

    bounty = row.get("offers_bounty")
    weights += 45
    if bounty is True:
        points += 45
    elif bounty is False:
        points += 15

    scope = max(0, int(row.get("scope_count") or 0))
    weights += 30
    points += 30 * min(1.0, math.log1p(scope) / math.log1p(400))

    types = len(row.get("scope_types") or [])
    if types:
        weights += 15
        points += 15 * min(1.0, types / 6)

    harbor = (row.get("safe_harbor") or "").lower()
    if harbor in ("full", "partial"):
        weights += 10
        points += 10 if harbor == "full" else 5

    payout = row.get("max_payout")
    if isinstance(payout, (int, float)) and payout > 0:
        weights += 10
        points += 10 * min(1.0, math.log1p(payout) / math.log1p(1_000_000))

    if weights <= 0:
        return 0.0
    return round(min(100.0, 100 * points / weights), 1)


def coverage_pct(row: dict[str, Any]) -> int:
    checks = [
        row.get("offers_bounty") is not None,
        row.get("max_payout") is not None,
        (row.get("scope_count") or 0) > 0,
        row.get("safe_harbor") is not None,
    ]
    return round(100 * sum(1 for c in checks if c) / len(checks))
