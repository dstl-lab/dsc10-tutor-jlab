"""Use the same Gemini stack as the tutor to map topics to lecture numbers."""

import json
import re
from typing import List

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from ..gemini_client import get_gemini_model
from .normalizer import OFFICIAL_TOPICS, load_mapping, save_mapping


async def get_lectures_from_tutor(topic_query: str) -> List[int]:
    """Use Gemini (via ADK) to map a topic string to lecture numbers.

    Returns a list of unique lecture numbers in the range [2, 25].
    """
    model_name = get_gemini_model()

    agent = Agent(
        name="dsc10_practice_mapper",
        model=model_name,
        instruction=(
            "You are helping a DSC 10 student find relevant lectures for practice problems.\n"
            "Given a topic and the DSC 10 lecture list (numbers 2–25), "
            "return ONLY a JSON list of lecture numbers, e.g. [11] or [5, 8]."
        ),
    )

    # Build explicit lecture-number → topic mapping for the model
    lecture_topic_lines = [
        f"{i}: {topic}" for i, topic in enumerate(OFFICIAL_TOPICS, start=2)
    ]
    lecture_topic_str = "\n".join(lecture_topic_lines)

    prompt = f"""A DSC 10 student wants practice problems about: "{topic_query}"

Here is the official mapping from lecture numbers to topics in DSC 10:
{lecture_topic_str}

Choose the most relevant lecture numbers (2-25) from the list above.

Return ONLY a JSON list of lecture numbers, e.g. [11] or [5, 8].
If unsure or the topic is not covered, return [].

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
        session_id="practice-mapper",
        new_message=content,
    ):
        if getattr(event, "content", None):
            for part in event.content.parts:
                if getattr(part, "text", None):
                    response_parts.append(part.text)

    response_text = "".join(response_parts).strip()

    match = re.search(r"\[.*?\]", response_text, re.DOTALL)
    if not match:
        return []

    try:
        lectures = json.loads(match.group())
    except json.JSONDecodeError:
        return []

    if not isinstance(lectures, list) or not all(isinstance(x, int) for x in lectures):
        return []

    valid = sorted({l for l in lectures if 2 <= l <= 25})
    if not valid:
        return []

    mapping = load_mapping()
    key = topic_query.lower().strip()
    mapping[key] = valid
    save_mapping(mapping)

    return valid


