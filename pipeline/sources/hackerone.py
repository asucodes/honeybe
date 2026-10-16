"""HackerOne public GraphQL source.

This is the only source in honeybee that provides scoring *signals*.

Verified live on 2026-10-20:
    220 paid + open programs
    3 requests (100 per page)
    126 KB payload
    ~10 s wall time

Fields that DO work unauthenticated are listed in QUERY below.

Fields that DO NOT work unauthenticated (verified, do not re-add):
    bounty_competitiveness_percentile  -> requires an input object; it is a calculator
    first_response_time                -> null
    resolution_time                    -> null
    bounty_time                        -> null
    triage_time                        -> null
    bounties_total                     -> returns the string "0"
"""

from __future__ import annotations

import time
from typing import Any

import requests

GRAPHQL_URL = "https://hackerone.com/graphql"
PAGE_SIZE = 100
MAX_PAGES = 10
TIMEOUT = 40
RETRIES = 3

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
    "Accept": "application/json",
}

QUERY = """
query HoneybeeTeams($first: Int!, $after: String) {
  teams(
    first: $first
    after: $after
    where: {offers_bounties: {_eq: true}, submission_state: {_eq: open}}
  ) {
    total_count
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        handle
        name
        launched_at
        offers_bounties
        submission_state
        state
        reports_received_last_90_days
        resolved_report_count
        average_bounty_lower_amount
        average_bounty_upper_amount
        minimum_bounty
        response_efficiency_percentage
        response_efficiency_indicator
        formatted_total_bounties_paid_amount
        formatted_bounties_paid_last_90_days
        last_report_resolved_at
        structured_scopes(first: 1) { total_count }
      }
    }
  }
}
"""


class SourceError(RuntimeError):
    """Raised when HackerOne cannot be read."""


def _post(session: requests.Session, payload: dict[str, Any]) -> dict[str, Any]:
    last_error: Exception | None = None

    for attempt in range(1, RETRIES + 1):
        try:
            response = session.post(
                GRAPHQL_URL, json=payload, headers=HEADERS, timeout=TIMEOUT
            )
            response.raise_for_status()
            body = response.json()
        except Exception as exc:  # network, HTTP, JSON
            last_error = exc
            if attempt < RETRIES:
                time.sleep(2 ** attempt)
            continue

        if body.get("errors"):
            raise SourceError(f"HackerOne GraphQL error: {body['errors'][:2]}")
        if "data" not in body or not body["data"] or "teams" not in body["data"]:
            raise SourceError(f"Unexpected HackerOne response: {str(body)[:300]}")
        return body["data"]

    raise SourceError(f"HackerOne unreachable after {RETRIES} attempts: {last_error}")


def fetch_programs(
    session: requests.Session | None = None,
    page_size: int = PAGE_SIZE,
) -> tuple[list[dict[str, Any]], int]:
    """Return (program nodes, total_count) for paid + open HackerOne programs."""
    session = session or requests.Session()
    programs: list[dict[str, Any]] = []
    after: str | None = None
    total = 0

    for page in range(1, MAX_PAGES + 1):
        data = _post(
            session,
            {"query": QUERY, "variables": {"first": page_size, "after": after}},
        )
        teams = data["teams"]
        total = teams["total_count"]

        for edge in teams["edges"]:
            programs.append(edge["node"])

        page_info = teams["pageInfo"]
        if not page_info["hasNextPage"]:
            break

        after = page_info["endCursor"]
        # Be a polite crawler: 3 requests total, but no bursts.
        time.sleep(0.4)
    else:
        raise SourceError(f"Pagination did not terminate after {MAX_PAGES} pages")

    if total and len(programs) != total:
        raise SourceError(f"Expected {total} programs, collected {len(programs)}")

    return programs, total
