"""arkadiyt/bounty-targets-data — scope dumps, refreshed upstream every 30 minutes.

Used for **scope only**. This source carries no report counts and no launch dates.

The HackerOne dump is ~19 MB. Downloading that every run would burn ~27 GB/month
for no benefit, so we ask GitHub for the file's latest commit SHA first and only
download when it actually changed.

Cache layout:
    data/cache/arkadiyt.sha          last seen commit sha
    data/cache/arkadiyt_h1.json      parsed {handle: [scope asset, ...]}
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import requests

RAW_BASE = "https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data"
COMMITS_API = (
    "https://api.github.com/repos/arkadiyt/bounty-targets-data/commits"
    "?path=data/hackerone_data.json&per_page=1"
)

TIMEOUT = 120
HEADERS = {
    "User-Agent": "honeybe/0.1 (+https://github.com/)",
    "Accept": "application/vnd.github+json",
}

CACHE_DIR = Path("data/cache")
SHA_FILE = CACHE_DIR / "arkadiyt.sha"
H1_CACHE = CACHE_DIR / "arkadiyt_h1.json"

# Keep the emitted scope compact. 400 assets is far more than any single
# hunting session needs, and it keeps the static payload small.
MAX_SCOPE_ASSETS = 400


def _remote_sha(session: requests.Session) -> str | None:
    try:
        response = session.get(COMMITS_API, headers=HEADERS, timeout=TIMEOUT)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, list) and payload:
            return payload[0]["sha"]
    except Exception:
        return None
    return None


def _trim_scope(raw_targets: dict[str, Any]) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    for item in raw_targets.get("in_scope") or []:
        identifier = item.get("asset_identifier")
        if not identifier:
            continue
        assets.append(
            {
                "asset": identifier,
                "type": (item.get("asset_type") or "OTHER").upper(),
                "bounty": bool(item.get("eligible_for_bounty")),
                "severity": item.get("max_severity"),
                "instruction": (item.get("instruction") or "").strip()[:200] or None,
            }
        )
        if len(assets) >= MAX_SCOPE_ASSETS:
            break
    return assets


def fetch_scope(session: requests.Session | None = None) -> dict[str, list[dict[str, Any]]]:
    """Return {hackerone_handle: [scope assets]}.

    Falls back to the on-disk cache when the network or GitHub API fails, so a
    transient upstream problem never empties the product.
    """
    session = session or requests.Session()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    remote_sha = _remote_sha(session)
    cached_sha = SHA_FILE.read_text(encoding="utf-8").strip() if SHA_FILE.exists() else None

    if remote_sha and remote_sha == cached_sha and H1_CACHE.exists():
        return json.loads(H1_CACHE.read_text(encoding="utf-8"))

    if not remote_sha and H1_CACHE.exists():
        # GitHub API rate-limited or down: use what we have.
        return json.loads(H1_CACHE.read_text(encoding="utf-8"))

    try:
        response = session.get(
            f"{RAW_BASE}/hackerone_data.json", headers=HEADERS, timeout=TIMEOUT
        )
        response.raise_for_status()
        records = response.json()
    except Exception:
        if H1_CACHE.exists():
            return json.loads(H1_CACHE.read_text(encoding="utf-8"))
        return {}

    scope: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        handle = record.get("handle")
        if not handle:
            continue
        scope[handle] = _trim_scope(record.get("targets") or {})

    H1_CACHE.write_text(json.dumps(scope, ensure_ascii=False), encoding="utf-8")
    if remote_sha:
        SHA_FILE.write_text(remote_sha, encoding="utf-8")

    return scope
