import json
import logging
import time
from datetime import datetime, timezone
from typing import Any


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_perf_ns() -> int:
    return time.perf_counter_ns()


def elapsed_ms(start_ns: int, end_ns: int | None = None) -> float:
    end = end_ns if end_ns is not None else now_perf_ns()
    return round((end - start_ns) / 1_000_000, 3)


def estimate_token_count(text: str | None) -> int | None:
    if text is None:
        return None
    cleaned = text.strip()
    if not cleaned:
        return 0
    # Fast heuristic for observability when provider token usage isn't available.
    return len(cleaned.split())


def log_json(logger: logging.Logger, event: str, **fields: Any) -> None:
    payload = {
        "event": event,
        "timestamp_utc": now_iso_utc(),
        **fields,
    }
    logger.info(json.dumps(payload, default=str))
