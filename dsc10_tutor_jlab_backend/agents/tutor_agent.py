from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from ..gemini_client import get_gemini_model
from ..prompts import PROMPT_MAP

# from ..tools.tools import TOOL_LIST
from ..conversation_store import get_history, append_message, reset_history


async def ask_tutor(
    student_question: str,
    notebook_json: dict | None,
    prompt_mode: str = "append",
    conversation_id: str | None = None,
    nearest_markdown_cell_text: str | None = None,
    reset_conversation: bool = False,
):
    if reset_conversation:
        conversation_id = reset_history(conversation_id)

    history, conversation_id = get_history(conversation_id)

    system_prompt = PROMPT_MAP.get(prompt_mode, PROMPT_MAP["append"])

    agent = Agent(
        name="dsc10_tutor",
        model=get_gemini_model(),
        instruction=system_prompt,
        # tools=TOOL_LIST,
    )

    user_input = f"""
Conversation so far:
{history}

Notebook context:
{notebook_json}

Nearest markdown cell:
{nearest_markdown_cell_text or ""}

Student question:
{student_question}
"""

    # Create runner to execute the agent
    session_service = InMemorySessionService()
    runner = Runner(
        agent=agent,
        app_name="dsc10-tutor",
        session_service=session_service,
        auto_create_session=True
    )

    # Create user message content
    content = types.Content(role='user', parts=[types.Part(text=user_input)])

    # Run the agent and collect response
    response_parts = []
    async for event in runner.run_async(
        user_id="student",
        session_id=conversation_id or "default",
        new_message=content
    ):
        # Collect text from events
        if hasattr(event, 'content') and event.content:
            for part in event.content.parts:
                if hasattr(part, 'text') and part.text:
                    response_parts.append(part.text)

    text = "".join(response_parts)

    append_message(conversation_id, student_question, text)

    return {
        "tutor_response": text,
        "conversation_id": conversation_id,
    }
