"""Orchestrator: crawl -> normalise -> badge -> score -> emit.

Run with:
    python -m pipeline.run
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timezone

import requests

from . import emit
from .badges import apply_badges, slop_risk
from .normalize import normalize_hackerone
from .score import score_program
from .sources import arkadiyt, hackerone

CADENCE_HOURS = 6


def main() -> int:
    # Windows consoles default to cp1252 and choke on the arrows below.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    started = time.time()
    now = datetime.now(timezone.utc)
    session = requests.Session()

    print("honeybee · crawl start")

    print("  → hackerone signals")
    nodes, total = hackerone.fetch_programs(session)
    print(f"    {len(nodes)}/{total} paid + open programs")

    print("  → arkadiyt scope")
    scope_by_handle = arkadiyt.fetch_scope(session)
    print(f"    {len(scope_by_handle)} programs in scope dump")

    programs = []
    for node in nodes:
        program = normalize_hackerone(node, scope_by_handle, now)
        risk = slop_risk(program["signals"])
        apply_badges(program)
        score_program(program, risk)
        program["reasons"] = emit.build_reasons(program)
        programs.append(program)

    programs.sort(key=lambda p: p["score"]["total"], reverse=True)

    emit.write_outputs(
        programs,
        {
            "name": "honeybee",
            "version": "0.2.0",
            "cadence_hours": CADENCE_HOURS,
            "scoring": "population v1 (HackerOne signals)",
            "slop_experimental": True,
        },
    )

    print("  -> catalog merge")
    cat = None
    try:
        from .sources import catalog as catalog_source

        scored_ids = {p["id"] for p in programs}
        cat = catalog_source.build_catalog(scored_ids)
        cat["generated_at"] = now.isoformat()
        emit.write_catalog(cat)
        print(
            f"    {cat['counts']['total']} catalog programs "
            f"({', '.join(f'{k} {v}' for k, v in sorted(cat['counts']['by_platform'].items()))})"
        )
    except Exception as exc:  # a catalog failure must never break the ranking
        print(f"    catalog skipped: {exc}")

    print("  -> change feed")
    try:
        from . import events

        feed = events.build(programs, cat, now)
        label = "baseline" if feed["baseline"] else f"{feed['count']} new events"
        print(f"    {label}, {feed['total']} stored")
    except Exception as exc:
        print(f"    events skipped: {exc}")

    elapsed = time.time() - started
    print(f"  ✓ wrote {len(programs)} programs in {elapsed:.1f}s")
    if programs:
        top = programs[0]
        print(f"  top: {top['name']} ({top['score']['total']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
