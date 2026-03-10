import os
import re
import math
import asyncio
from pathlib import Path
from typing import List, Dict, Any
import nbformat
from dotenv import load_dotenv

backend_dir = Path(__file__).parent.parent
load_dotenv(dotenv_path=backend_dir / ".env")


SERVER_ROOT = Path.home()
SEARCH_ROOT = Path.home()

# In-memory cache
_LECTURE_INDEX_CACHE: List[Dict[str, Any]] | None = None
_IDF_CACHE: Dict[str, float] | None = None

_LECTURES_FOLDER_NAMES = {"lectures", "lecture", "lecs"}

_LECTURE_FILENAME_RE = re.compile(r"^(lec|lecture)[\s_\-]?\d+", re.IGNORECASE)

_MIN_SCORE = 0.05

_MAX_RESULTS = 3

_STOP_WORDS = {
    "a",
    "an",
    "the",
    "is",
    "it",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "and",
    "or",
    "with",
    "that",
    "this",
    "be",
    "are",
    "was",
    "were",
    "by",
    "from",
    "as",
    "we",
    "i",
    "my",
    "your",
    "can",
    "do",
    "does",
    "not",
    "but",
    "so",
    "if",
    "when",
    "what",
    "how",
    "which",
    "will",
    "have",
    "has",
    "had",
    "get",
    "use",
    "used",
    "let",
    "s",
    "t",
    "don",
    "about",
    "its",
    "into",
    "also",
    "just",
    "now",
    "here",
    "there",
    "then",
    "than",
    "more",
    "some",
    "any",
    "all",
    "no",
    "yes",
    "up",
    "out",
    "like",
    "see",
    "make",
    "want",
    "know",
    "think",
    "need",
    "look",
    "go",
    "come",
    "say",
    "take",
    "give",
    "try",
    "work",
    "run",
    "call",
    "show",
    "x",
    "y",
    "n",
}


def _find_lectures_dir() -> Path | None:
    env_path = os.getenv("LECTURES_PATH")
    if env_path:
        p = Path(env_path).expanduser()
        resolved = p if p.is_absolute() else (SEARCH_ROOT / env_path).resolve()
        if resolved.exists() and resolved.is_dir():
            return resolved

    candidates: List[Path] = []
    for dirpath in SEARCH_ROOT.rglob("*"):
        if not dirpath.is_dir():
            continue
        if dirpath.name.lower() not in _LECTURES_FOLDER_NAMES:
            continue
        has_lectures = any(
            _LECTURE_FILENAME_RE.match(nb.stem)
            for nb in dirpath.rglob("*.ipynb")
            if ".ipynb_checkpoints" not in nb.parts
        )
        if has_lectures:
            candidates.append(dirpath)

    if not candidates:
        return None

    candidates.sort(key=lambda p: len(p.parts))
    return candidates[0]


def _list_lecture_notebook_paths(lectures_dir: Path) -> List[Path]:
    paths = [
        p
        for p in lectures_dir.rglob("*.ipynb")
        if ".ipynb_checkpoints" not in p.parts and _LECTURE_FILENAME_RE.match(p.stem)
    ]
    return sorted(paths)


def _parse_notebook_cells(nb_path: Path) -> List[Dict[str, Any]]:
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
        if not content or len(content) < 40:
            continue

        parsed_cells.append(
            {
                "lecture": lecture_name,
                "path": str(nb_path.relative_to(SERVER_ROOT)),
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

    index: List[Dict[str, Any]] = []
    for nb_path in _list_lecture_notebook_paths(dir_path):
        index.extend(_parse_notebook_cells(nb_path))
    return index


# TF-IDF scoring
def _tokenize(text: str) -> List[str]:
    tokens = re.findall(r"[a-z_][a-z0-9_]*", text.lower())
    return [t for t in tokens if t not in _STOP_WORDS and len(t) > 1]


def _build_idf(cells: List[Dict[str, Any]]) -> Dict[str, float]:
    N = len(cells)
    if N == 0:
        return {}
    doc_freq: Dict[str, int] = {}
    for cell in cells:
        for tok in set(_tokenize(cell["content"])):
            doc_freq[tok] = doc_freq.get(tok, 0) + 1
    return {tok: math.log((N + 1) / (df + 1)) for tok, df in doc_freq.items()}


def _score_cell(
    query_tokens: List[str], cell_content: str, idf: Dict[str, float]
) -> float:
    cell_tokens = _tokenize(cell_content)
    if not cell_tokens:
        return 0.0

    cell_tf: Dict[str, float] = {}
    for tok in cell_tokens:
        cell_tf[tok] = cell_tf.get(tok, 0) + 1
    total = len(cell_tokens)

    score = 0.0
    for tok in query_tokens:
        if tok in cell_tf:
            score += (cell_tf[tok] / total) * idf.get(tok, 1.0)
    return score


def _rank_relevant_cells(
    question: str,
    cells: List[Dict[str, Any]],
    idf: Dict[str, float],
) -> List[Dict[str, Any]]:
    # Score all cells by TF-IDF similarity to the question

    query_tokens = _tokenize(question)
    if not query_tokens:
        return []

    scored: List[tuple[float, Dict[str, Any]]] = []
    for cell in cells:
        score = _score_cell(query_tokens, cell["content"], idf)
        if score >= _MIN_SCORE:
            scored.append((score, cell))

    scored.sort(key=lambda x: x[0], reverse=True)

    return [cell for _, cell in scored[:_MAX_RESULTS]]


async def retrieve_relevant_lecture_cells(
    question: str,
) -> List[Dict[str, Any]]:
    global _LECTURE_INDEX_CACHE, _IDF_CACHE

    if _LECTURE_INDEX_CACHE is None:
        _LECTURE_INDEX_CACHE = await asyncio.to_thread(_build_lecture_index)
        _IDF_CACHE = _build_idf(_LECTURE_INDEX_CACHE)

    if not _LECTURE_INDEX_CACHE:
        return []

    return _rank_relevant_cells(
        question=question,
        cells=_LECTURE_INDEX_CACHE,
        idf=_IDF_CACHE or {},
    )
