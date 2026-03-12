"""Rank and filter problems by relevance to a topic query."""

import logging
import os
from typing import List, Dict

import google.generativeai as genai
from dotenv import load_dotenv
from pathlib import Path

logger = logging.getLogger(__name__)

backend_dir = Path(__file__).parent.parent
root_dir = backend_dir.parent

load_dotenv(dotenv_path=root_dir / ".env")
load_dotenv(dotenv_path=backend_dir / ".env", override=False)



def _normalize_text(text: str) -> str:
    text = (text or "").lower()
    chars: list[str] = []
    for ch in text:
        chars.append(ch if ch.isalnum() else " ")
    return " ".join("".join(chars).split()).strip()


def _local_relevance_score(problem: Dict, topic_query: str) -> float:
    """Simple deterministic relevance scoring when Gemini isn't available.
    """
    topic_norm = _normalize_text(topic_query)
    if not topic_norm:
        return 0.0

    text_norm = _normalize_text(problem.get("text", ""))
    source_norm = _normalize_text(problem.get("source", ""))

    haystack = f" {text_norm} "
    score = 0.0

    if f" {topic_norm} " in haystack:
        score += 10.0

    tokens = [t for t in topic_norm.split() if len(t) >= 4]
    if not tokens:
        return score

    for tok in tokens:
        if f" {tok} " in haystack:
            score += 1.5
        if source_norm and f" {tok} " in f" {source_norm} ":
            score += 0.5

    return score


def rank_problems_by_relevance(
    problems: List[Dict],
    topic_query: str,
    max_problems: int = 5,
    use_gemini: bool = True
) -> List[Dict]:

    if not problems:
        return []

    api_key = os.getenv("GEMINI_API_KEY")

    if not use_gemini or not api_key:
        scored = [
            (i, _local_relevance_score(p, topic_query), p) for i, p in enumerate(problems)
        ]
        scored.sort(key=lambda t: (-t[1], t[0]))
        ranked = [p for _, _, p in scored]
        return ranked[:max_problems]
    
    try:
        genai.configure(api_key=api_key)
        model_name = "gemini-3-pro-preview"
        logger.info(f"[Practice Problems] 🚀 Calling Gemini ({model_name}) for problem ranking: '{topic_query}' ({len(problems)} candidates)")
        model = genai.GenerativeModel(model_name)
        
        problem_summaries = []
        for i, problem in enumerate(problems[:20]):  
            problem_id = problem.get("id", f"prob_{i}")
            problem_text = problem.get("text", "")[:300] 
            problem_summaries.append({
                "id": problem_id,
                "text": problem_text
            })
        
        prompt = f"""A DSC 10 student wants practice problems about: "{topic_query}"

Below are {len(problem_summaries)} practice problems. Rank them by relevance to this topic.

Problems:
{chr(10).join([f"{i+1}. [{p['id']}] {p['text'][:200]}..." for i, p in enumerate(problem_summaries)])}

Return a JSON list of problem IDs in order of relevance (most relevant first).
Only include problem IDs that are actually relevant to "{topic_query}".

Example response: ["lecture_14_prob_1", "lecture_14_prob_3", "lecture_15_prob_2"]

JSON:"""
        
        response = model.generate_content(prompt)
        response_text = response.text.strip()
        logger.info(f"[Practice Problems] ✅ Ranking response received")
        
        import re
        import json
        json_match = re.search(r'\[.*?\]', response_text, re.DOTALL)
        if json_match:
            try:
                ranked_ids = json.loads(json_match.group())
            except json.JSONDecodeError:
                ranked_ids = []
                id_pattern = re.compile(r'"([^"]+)"')
                matches = id_pattern.findall(json_match.group())
                ranked_ids = matches
            
            if isinstance(ranked_ids, list):
                problem_map = {p.get("id"): p for p in problems}
                
                # Build ranked list
                ranked_problems = []
                for prob_id in ranked_ids:
                    if prob_id in problem_map:
                        ranked_problems.append(problem_map[prob_id])
                
                for problem in problems:
                    if problem.get("id") not in ranked_ids:
                        ranked_problems.append(problem)
                
                return ranked_problems[:max_problems]
    
    except Exception as e:
        print(f"Error ranking problems with Gemini: {e}")
    
    scored = [(i, _local_relevance_score(p, topic_query), p) for i, p in enumerate(problems)]
    scored.sort(key=lambda t: (-t[1], t[0]))
    ranked = [p for _, _, p in scored]
    return ranked[:max_problems]

