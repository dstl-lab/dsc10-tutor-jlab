import asyncio
import logging
import os
import re
from collections import deque
from pathlib import Path
from typing import Any

# ADK bash agent disabled for latency experiment; former imports:
# import json
# import nbformat
# from google.adk.agents import Agent
# from google.adk.runners import Runner
# from google.adk.sessions import InMemorySessionService
# from google.adk.tools import FunctionTool
# from google.genai import types
# from ..tools.bash_tool import bash_exec

from ..services.lectures_service import retrieve_relevant_lecture_cells

logger = logging.getLogger(__name__)

# _AGENT_TIMEOUT_SECONDS = 25
_MAX_SCAN_DEPTH = 6

_LECTURES_FOLDER_NAMES = {"lectures", "lecture", "lecs"}
_LECTURE_FILENAME_RE = re.compile(r"^(lec|lecture)[\s_\-]?\d+", re.IGNORECASE)

_LECTURES_DIR_CACHE: Path | None = None

# # --- ADK bash search agent (disabled for latency experiment; using TF-IDF + reranker) ---
# _SEARCH_SYSTEM_PROMPT = """You are a lecture search assistant for DSC 10 at UC San Diego.
# Your job is to find the most relevant cells from lecture notebooks that help answer a student's question.
#
# You have one tool: bash_exec(command). It runs a single read-only shell command.
# Allowed commands: grep, find, cat, ls, head, tail, wc.
# No pipes, no redirects, no shell operators.
#
# Important: skip any notebook whose filename ends with "-live.ipynb" (e.g. lec06-live.ipynb).
# These are duplicate live-coding versions — always prefer the clean version (e.g. lec06.ipynb).
#
# Strategy:
# 1. If a lectures_hint path is provided, skip to step 2 using that path.
#    Otherwise, locate the lectures folder with a shallow find (directory names only, no content read):
#    Example: find . -maxdepth 4 -name "*.ipynb" -path "*lec*"
#    This is fast — it only reads directory metadata. Use the result to identify the lectures folder.
# 2. Once you have the lectures directory, grep inside it for key terms from the student's question:
#    Example: grep -rn "groupby" --include="*.ipynb" ./lectures/
# 3. From the grep matches, identify which notebook files are most relevant, then cat or head to read the specific cells.
# 4. Identify 1-2 cells most relevant to the question.
#
# Output format — when you have found relevant cells, output ONLY a JSON block in this exact format:
# ```json
# [
#   {
#     "notebook_path": "relative/path/to/lec05.ipynb",
#     "cell_content_snippet": "first 200 chars of the cell content"
#   }
# ]
# ```
# If you cannot find anything relevant, output: []
#
# Do not explain your reasoning. Only output the JSON block.
# """


def _find_lectures_dir(search_root: Path) -> Path | None:
    """Depth-limited BFS over directory names to find the lectures folder.

    Only reads directory metadata (via os.scandir) until a candidate folder is
    found, so it is fast even on large home directories like DataHub.
    Results are cached after the first successful discovery.
    """
    global _LECTURES_DIR_CACHE

    if _LECTURES_DIR_CACHE is not None:
        return _LECTURES_DIR_CACHE

    env_path = os.getenv("LECTURES_PATH")
    if env_path:
        p = Path(env_path).expanduser()
        resolved = p if p.is_absolute() else (search_root / env_path).resolve()
        if resolved.exists() and resolved.is_dir():
            _LECTURES_DIR_CACHE = resolved
            return resolved

    candidates: list[Path] = []
    queue: deque[tuple[Path, int]] = deque([(search_root, 0)])

    while queue:
        current, depth = queue.popleft()

        try:
            entries = list(os.scandir(current))
        except PermissionError:
            continue

        for entry in entries:
            if not entry.is_dir(follow_symlinks=False):
                continue
            entry_path = Path(entry.path)

            if entry_path.name.lower() in _LECTURES_FOLDER_NAMES:
                try:
                    has_lecture_nb = any(
                        _LECTURE_FILENAME_RE.match(nb.stem)
                        for nb in entry_path.rglob("*.ipynb")
                        if ".ipynb_checkpoints" not in nb.parts
                    )
                except PermissionError:
                    has_lecture_nb = False

                if has_lecture_nb:
                    candidates.append(entry_path)
                continue

            if depth < _MAX_SCAN_DEPTH:
                queue.append((entry_path, depth + 1))

    if not candidates:
        return None

    candidates.sort(key=lambda p: len(p.parts))
    _LECTURES_DIR_CACHE = candidates[0]
    return candidates[0]


# def _make_bash_tool(search_root: str) -> FunctionTool:
#     """Return a FunctionTool that runs bash_exec with search_root as cwd."""
#
#     def _tool(command: str) -> str:
#         return bash_exec(command, lectures_dir=search_root)
#
#     _tool.__name__ = "bash_exec"
#     _tool.__doc__ = (
#         "Run a read-only shell command (grep, find, cat, ls, head, tail, wc). "
#         "No pipes or redirects allowed. Working directory is the search root."
#     )
#     return FunctionTool(_tool)
#
#
# def _find_cell_index_by_snippet(nb_path: Path, snippet: str) -> int:
#     """Return the cell index whose content best matches the snippet."""
#     try:
#         nb = nbformat.read(nb_path, as_version=4)
#     except Exception:
#         return 0
#
#     snippet_norm = snippet.strip()[:150].lower()
#     best_idx = 0
#     best_overlap = -1
#
#     for idx, cell in enumerate(nb.cells):
#         cell_norm = cell.source.strip()[:300].lower()
#         overlap = sum(a == b for a, b in zip(snippet_norm, cell_norm))
#         if overlap > best_overlap:
#             best_overlap = overlap
#             best_idx = idx
#
#     return best_idx
#
#
# def _parse_agent_output(
#     raw_output: str,
#     server_root: Path,
#     lectures_dir: Path,
# ) -> list[dict[str, Any]]:
#     """Parse the agent's JSON output into ILectureCell-shaped dicts."""
#     fenced = re.search(r"```json\s*(.*?)\s*```", raw_output, re.DOTALL)
#     if fenced:
#         json_text = fenced.group(1)
#     else:
#         bare = re.search(r"\[\s*\{.*?\}\s*\]", raw_output, re.DOTALL)
#         if not bare:
#             return []
#         json_text = bare.group()
#
#     try:
#         items = json.loads(json_text)
#     except json.JSONDecodeError:
#         return []
#
#     if not isinstance(items, list) or not items:
#         return []
#
#     results = []
#     for item in items[:2]:
#         nb_rel = item.get("notebook_path", "").strip()
#         if not nb_rel:
#             continue
#
#         nb_abs = (lectures_dir / nb_rel).resolve()
#         if not nb_abs.exists():
#             nb_abs = (server_root / nb_rel).resolve()
#         if not nb_abs.exists():
#             continue
#
#         snippet = item.get("cell_content_snippet", "")
#         cell_index = _find_cell_index_by_snippet(nb_abs, snippet)
#
#         try:
#             nb = nbformat.read(nb_abs, as_version=4)
#             cell = nb.cells[cell_index]
#             content = cell.source.strip()
#             cell_type = cell.cell_type
#         except Exception:
#             continue
#
#         if not content:
#             continue
#
#         try:
#             path_for_docmanager = str(nb_abs.relative_to(server_root))
#         except ValueError:
#             path_for_docmanager = str(nb_abs)
#
#         results.append(
#             {
#                 "lecture": nb_abs.name,
#                 "path": path_for_docmanager,
#                 "cell_index": cell_index,
#                 "cell_type": cell_type,
#                 "content": content,
#                 "preview": content[:300],
#             }
#         )
#
#     return results


async def search_lecture_cells_with_agent(
    question: str,
    server_root: Path | None = None,
) -> list[dict[str, Any]]:
    """Lecture retrieval via TF-IDF + Gemini reranker (ADK bash agent disabled for latency experiment)."""
    root = server_root or Path.home()

    lectures_hint = await asyncio.to_thread(_find_lectures_dir, root)

    if lectures_hint is None:
        logger.info(
            "[LectureSearch] No lectures directory pre-discovered; "
            "index build will search from %s.",
            root,
        )

    results = await retrieve_relevant_lecture_cells(question, root)
    return results

    # async def search_lecture_cells_with_agent(
    #     question: str,
    #     server_root: Path | None = None,
    # ) -> list[dict[str, Any]]:
    #     """Run the ADK lecture search agent, fall back to TF-IDF only on hard failures."""
    #     root = server_root or Path.home()

    #     lectures_hint = await asyncio.to_thread(_find_lectures_dir, root)
    #     bash_cwd = lectures_hint if lectures_hint is not None else root

    #     if lectures_hint is None:
    #         logger.info(
    #             "[LectureSearch] No lectures directory pre-discovered; "
    #             "agent will search from %s.",
    #             root,
    #         )

    #     bash_tool = _make_bash_tool(str(bash_cwd))

    #     agent = Agent(
    #         name="lecture_search",
    #         model=get_gemini_model(),
    #         instruction=_SEARCH_SYSTEM_PROMPT,
    #         tools=[bash_tool],
    #     )
    #     session_service = InMemorySessionService()
    #     runner = Runner(
    #         agent=agent,
    #         app_name="dsc10-lecture-search",
    #         session_service=session_service,
    #         auto_create_session=True,
    #     )

    #     if lectures_hint:
    #         search_context = f"lectures_hint: {lectures_hint}"
    #     else:
    #         search_context = (
    #             f"No lectures directory pre-discovered. "
    #             f"Start by running: find {root} -maxdepth 4 -name '*.ipynb' -path '*lec*' "
    #             f"to locate the lectures folder, then grep inside it."
    #         )
    #     user_message = (
    #         f"Find lecture cells relevant to this DSC 10 student question:\n\n{question}\n\n"
    #         f"{search_context}"
    #     )
    #     content = types.Content(role="user", parts=[types.Part(text=user_message)])

    #     raw_parts: list[str] = []
    #     try:

    #         async def _collect():
    #             async for event in runner.run_async(
    #                 user_id="student",
    #                 session_id="lecture-search-one-shot",
    #                 new_message=content,
    #             ):
    #                 if hasattr(event, "content") and event.content:
    #                     for part in event.content.parts:
    #                         if hasattr(part, "text") and part.text:
    #                             raw_parts.append(part.text)

    #         await asyncio.wait_for(_collect(), timeout=_AGENT_TIMEOUT_SECONDS)
    #     except asyncio.TimeoutError:
    #         logger.warning("[LectureSearch] Agent timed out; using TF-IDF fallback.")
    #         return await retrieve_relevant_lecture_cells(question, root)
    #     except Exception as exc:
    #         logger.warning("[LectureSearch] Agent error (%s); using TF-IDF fallback.", exc)
    #         return await retrieve_relevant_lecture_cells(question, root)

    #     raw_output = "".join(raw_parts)
    #     results = _parse_agent_output(raw_output, root, bash_cwd)

    #     if results:
    #         logger.info("[LectureSearch] Agent found %d cell(s).", len(results))
    #     else:
    #         logger.info("[LectureSearch] Agent found no relevant cells.")

    #     return results
