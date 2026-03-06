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
    "Residuals and Inference"
]

GEMINI_QUERY_MAPPING_PROMPT = """A DSC 10 student wants practice problems about: "{query}"

Based on DSC 10 curriculum, map this topic to relevant lecture numbers (2-25).

OFFICIAL DSC 10 TOPICS:
{topics_list}
{existing_mappings}
Map the student's query to the relevant official topic(s) and then to lecture numbers.
Be consistent with existing mappings - if the query is similar to an existing mapping, use the same lecture numbers.

Examples:
- "conditionals" or "if statements" → "Conditional Statements and Iteration" → [14]
- "groupby" or "grouping" → "Querying and Grouping" or "Grouping on Multiple Columns" → [18]
- "tables" or "dataframes" → "DataFrames" → [6]
- "expressions" or "variables" → "Expressions and Data Types" → [2]
- "functions" or "function calls" → "Functions and Applying" → [3]
- "probability" → "Probability" → [relevant lectures]
- "hypothesis testing" → "Hypothesis Testing" → [relevant lectures]

Return ONLY a JSON list of lecture numbers. If unsure or topic doesn't exist, return empty list [].
Example responses: [14] or [14, 15] or []

JSON:"""

GEMINI_BUILD_MAPPING_PROMPT = """Analyze these DSC 10 practice problems organized by lecture (lectures 2-25).
Create a comprehensive topic → lecture mapping that covers ALL lectures.

Problems by lecture:
{problems_json}

OFFICIAL DSC 10 TOPICS (use these as reference for canonical topic names):
{topics_list}

IMPORTANT: 
- Use the official DSC 10 topic names above when they match the content
- Map each topic to ALL relevant lecture numbers where that topic appears
- A topic can map to multiple lectures if it's covered in multiple places
- Include synonyms and common ways students phrase topics (e.g., "conditionals" → "Conditional Statements and Iteration")
- Map student-friendly terms to official topics (e.g., "groupby" → "Querying and Grouping" or "Grouping on Multiple Columns")
- Be comprehensive - cover all major DSC 10 topics across all lectures

Example format:
{{
  "Conditional Statements and Iteration": [14, 15],
  "conditionals": [14, 15],
  "if statements": [14, 15],
  "if/else": [14],
  "boolean logic": [14],
  "Querying and Grouping": [18, 19],
  "groupby": [18, 19],
  "grouping": [18, 19],
  "aggregation": [18],
  "DataFrames": [6, 7],
  "tables": [6, 7],
  "dataframes": [6, 7],
  ...
}}

Return ONLY valid JSON, no markdown or explanation. Include mappings for all lectures 2-25:"""

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


def normalize_topic(query: str, use_gemini_fallback: bool = True) -> List[int]:
    query_lower = query.lower().strip()
    mapping = _get_mapping()

    def remove_articles(text: str) -> str:
        """Remove 'the ', 'a ', or 'an ' prefix if present."""
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
    
    for variation in query_variations:
        if variation in mapping:
            return mapping[variation]
        if variation in normalized_mapping:
            return normalized_mapping[variation]
    
    if use_gemini_fallback:
        lectures = get_lecture_from_gemini(query)
        
        if lectures:
            cleaned_key = query_variations[1] if len(query_variations) > 1 else query_lower
            mapping[cleaned_key] = lectures
            save_mapping(mapping)
            _TOPIC_MAPPING = mapping 
        
        return lectures
    
    return []


def get_lecture_from_gemini(query: str) -> List[int]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Warning: GEMINI_API_KEY not set, cannot use Gemini for topic normalization")
        return []
    
    try:
        genai.configure(api_key=api_key)
        model_name = "gemini-2.5-flash"
        model = genai.GenerativeModel(model_name)
        
        existing_mapping = _get_mapping()
        
        existing_mapping_sample = {}
        if existing_mapping:
            sample_items = list(existing_mapping.items())[:10]
            existing_mapping_sample = dict(sample_items)
        
        existing_mapping_str = ""
        if existing_mapping_sample:
            existing_mapping_str = f"""
EXISTING MAPPINGS (for consistency - similar queries should map to same lectures):
{json.dumps(existing_mapping_sample, indent=2)}
"""
        
        prompt = GEMINI_QUERY_MAPPING_PROMPT.format(
            query=query,
            topics_list=', '.join(OFFICIAL_TOPICS),
            existing_mappings=existing_mapping_str
        )
        
        response = model.generate_content(prompt)
        response_text = response.text.strip()
        
        json_match = re.search(r'\[.*?\]', response_text, re.DOTALL)
        if json_match:
            try:
                lectures = json.loads(json_match.group())
                if isinstance(lectures, list) and all(isinstance(x, int) for x in lectures):
                    valid_lectures = [l for l in lectures if 2 <= l <= 25]
                    return valid_lectures
            except json.JSONDecodeError:
                pass
        
        return []
    except Exception as e:
        return []


def build_mapping_from_problems(problems_by_lecture: dict) -> dict:
    """
    Use Gemini to analyze problems and build comprehensive mapping.
    
    This is a one-time operation to build the mapping from crawled problems.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Warning: GEMINI_API_KEY not set, cannot build mapping with Gemini")
        return {}
    
    try:
        genai.configure(api_key=api_key)
        model_name = "gemini-3-pro-preview"
        model = genai.GenerativeModel(model_name)
        
        sample_data = {}
        for lecture_num, problems in problems_by_lecture.items():
            sample_problems = problems[:3] if len(problems) >= 3 else problems
            if sample_problems:
                sample_data[lecture_num] = [
                    {"text": p.get("text", "")[:400]} for p in sample_problems
                ]
        
        problems_json = json.dumps(sample_data, indent=2)
        if len(problems_json) > 8000:
            problems_json = problems_json[:8000] + "\n... (truncated)"
        
        prompt = GEMINI_BUILD_MAPPING_PROMPT.format(
            problems_json=problems_json,
            topics_list=', '.join(OFFICIAL_TOPICS)
        )
        
        response = model.generate_content(prompt)
        response_text = response.text.strip()
        
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            mapping = json.loads(json_match.group())
            if isinstance(mapping, dict):
                save_mapping(mapping)
                return mapping
        
        return {}
    except Exception as e:
        print(f"Error building mapping with Gemini: {e}")
        return {}

