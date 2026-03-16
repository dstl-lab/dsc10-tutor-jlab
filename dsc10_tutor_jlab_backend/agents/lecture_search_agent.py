import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any

import nbformat
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import FunctionTool
from google.genai import types

from ..gemini_client import get_gemini_model
from ..services.lectures_service import (
    _find_lectures_dir,
    retrieve_relevant_lecture_cells,
)
from ..tools.bash_tool import bash_exec

logger = logging.getLogger(__name__)

_AGENT_TIMEOUT_SECONDS = 25

_SEARCH_SYSTEM_PROMPT = """You are a lecture search assistant for DSC 10 at UC San Diego.
Your job is to find the most relevant cells from lecture notebooks that help answer a student's question.

You have one tool: bash_exec(command). It runs a single read-only shell command.
Allowed commands: grep, find, cat, ls, head, tail, wc.
No pipes, no redirects, no shell operators.

Strategy:
1. Use grep to search for key terms from the student's question inside .ipynb files.
   Example: grep -rn "groupby" --include="*.ipynb" .
2. Use grep -l to find which notebook files match, then cat or head to inspect them.
3. Identify 1-2 cells most relevant to the question.

Output format — when you have found relevant cells, output ONLY a JSON block in this exact format:
```json
[
  {
    "notebook_path": "relative/path/to/lec05.ipynb",
    "cell_content_snippet": "first 200 chars of the cell content"
  }
]
```
If you cannot find anything relevant, output: []

Do not explain your reasoning. Only output the JSON block.
"""


def _make_bash_tool(lectures_dir: str) -> FunctionTool:
    """Return a FunctionTool that runs bash_exec with the lectures dir as cwd."""

    def _tool(command: str) -> str:
        return bash_exec(command, lectures_dir=lectures_dir)

    _tool.__name__ = "bash_exec"
    _tool.__doc__ = (
        "Run a read-only shell command (grep, find, cat, ls, head, tail, wc). "
        "No pipes or redirects allowed. Working directory is the lectures folder."
    )
    return FunctionTool(_tool)


def _find_cell_index_by_snippet(nb_path: Path, snippet: str) -> int:
    """Return the cell index whose content best matches the snippet."""
    try:
        nb = nbformat.read(nb_path, as_version=4)
    except Exception:
        return 0

    snippet_norm = snippet.strip()[:150].lower()
    best_idx = 0
    best_overlap = -1

    for idx, cell in enumerate(nb.cells):
        cell_norm = cell.source.strip()[:300].lower()
        overlap = sum(a == b for a, b in zip(snippet_norm, cell_norm))
        if overlap > best_overlap:
            best_overlap = overlap
            best_idx = idx

    return best_idx


def _parse_agent_output(
    raw_output: str,
    server_root: Path,
    lectures_dir: Path,
) -> list[dict[str, Any]]:
    """Parse the agent's JSON output into ILectureCell-shaped dicts."""
    fenced = re.search(r"```json\s*(.*?)\s*```", raw_output, re.DOTALL)
    if fenced:
        json_text = fenced.group(1)
    else:
        bare = re.search(r"\[\s*\{.*?\}\s*\]", raw_output, re.DOTALL)
        if not bare:
            return []
        json_text = bare.group()

    try:
        items = json.loads(json_text)
    except json.JSONDecodeError:
        return []

    if not isinstance(items, list) or not items:
        return []

    results = []
    for item in items[:2]:
        nb_rel = item.get("notebook_path", "").strip()
        if not nb_rel:
            continue

        nb_abs = (lectures_dir / nb_rel).resolve()
        if not nb_abs.exists():
            nb_abs = (server_root / nb_rel).resolve()
        if not nb_abs.exists():
            continue

        snippet = item.get("cell_content_snippet", "")
        cell_index = _find_cell_index_by_snippet(nb_abs, snippet)

        try:
            nb = nbformat.read(nb_abs, as_version=4)
            cell = nb.cells[cell_index]
            content = cell.source.strip()
            cell_type = cell.cell_type
        except Exception:
            continue

        if not content:
            continue

        try:
            path_for_docmanager = str(nb_abs.relative_to(server_root))
        except ValueError:
            path_for_docmanager = str(nb_abs)

        results.append(
            {
                "lecture": nb_abs.name,
                "path": path_for_docmanager,
                "cell_index": cell_index,
                "cell_type": cell_type,
                "content": content,
                "preview": content[:300],
            }
        )

    return results


async def search_lecture_cells_with_agent(
    question: str,
    server_root: Path | None = None,
) -> list[dict[str, Any]]:
    """Run the ADK lecture search agent, fall back to TF-IDF on any failure."""
    root = server_root or Path.home()
    lectures_dir = await asyncio.to_thread(_find_lectures_dir)

    if lectures_dir is None:
        logger.warning(
            "[LectureSearch] No lectures directory found; using TF-IDF fallback."
        )
        return await retrieve_relevant_lecture_cells(question, root)

    bash_tool = _make_bash_tool(str(lectures_dir))

    agent = Agent(
        name="lecture_search",
        model=get_gemini_model(),
        instruction=_SEARCH_SYSTEM_PROMPT,
        tools=[bash_tool],
    )
    session_service = InMemorySessionService()
    runner = Runner(
        agent=agent,
        app_name="dsc10-lecture-search",
        session_service=session_service,
        auto_create_session=True,
    )

    user_message = (
        f"Find lecture cells relevant to this DSC 10 student question:\n\n{question}\n\n"
        f"Lectures directory: {lectures_dir}"
    )
    content = types.Content(role="user", parts=[types.Part(text=user_message)])

    raw_parts: list[str] = []
    try:

        async def _collect():
            async for event in runner.run_async(
                user_id="student",
                session_id="lecture-search-one-shot",
                new_message=content,
            ):
                if hasattr(event, "content") and event.content:
                    for part in event.content.parts:
                        if hasattr(part, "text") and part.text:
                            raw_parts.append(part.text)

        await asyncio.wait_for(_collect(), timeout=_AGENT_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("[LectureSearch] Agent timed out; using TF-IDF fallback.")
        return await retrieve_relevant_lecture_cells(question, root)
    except Exception as exc:
        logger.warning("[LectureSearch] Agent error (%s); using TF-IDF fallback.", exc)
        return await retrieve_relevant_lecture_cells(question, root)

    raw_output = "".join(raw_parts)
    results = _parse_agent_output(raw_output, root, lectures_dir)

    if not results:
        logger.info("[LectureSearch] Agent returned no results; using TF-IDF fallback.")
        return await retrieve_relevant_lecture_cells(question, root)

    logger.info("[LectureSearch] Agent found %d cell(s).", len(results))
    return results
