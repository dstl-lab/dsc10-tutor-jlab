"""Retrieval system for practice problems."""

import json
from pathlib import Path
from typing import Dict, List

from .normalizer import normalize_topic
from .ranker import rank_problems_by_relevance

DATA_DIR = Path(__file__).parent.parent / "data"
PROBLEMS_FILE = DATA_DIR / "lecture_problems.json"

_PROBLEMS_INDEX = None


def load_problems_index() -> Dict[int, List[Dict]]:
    global _PROBLEMS_INDEX
    
    if _PROBLEMS_INDEX is not None:
        return _PROBLEMS_INDEX
    
    if not PROBLEMS_FILE.exists():
        return {}
    
    with open(PROBLEMS_FILE, "r", encoding="utf-8") as f:
        _PROBLEMS_INDEX = json.load(f)
        _PROBLEMS_INDEX = {int(k): v for k, v in _PROBLEMS_INDEX.items()}
        return _PROBLEMS_INDEX


def get_practice_problems(
    topic_query: str,
    max_problems: int = 5,
    use_gemini_fallback: bool = True,
    rank_by_relevance: bool = True
) -> List[Dict]:
    """
    Get practice problems for a given topic query.
    """
    lecture_numbers = normalize_topic(topic_query, use_gemini_fallback=use_gemini_fallback)
    
    if not lecture_numbers:
        return []
    
    problems_index = load_problems_index()
    
    if not problems_index:
        return []
    
    candidate_problems = []
    for lecture_num in lecture_numbers:
        if lecture_num in problems_index:
            candidate_problems.extend(problems_index[lecture_num])
    
    if not candidate_problems:
        return []
    
    if rank_by_relevance and len(candidate_problems) > max_problems:
        ranked_problems = rank_problems_by_relevance(
            candidate_problems,
            topic_query,
            max_problems=max_problems,
            use_gemini=use_gemini_fallback
        )
        return ranked_problems
    
    return candidate_problems[:max_problems]


def get_problems_by_lecture(lecture_numbers: List[int]) -> List[Dict]:
    """Get problems for specific lecture numbers."""
    problems_index = load_problems_index()
    results = []
    
    for lecture_num in lecture_numbers:
        if lecture_num in problems_index:
            results.extend(problems_index[lecture_num])
    
    return results

