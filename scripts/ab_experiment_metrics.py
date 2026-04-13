#!/usr/bin/env python3
"""
Compute A/B experiment metrics from tutor event logs (JSONL).

Events are produced by the JupyterLab extension via POST /events on the
DSC 10 Tutor Logging API (see src/api/logger.ts). This script expects one
JSON object per line, each shaped like the stored event record, for example:

  {"event_type": "exp_turn_start", "user_email": "...", "payload": {...}}

Obtaining data
--------------
There is no anonymous bulk JSON export in the public OpenAPI spec; use a DB
export, internal tooling, or an authenticated pipeline that dumps the same
fields the API persists. Merge multiple shards with repeated ``--input``.

For NRP (``kubectl`` to namespace ``dsc-10-llm``), see
``scripts/export_events_from_k8s.sh`` which dumps ``public.events`` from
Postgres to JSONL.

Usage
-----
  python scripts/ab_experiment_metrics.py -i events.jsonl
  python scripts/ab_experiment_metrics.py -i 'part-*.jsonl'
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable


PayloadPredicate = Callable[[dict[str, Any]], bool]


def _payload(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("payload")
    return raw if isinstance(raw, dict) else {}


def load_jsonl(paths: Iterable[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in paths:
        if str(path) == "-":
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                rows.append(json.loads(line))
            continue
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rows.append(json.loads(line))
    return rows


def variant_of(event: dict[str, Any]) -> str | None:
    v = _payload(event).get("variant")
    if v in ("A", "B"):
        return v
    return None


def user_key(event: dict[str, Any]) -> str:
    p = _payload(event)
    h = p.get("student_key_hash")
    if isinstance(h, str) and h:
        return f"hash:{h}"
    email = event.get("user_email")
    if isinstance(email, str) and email:
        return f"email:{email}"
    return "unknown"


@dataclass
class VariantStats:
    count: int = 0
    users: set[str] = field(default_factory=set)

    def add(self, event: dict[str, Any]) -> None:
        self.count += 1
        self.users.add(user_key(event))


def count_by_variant(
    events: list[dict[str, Any]],
    predicate: PayloadPredicate,
) -> dict[str, VariantStats]:
    by_v: dict[str, VariantStats] = defaultdict(VariantStats)
    for e in events:
        if e.get("event_type") is None:
            continue
        if not predicate(_payload(e)):
            continue
        v = variant_of(e)
        if v is None:
            by_v["_missing_variant"].add(e)
        else:
            by_v[v].add(e)
    return dict(by_v)


def ratio(num: int, den: int) -> float | None:
    if den == 0:
        return None
    return num / den


def report_follow_up(events: list[dict[str, Any]]) -> dict[str, Any]:
    exp = "exp_follow_up"

    def in_exp(p: dict[str, Any]) -> bool:
        return p.get("experiment_id") == exp

    turn_events = [
        e
        for e in events
        if e.get("event_type") == "exp_turn_start" and in_exp(_payload(e))
    ]
    turns = count_by_variant(turn_events, lambda p: True)

    impressions = count_by_variant(
        [e for e in events if e.get("event_type") == "exp_follow_up_impression"],
        in_exp,
    )
    follow_tab = count_by_variant(
        [e for e in events if e.get("event_type") == "follow_up_question"],
        in_exp,
    )
    return {
        "experiment_id": exp,
        "denominator": "exp_turn_start (payload.experiment_id = exp_follow_up)",
        "turns_by_variant": {k: {"events": v.count, "unique_users": len(v.users)} for k, v in turns.items()},
        "exp_follow_up_impression": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in impressions.items()
        },
        "follow_up_question": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in follow_tab.items()
        },
        "rates_vs_turns": {
            v: {
                "follow_up_question_rate": ratio(
                    follow_tab.get(v, VariantStats()).count,
                    turns.get(v, VariantStats()).count,
                ),
            }
            for v in ("A", "B")
        },
    }


def report_practice(events: list[dict[str, Any]]) -> dict[str, Any]:
    exp = "exp_practice_problems"

    def in_exp(p: dict[str, Any]) -> bool:
        return p.get("experiment_id") == exp

    # Eligible turns: practice intent during this experiment
    eligible = [
        e
        for e in events
        if e.get("event_type") == "exp_turn_start"
        and in_exp(_payload(e))
        and _payload(e).get("is_practice_intent") is True
    ]
    turns = count_by_variant(eligible, lambda p: True)

    impressions = count_by_variant(
        [e for e in events if e.get("event_type") == "exp_practice_impression"],
        in_exp,
    )
    clicks = count_by_variant(
        [e for e in events if e.get("event_type") == "exp_practice_click"],
        in_exp,
    )
    return {
        "experiment_id": exp,
        "denominator": "exp_turn_start with is_practice_intent=true",
        "eligible_practice_turns_by_variant": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in turns.items()
        },
        "exp_practice_impression": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in impressions.items()
        },
        "exp_practice_click": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in clicks.items()
        },
        "rates_vs_eligible_turns": {
            v: {
                "impression_rate": ratio(
                    impressions.get(v, VariantStats()).count,
                    turns.get(v, VariantStats()).count,
                ),
                "click_rate": ratio(
                    clicks.get(v, VariantStats()).count,
                    turns.get(v, VariantStats()).count,
                ),
            }
            for v in ("A", "B")
        },
    }


def report_lectures(events: list[dict[str, Any]]) -> dict[str, Any]:
    exp = "exp_relevant_lectures"

    def in_exp(p: dict[str, Any]) -> bool:
        return p.get("experiment_id") == exp

    turn_events = [
        e
        for e in events
        if e.get("event_type") == "exp_turn_start" and in_exp(_payload(e))
    ]
    turns = count_by_variant(turn_events, lambda p: True)

    impressions = count_by_variant(
        [e for e in events if e.get("event_type") == "exp_lectures_impression"],
        in_exp,
    )
    toggles = count_by_variant(
        [e for e in events if e.get("event_type") == "lecture_dropdown_toggle"],
        in_exp,
    )
    opens = count_by_variant(
        [e for e in events if e.get("event_type") == "lecture_open_in_notebook"],
        in_exp,
    )
    return {
        "experiment_id": exp,
        "denominator": "exp_turn_start (payload.experiment_id = exp_relevant_lectures)",
        "turns_by_variant": {k: {"events": v.count, "unique_users": len(v.users)} for k, v in turns.items()},
        "exp_lectures_impression": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in impressions.items()
        },
        "lecture_dropdown_toggle": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in toggles.items()
        },
        "lecture_open_in_notebook": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in opens.items()
        },
        "rates_vs_turns": {
            v: {
                "impression_rate": ratio(
                    impressions.get(v, VariantStats()).count,
                    turns.get(v, VariantStats()).count,
                ),
                "open_rate": ratio(
                    opens.get(v, VariantStats()).count,
                    turns.get(v, VariantStats()).count,
                ),
            }
            for v in ("A", "B")
        },
    }


def report_exam_mode(events: list[dict[str, Any]]) -> dict[str, Any]:
    exp = "exp_exam_mode"

    def in_exp(p: dict[str, Any]) -> bool:
        return p.get("experiment_id") == exp

    turns = count_by_variant(
        [
            e
            for e in events
            if e.get("event_type") == "exp_turn_start" and in_exp(_payload(e))
        ],
        lambda p: True,
    )
    activated = count_by_variant(
        [e for e in events if e.get("event_type") == "exp_exam_mode_activated"],
        in_exp,
    )
    duration_events = count_by_variant(
        [e for e in events if e.get("event_type") == "exp_exam_mode_duration"],
        in_exp,
    )
    return {
        "experiment_id": exp,
        "denominator": "exp_turn_start + feature-specific activation/duration events",
        "turns_by_variant": {k: {"events": v.count, "unique_users": len(v.users)} for k, v in turns.items()},
        "exp_exam_mode_activated": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in activated.items()
        },
        "exp_exam_mode_duration": {
            k: {"events": v.count, "unique_users": len(v.users)} for k, v in duration_events.items()
        },
        "activation_rate_vs_turns": {
            v: ratio(
                activated.get(v, VariantStats()).count,
                turns.get(v, VariantStats()).count,
            )
            for v in ("A", "B")
        },
    }


REPORTERS = {
    "exp_follow_up": report_follow_up,
    "exp_practice_problems": report_practice,
    "exp_relevant_lectures": report_lectures,
    "exp_exam_mode": report_exam_mode,
}


def print_text(reports: list[dict[str, Any]]) -> None:
    import pprint

    for r in reports:
        print("=" * 72)
        pprint.pprint(r, width=100, sort_dicts=False)
        print()


def expand_inputs(patterns: list[str]) -> list[Path]:
    paths: list[Path] = []
    for p in patterns:
        if p == "-":
            paths.append(Path("-"))
            continue
        path = Path(p)
        if any(ch in p for ch in "*?["):
            paths.extend(sorted(Path().glob(p)))
            continue
        paths.append(path)
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Aggregate A/B tutor experiment metrics from JSONL event exports."
    )
    parser.add_argument(
        "-i",
        "--input",
        action="append",
        required=True,
        help="JSONL file path, glob, or - for stdin (repeatable)",
    )
    args = parser.parse_args()

    paths = expand_inputs(args.input)
    for path in paths:
        if str(path) != "-" and not path.exists():
            print(f"Missing input file: {path}", file=sys.stderr)
            return 1

    events = load_jsonl(paths)
    reports = [REPORTERS[eid](events) for eid in sorted(REPORTERS)]
    print_text(reports)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
