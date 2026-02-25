import re
from typing import Optional, Tuple


PRACTICE_PATTERNS = [
    r"practice\s+(?:on|with|for|about)\s+(.+)",
    r"practice\s+(.+)",
    r"problems?\s+(?:on|with|for|about|regarding)\s+(.+)",
    r"problems?\s+(?:for|with)\s+(.+)",
    r"give\s+me\s+(?:practice\s+)?problems?\s+(?:on|about|for)\s+(.+)",
    r"i\s+want\s+(?:practice|problems?)\s+(?:on|about|for)\s+(.+)",
    r"i\s+need\s+(?:practice|problems?)\s+(?:on|about|for)\s+(.+)",
    r"help\s+me\s+practice\s+(.+)",
    r"more\s+practice\s+(?:on|with|for|about)\s+(.+)",
    r"exercises?\s+(?:on|about|for)\s+(.+)",
    r"i\s+want\s+to\s+practice\s+(.+)",
    r"can\s+you\s+give\s+me\s+(?:practice\s+)?problems?\s+(?:on|about|for)\s+(.+)",
]


def detect_practice_intent(query: str) -> Optional[Tuple[str, str]]:
    """
    Detect if a query is asking for practice problems.
    
    """
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

