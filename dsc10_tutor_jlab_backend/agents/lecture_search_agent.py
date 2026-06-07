import asyncio
import logging
import os
import re
from collections import deque
from pathlib import Path
from typing import Any

from ..services.lectures_service import retrieve_relevant_lecture_cells

logger = logging.getLogger(__name__)

_MAX_SCAN_DEPTH = 6

_LECTURES_FOLDER_NAMES = {"lectures", "lecture", "lecs"}
_LECTURE_FILENAME_RE = re.compile(r"^(lec|lecture)[\s_\-]?\d+", re.IGNORECASE)

_LECTURES_DIR_CACHE: Path | None = None


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
