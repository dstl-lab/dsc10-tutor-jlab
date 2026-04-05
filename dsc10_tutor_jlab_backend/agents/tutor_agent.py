import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from ..conversation_store import append_message, get_history, reset_history
from ..gemini_client import get_gemini_model
from ..prompts import FOLLOW_UP_INSTRUCTION, PROMPT_MAP
from .lecture_search_agent import search_lecture_cells_with_agent

FOLLOW_UP_TUTOR_RESPONSE_MAX_CHARS = 800


def _truncate_for_follow_up(
    text: str, max_chars: int = FOLLOW_UP_TUTOR_RESPONSE_MAX_CHARS
) -> str:
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "…"


async def _generate_follow_up(
    student_question: str, tutor_response: str
) -> str | None:
    tutor_context = _truncate_for_follow_up(tutor_response)
    model_name = get_gemini_model()
    agent = Agent(
        name="follow_up",
        model=model_name,
        instruction=FOLLOW_UP_INSTRUCTION,
    )
    session_service = InMemorySessionService()
    runner = Runner(
        agent=agent,
        app_name="dsc10-tutor-follow-up",
        session_service=session_service,
        auto_create_session=True,
    )

    user_input = f"""Student asked: {student_question}

Tutor replied: {tutor_context}

Output exactly one short follow-up question the student might ask next. No other text."""

    content = types.Content(role="user", parts=[types.Part(text=user_input)])
    response_parts = []

    async for event in runner.run_async(
        user_id="student",
        session_id="follow-up-one-shot",
        new_message=content,
    ):
        if hasattr(event, "content") and event.content:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    response_parts.append(part.text)

    raw = "".join(response_parts).strip()
    return raw if raw else None


def _build_user_input(
    student_question: str,
    history: str,
    notebook_json: dict | None,
    structured_context: dict | None,
    nearest_markdown_cell_text: str | None,
    lecture_context_str: str,
) -> str:
    markdown_instructions = ""
    active_cell_info = ""

    if structured_context:
        if structured_context.get("markdownInstructions"):
            markdown_instructions = "\n".join(
                structured_context["markdownInstructions"]
            )
        if structured_context.get("activeCell"):
            active_cell = structured_context["activeCell"]
            active_cell_info = f"""
ACTIVE CELL (Index: {active_cell.get("index", "N/A")}):
- Type: {active_cell.get("type", "unknown")}
- Source:
{active_cell.get("source", "")}
- Execution count: {active_cell.get("execution_count", "N/A")}
- Outputs: {len(active_cell.get("outputs", []))} outputs present
"""

    shared = f"""
Conversation so far:
{history}

Notebook Instructions:
{markdown_instructions or "No instructions available"}

{active_cell_info}

Nearest markdown cell:
{nearest_markdown_cell_text or ""}

Relevant lecture examples:
{lecture_context_str}

Student question:
{student_question}
"""

    if notebook_json:
        return f"""
=== NOTEBOOK SNAPSHOT ===
The student's notebook has been analyzed and sanitized for optimal performance.
Notebook: {notebook_json.get("notebookName", "Untitled")}
Total cells: {len(notebook_json.get("cells", []))}
Images removed: {notebook_json.get("imagesRemoved", 0)}
Plots removed: {notebook_json.get("plotsRemoved", 0)}
Large outputs truncated: {notebook_json.get("largeOutputsRemoved", 0)}

FULL SANITIZED NOTEBOOK:
{notebook_json}

=== END NOTEBOOK SNAPSHOT ===
{shared}"""

    return shared


async def stream_ask_tutor(
    student_question: str,
    notebook_json: dict | None,
    prompt_mode: str = "append",
    conversation_id: str | None = None,
    nearest_markdown_cell_text: str | None = None,
    reset_conversation: bool = False,
    structured_context: dict | None = None,
    server_root: Path | None = None,
) -> AsyncIterator[dict]:
    """Stream tutor response as SSE-ready event dicts.

    Yields dicts with a "type" key:
      {"type": "token",    "text": "..."}           — tutor response tokens
      {"type": "lectures", "relevant_lectures": [...]} — when lecture search completes
      {"type": "follow_up","text": "..."}            — follow-up suggestion
      {"type": "done",     "conversation_id": "..."}
      {"type": "error",    "message": "..."}
    """
    if reset_conversation:
        conversation_id = reset_history(conversation_id)

    history, conversation_id = get_history(conversation_id)

    lecture_task = asyncio.create_task(
        search_lecture_cells_with_agent(
            student_question,
            server_root,
        )
    )

    system_prompt = PROMPT_MAP.get(prompt_mode, PROMPT_MAP["append"])
    model_name = get_gemini_model()
    agent = Agent(
        name="dsc10_tutor",
        model=model_name,
        instruction=system_prompt,
    )
    session_service = InMemorySessionService()
    runner = Runner(
        agent=agent,
        app_name="dsc10-tutor",
        session_service=session_service,
        auto_create_session=True,
    )

    user_input = _build_user_input(
        student_question=student_question,
        history=history,
        notebook_json=notebook_json,
        structured_context=structured_context,
        nearest_markdown_cell_text=nearest_markdown_cell_text,
        lecture_context_str="(Lecture examples are being retrieved and will appear below the response.)",
    )

    content = types.Content(role="user", parts=[types.Part(text=user_input)])

    # Stream tutor response
    response_parts: list[str] = []
    try:
        async for event in runner.run_async(
            user_id="student",
            session_id=conversation_id or "default",
            new_message=content,
        ):
            if hasattr(event, "content") and event.content:
                for part in event.content.parts:
                    if hasattr(part, "text") and part.text:
                        response_parts.append(part.text)
                        yield {"type": "token", "text": part.text}
    except Exception as exc:
        yield {"type": "error", "message": str(exc)}
        lecture_task.cancel()
        return

    full_response = "".join(response_parts)

    follow_up_task = asyncio.create_task(
        _generate_follow_up(student_question, full_response)
    )

    async def _lecture_results() -> list:
        try:
            return await asyncio.wait_for(lecture_task, timeout=30)
        except (asyncio.TimeoutError, Exception):
            return []

    lecture_wait_task = asyncio.create_task(_lecture_results())

    append_message(conversation_id, student_question, full_response)

    pending: set[asyncio.Task] = {lecture_wait_task, follow_up_task}
    while pending:
        done, pending = await asyncio.wait(
            pending, return_when=asyncio.FIRST_COMPLETED
        )
        for finished in done:
            if finished is lecture_wait_task:
                relevant_lectures = finished.result()
                if relevant_lectures:
                    yield {
                        "type": "lectures",
                        "relevant_lectures": relevant_lectures,
                    }
            else:
                follow_up = finished.result()
                if follow_up:
                    yield {"type": "follow_up", "text": follow_up}

    yield {"type": "done", "conversation_id": conversation_id}


async def ask_tutor(
    student_question: str,
    notebook_json: dict | None,
    prompt_mode: str = "append",
    conversation_id: str | None = None,
    nearest_markdown_cell_text: str | None = None,
    reset_conversation: bool = False,
    structured_context: dict | None = None,
    server_root: Path | None = None,
) -> dict:
    tokens: list[str] = []
    relevant_lectures: list = []
    follow_up: str | None = None
    final_conversation_id = conversation_id

    async for event in stream_ask_tutor(
        student_question=student_question,
        notebook_json=notebook_json,
        prompt_mode=prompt_mode,
        conversation_id=conversation_id,
        nearest_markdown_cell_text=nearest_markdown_cell_text,
        reset_conversation=reset_conversation,
        structured_context=structured_context,
        server_root=server_root,
    ):
        if event["type"] == "token":
            tokens.append(event["text"])
        elif event["type"] == "lectures":
            relevant_lectures = event["relevant_lectures"]
        elif event["type"] == "follow_up":
            follow_up = event["text"]
        elif event["type"] == "done":
            final_conversation_id = event["conversation_id"]

    return {
        "tutor_response": "".join(tokens),
        "conversation_id": final_conversation_id,
        "relevant_lectures": relevant_lectures,
        "follow_up": follow_up,
    }
