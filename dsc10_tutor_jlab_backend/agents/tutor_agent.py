import re
from pathlib import Path

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# from ..tools.tools import TOOL_LIST
from ..conversation_store import append_message, get_history, reset_history
from ..gemini_client import get_gemini_model
from ..prompts import FOLLOW_UP_INSTRUCTION, PROMPT_MAP
from ..services.lectures_service import retrieve_relevant_lecture_cells

FOLLOW_UP_TUTOR_RESPONSE_MAX_CHARS = 800


def _format_lecture_name(filename: str) -> str:
    stem = filename.replace(".ipynb", "")
    match = re.search(r"\d+", stem)
    if match:
        return f"Lecture {int(match.group())}"
    return stem

def _truncate_for_follow_up(text: str, max_chars: int = FOLLOW_UP_TUTOR_RESPONSE_MAX_CHARS) -> str:
    """Truncate tutor response for follow-up generation; student_question is the main signal."""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "…"


async def _generate_follow_up(student_question: str, tutor_response: str) -> str | None:
    tutor_context = _truncate_for_follow_up(tutor_response)
    agent = Agent(
        name="follow_up",
        model=get_gemini_model(),
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


async def ask_tutor(
    student_question: str,
    notebook_json: dict | None,
    prompt_mode: str = "append",
    conversation_id: str | None = None,
    nearest_markdown_cell_text: str | None = None,
    reset_conversation: bool = False,
    structured_context: dict | None = None,
    exam_mode_conversation: str | None = None,
    server_root: Path | None = None,
):
    if reset_conversation:
        conversation_id = reset_history(conversation_id)

    history, conversation_id = get_history(conversation_id)

    is_exam_mode = bool(exam_mode_conversation) or (
        prompt_mode == "none" and not notebook_json
    )

    relevant_lecture_cells = []
    if not is_exam_mode:
        relevant_lecture_cells = await retrieve_relevant_lecture_cells(
            question=student_question,
            server_root=server_root,
        )

    lecture_context_str = ""
    if relevant_lecture_cells:
        formatted = []
        for cell in relevant_lecture_cells:
            formatted.append(
                f"""
Lecture: {_format_lecture_name(cell["lecture"])}
Cell Index: {cell["cell_index"]}
Cell Type: {cell["cell_type"]}
Content:
{cell["content"]}
"""
            )
        lecture_context_str = "\n\n".join(formatted)

    system_prompt = PROMPT_MAP.get(prompt_mode, PROMPT_MAP["append"])

    agent = Agent(
        name="dsc10_tutor",
        model=get_gemini_model(),
        instruction=system_prompt,
        # tools=TOOL_LIST,
    )

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
ACTIVE CELL (Index: {active_cell.get('index', 'N/A')}):
- Type: {active_cell.get('type', 'unknown')}
- Source:
{active_cell.get('source', '')}
- Execution count: {active_cell.get('execution_count', 'N/A')}
- Outputs: {len(active_cell.get('outputs', []))} outputs present
"""
    
    if notebook_json:
        user_input = f"""
=== NOTEBOOK SNAPSHOT ===
The student's notebook has been analyzed and sanitized for optimal performance.
Notebook: {notebook_json.get('notebookName', 'Untitled')}
Total cells: {len(notebook_json.get('cells', []))}
Images removed: {notebook_json.get('imagesRemoved', 0)}
Plots removed: {notebook_json.get('plotsRemoved', 0)}
Large outputs truncated: {notebook_json.get('largeOutputsRemoved', 0)}

FULL SANITIZED NOTEBOOK:
{notebook_json}

=== END NOTEBOOK SNAPSHOT ===

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
    else:
        user_input = f"""
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

    session_service = InMemorySessionService()
    runner = Runner(
        agent=agent,
        app_name="dsc10-tutor",
        session_service=session_service,
        auto_create_session=True,
    )

    content = types.Content(role="user", parts=[types.Part(text=user_input)])

    response_parts = []
    async for event in runner.run_async(
        user_id="student", session_id=conversation_id or "default", new_message=content
    ):
        if hasattr(event, "content") and event.content:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    response_parts.append(part.text)

    text = "".join(response_parts)

    append_message(conversation_id, student_question, text)

    follow_up = await _generate_follow_up(student_question, text)

    return {
        "tutor_response": text,
        "conversation_id": conversation_id,
        "relevant_lectures": relevant_lecture_cells,
        "follow_up": follow_up,
    }
