from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# from ..tools.tools import TOOL_LIST
from ..conversation_store import append_message, get_history, reset_history
from ..gemini_client import get_gemini_model
from ..prompts import PROMPT_MAP


async def ask_tutor(
    student_question: str,
    notebook_json: dict | None,
    prompt_mode: str = "append",
    conversation_id: str | None = None,
    nearest_markdown_cell_text: str | None = None,
    reset_conversation: bool = False,
    structured_context: dict | None = None,
    initial_notebook_snapshot: dict | None = None,
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

    # Build structured user input with full notebook and active cell info in every request
    markdown_instructions = ""
    active_cell_info = ""
    
    if structured_context:
        # Extract markdown instructions from context
        if structured_context.get("markdownInstructions"):
            markdown_instructions = "\n".join(
                structured_context["markdownInstructions"]
            )
        
        # Extract active cell information
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
    
    # Build user input with notebook snapshot and active cell info
    if initial_notebook_snapshot:
        user_input = f"""
=== NOTEBOOK SNAPSHOT ===
The student's notebook has been analyzed and sanitized for optimal performance.
Notebook: {initial_notebook_snapshot.get('notebookName', 'Untitled')}
Total cells: {len(initial_notebook_snapshot.get('cells', []))}
Images removed: {initial_notebook_snapshot.get('imagesRemoved', 0)}
Plots removed: {initial_notebook_snapshot.get('plotsRemoved', 0)}
Large outputs truncated: {initial_notebook_snapshot.get('largeOutputsRemoved', 0)}

FULL SANITIZED NOTEBOOK:
{initial_notebook_snapshot}

=== END NOTEBOOK SNAPSHOT ===

Conversation so far:
{history}

Notebook Instructions:
{markdown_instructions or "No instructions available"}

{active_cell_info}

Nearest markdown cell:
{nearest_markdown_cell_text or ""}

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
