"""Topic normalization: maps student queries to lecture numbers."""

import json
import logging
import os
import re
from pathlib import Path
from typing import List, Optional

import google.generativeai as genai
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

backend_dir = Path(__file__).parent.parent
root_dir = backend_dir.parent

load_dotenv(dotenv_path=root_dir / ".env")
load_dotenv(dotenv_path=backend_dir / ".env", override=False)


DATA_DIR = backend_dir / "data"
MAPPING_FILE = DATA_DIR / "topic_to_lecture.json"

OFFICIAL_TOPICS = [
    "Expressions and Data Types",
    "Lists and Arrays",
    "DataFrames",
    "Querying and Grouping",
    "Data Visualization",
    "Distributions and Histograms",
    "Functions and Applying",
    "Grouping on Multiple Columns, Merging",
    "Conditional Statements and Iteration",
    "Probability",
    "Simulation",
    "Distributions and Sampling",
    "Bootstrapping and Confidence Intervals",
    "Confidence Intervals, Center, and Spread",
    "Standardization and the Normal Distribution",
    "Central Limit Theorem",
    "Choosing Sample Sizes, Statistical Models",
    "Hypothesis Testing",
    "Hypothesis Testing and Total Variation Distance",
    "TVD, Hypothesis Testing, and Permutation Testing",
    "Permutation Testing",
    "Correlation",
    "Regression and Least Squares",
    "Residuals and Inference",
]

def load_mapping() -> dict:
    if MAPPING_FILE.exists():
        with open(MAPPING_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_mapping(mapping: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(MAPPING_FILE, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2, ensure_ascii=False)


_TOPIC_MAPPING = None


def _get_mapping() -> dict:
    global _TOPIC_MAPPING
    if _TOPIC_MAPPING is None:
        _TOPIC_MAPPING = load_mapping()
    return _TOPIC_MAPPING


def _normalize_for_substring_match(text: str) -> str:
    text = (text or "").lower()
    cleaned_chars: list[str] = []
    for ch in text:
        cleaned_chars.append(ch if ch.isalnum() else " ")
    cleaned = "".join(cleaned_chars)
    return " ".join(cleaned.split()).strip()


def extract_topic_from_prompt(prompt: str, mapping: Optional[dict] = None) -> Optional[str]:
    mapping = mapping if mapping is not None else _get_mapping()
    if not mapping:
        return None

    prompt_norm = _normalize_for_substring_match(prompt)
    if not prompt_norm:
        return None

    haystack = f" {prompt_norm} "

    best_key: Optional[str] = None
    best_len = -1

    for raw_key in mapping.keys():
        key_norm = _normalize_for_substring_match(str(raw_key))
        if not key_norm:
            continue
        needle = f" {key_norm} "
        if needle in haystack:
            if len(key_norm) > best_len:
                best_key = str(raw_key)
                best_len = len(key_norm)

    return best_key


def normalize_topic(query: str, use_gemini_fallback: bool = True) -> List[int]:
    query_lower = query.lower().strip()
    query_lower = re.sub(r"[.,!?;:]+$", "", query_lower).strip()
    mapping = _get_mapping()

    def remove_articles(text: str) -> str:
        if text.startswith("the "):
            text = text[4:]
        elif text.startswith("a "):
            text = text[2:]
        elif text.startswith("an "):
            text = text[3:]
        return text.strip()
    
    query_variations = [
        query_lower,  
        remove_articles(query_lower),
        query_lower.replace("the ", "").replace("a ", "").replace("an ", "").strip(), 
    ]
    
    normalized_mapping = {k.lower(): v for k, v in mapping.items()}
    
    if "practice" in query_lower:
        extracted = extract_topic_from_prompt(query_lower, mapping=mapping)
        if extracted is not None:
            extracted_lower = extracted.lower().strip()
            if extracted_lower in normalized_mapping:
                return normalized_mapping[extracted_lower]

    for variation in query_variations:
        if variation in mapping:
            return mapping[variation]
        if variation in normalized_mapping:
            return normalized_mapping[variation]
    return []
