"""Rank and filter problems by relevance to a topic query."""

import json
import logging
from typing import List, Dict

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from ..gemini_client import get_gemini_model

logger = logging.getLogger(__name__)
def _normalize_text(text: str) -> str:
    text = (text or "").lower()
    chars: list[str] = []
    for ch in text:
        chars.append(ch if ch.isalnum() else " ")
    return " ".join("".join(chars).split()).strip()


def _local_relevance_score(problem: Dict, topic_query: str) -> float:
    """Simple deterministic relevance scoring when Gemini isn't available."""
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


async def _rank_with_gemini(
    problems: List[Dict],
    topic_query: str,
    max_problems: int = 5,
) -> List[Dict]:
    """Use the same ADK + Gemini stack as the tutor to rank problems."""
    if not problems:
        return []

    model_name = get_gemini_model()

    agent = Agent(
        name="dsc10_practice_ranker",
        model=model_name,
        instruction=(
            "You are helping a DSC 10 student find the most relevant practice problems.\n"
            "Given a topic and a list of candidate problems (with IDs and short text), "
            "return ONLY a JSON list of problem IDs, most relevant first."
        ),
    )

    # Limit the number of problems we send in one call.
    problem_summaries = []
    for i, problem in enumerate(problems[:20]):
        problem_id = problem.get("id", f"prob_{i}")
        problem_text = problem.get("text", "")[:400]
        problem_summaries.append(
            {
                "id": problem_id,
                "text": problem_text,
            }
        )

    problems_block = "\n".join(
        f"{i+1}. [{p['id']}] {p['text']}" for i, p in enumerate(problem_summaries)
    )

    prompt = f"""A DSC 10 student wants practice problems about: "{topic_query}".

Here are {len(problem_summaries)} candidate practice problems. Rank them by relevance to this topic.

Problems:
{problems_block}

Return ONLY a JSON list of problem IDs in order of relevance (most relevant first).
Only include problem IDs that are actually relevant to "{topic_query}".

Example response:
["lecture_14_prob_1", "lecture_14_prob_3", "lecture_15_prob_2"]

JSON:"""

    content = types.Content(role="user", parts=[types.Part(text=prompt)])

    session_service = InMemorySessionService()
    runner = Runner(
        agent=agent,
        app_name="dsc10-tutor",
        session_service=session_service,
        auto_create_session=True,
    )

    response_parts: list[str] = []
    async for event in runner.run_async(
        user_id="student",
        session_id="practice-ranker",
        new_message=content,
    ):
        if getattr(event, "content", None):
            for part in event.content.parts:
                if getattr(part, "text", None):
                    response_parts.append(part.text)

    response_text = "".join(response_parts).strip()

    if not response_text:
        return []

    import re

    match = re.search(r"\[.*?\]", response_text, re.DOTALL)
    if not match:
        return []

    try:
        ranked_ids = json.loads(match.group())
    except json.JSONDecodeError:
        id_pattern = re.compile(r'"([^"]+)"')
        ranked_ids = id_pattern.findall(match.group())

    if not isinstance(ranked_ids, list):
        return []

    problem_map = {p.get("id"): p for p in problems}

    ranked_problems: List[Dict] = []
    for prob_id in ranked_ids:
        if prob_id in problem_map:
            ranked_problems.append(problem_map[prob_id])

    for problem in problems:
        if problem.get("id") not in ranked_ids:
            ranked_problems.append(problem)

    return ranked_problems[:max_problems]


async def rank_problems_by_relevance(
    problems: List[Dict],
    topic_query: str,
    max_problems: int = 5,
    use_gemini: bool = True,
) -> List[Dict]:
    """Rank problems by relevance, using ADK+Gemini when enabled, with local fallback."""
    if not problems:
        return []

    if use_gemini:
        try:
            ranked = await _rank_with_gemini(problems, topic_query, max_problems)
            if ranked:
                return ranked
        except Exception as e:
            logger.warning("Error ranking problems with Gemini: %s", e)

    scored = [(i, _local_relevance_score(p, topic_query), p) for i, p in enumerate(problems)]
    scored.sort(key=lambda t: (-t[1], t[0]))
    ranked = [p for _, _, p in scored]
    return ranked[:max_problems]

