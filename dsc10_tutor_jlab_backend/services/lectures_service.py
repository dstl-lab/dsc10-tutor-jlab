import os
import asyncio
from pathlib import Path
from typing import List, Dict, Any
import nbformat
from dotenv import load_dotenv

backend_dir = Path(__file__).parent.parent
load_dotenv(dotenv_path=backend_dir / ".env")

WORKSPACE_ROOT = Path.cwd().resolve()

# In-memory cache to avoid re-parsing notebooks every request
_LECTURE_INDEX_CACHE: List[Dict[str, Any]] | None = None

_LECTURE_FILENAME_PATTERNS = [
    "lec*.ipynb",
    "lecture*.ipynb",
    "Lecture*.ipynb",
    "Lec*.ipynb",
]


def _find_lectures_dir() -> Path | None:
    # Override for local dev
    env_path = os.getenv("LECTURES_PATH")
    if env_path:
        p = Path(env_path)
        resolved = p if p.is_absolute() else (WORKSPACE_ROOT / env_path).resolve()
        if resolved.exists() and resolved.is_dir():
            return resolved

    # Auto discover lecture notebooks
    try:
        top_level = [d for d in WORKSPACE_ROOT.iterdir() if d.is_dir()]
    except PermissionError:
        return None

    candidates = []
    for d in sorted(top_level):
        candidates.append(d)
        try:
            candidates.extend(sorted(sub for sub in d.iterdir() if sub.is_dir()))
        except PermissionError:
            pass

    for candidate in candidates:
        for pattern in _LECTURE_FILENAME_PATTERNS:
            if any(candidate.glob(pattern)):
                return candidate

    return None


def _list_notebook_paths(lectures_dir: Path) -> List[Path]:
    paths = []
    if not lectures_dir.exists():
        return paths

    for path in lectures_dir.rglob("*.ipynb"):
        if ".ipynb_checkpoints" in path.parts:
            continue
        paths.append(path)
    return paths


def _parse_notebook_cells(nb_path: Path) -> List[Dict[str, Any]]:
    """
    Parse notebook and extract markdown + code cells with metadata.
    """
    try:
        nb = nbformat.read(nb_path, as_version=4)
    except Exception:
        return []

    lecture_name = nb_path.name

    parsed_cells = []
    for idx, cell in enumerate(nb.cells):
        if cell.cell_type not in ("markdown", "code"):
            continue

        content = cell.source.strip()
        if not content:
            continue

        parsed_cells.append(
            {
                "lecture": lecture_name,
                "path": str(nb_path.relative_to(WORKSPACE_ROOT)),
                "cell_index": idx,
                "cell_type": cell.cell_type,
                "content": content,
                "preview": content[:300],
            }
        )

    return parsed_cells


def _build_lecture_index() -> List[Dict[str, Any]]:
    dir_path = _find_lectures_dir()

    if dir_path is None:
        return []

    notebook_paths = _list_notebook_paths(dir_path)

    index: List[Dict[str, Any]] = []
    for nb_path in notebook_paths:
        index.extend(_parse_notebook_cells(nb_path))

    return index


def _simple_similarity(query: str, text: str) -> float:
    # Keyword matching - can eventually use text embeddings if needed

    query = query.lower()
    text = text.lower()

    score = 0.0
    for token in query.split():
        if token in text:
            score += 1.0
    return score


def _rank_relevant_cells(
    question: str,
    cells: List[Dict[str, Any]],
    top_k: int = 3,
) -> List[Dict[str, Any]]:
    # Rank lecture cells by similarity to the question.
    scored = []
    for cell in cells:
        score = _simple_similarity(question, cell["content"])
        if score > 0:
            scored.append((score, cell))

    scored.sort(key=lambda x: x[0], reverse=True)

    return [cell for _, cell in scored[:top_k]]


async def retrieve_relevant_lecture_cells(
    question: str,
    top_k: int = 3,
) -> List[Dict[str, Any]]:

    global _LECTURE_INDEX_CACHE

    if _LECTURE_INDEX_CACHE is None:
        _LECTURE_INDEX_CACHE = await asyncio.to_thread(_build_lecture_index)

    if not _LECTURE_INDEX_CACHE:
        return []

    relevant_cells = _rank_relevant_cells(
        question=question,
        cells=_LECTURE_INDEX_CACHE,
        top_k=top_k,
    )

    return relevant_cells
