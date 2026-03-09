import json
import re
from pathlib import Path
from typing import Optional, Tuple

PATTERNS_FILE = Path(__file__).parent.parent.parent / "src" / "utils" / "practice_patterns.json"

def _load_patterns() -> list[str]:
    if PATTERNS_FILE.exists():
        with open(PATTERNS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

PRACTICE_PATTERNS = _load_patterns()


def detect_practice_intent(query: str) -> Optional[Tuple[str, str]]:
    query_lower = query.lower().strip()
    
    for pattern in PRACTICE_PATTERNS:
        match = re.search(pattern, query_lower, re.IGNORECASE)
        if match:
            topic = match.group(1).strip()
            if topic and len(topic) > 2: 
                return (topic, query)
    
    return None


def is_practice_request(query: str) -> bool:
    return detect_practice_intent(query) is not None

