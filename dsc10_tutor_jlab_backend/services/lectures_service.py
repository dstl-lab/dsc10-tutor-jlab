import json
import os
import re
import math
import asyncio
from pathlib import Path
from typing import List, Dict, Any

import nbformat
from dotenv import load_dotenv
from google import genai

from ..gemini_client import get_gemini_model

backend_dir = Path(__file__).parent.parent
load_dotenv(dotenv_path=backend_dir / ".env")


SEARCH_ROOT = Path.home()

# In-memory cache — built once per server process, reused for every request
_LECTURE_INDEX_CACHE: List[Dict[str, Any]] | None = None
_IDF_CACHE: Dict[str, float] | None = None

_LECTURES_FOLDER_NAMES = {"lectures", "lecture", "lecs"}

_LECTURE_FILENAME_RE = re.compile(r"^(lec|lecture)[\s_\-]?\d+", re.IGNORECASE)

_MIN_SCORE = 0.05
_TFIDF_CANDIDATES = 10  # broad pool fed to Gemini reranker
_MAX_RESULTS = 2        # final cells shown to student

_STOP_WORDS = {
    "a", "an", "the", "is", "it", "in", "on", "at", "to", "for", "of", "and",
    "or", "with", "that", "this", "be", "are", "was", "were", "by", "from",
    "as", "we", "i", "my", "your", "can", "do", "does", "not", "but", "so",
    "if", "when", "what", "how", "which", "will", "have", "has", "had", "get",
    "use", "used", "let", "s", "t", "don", "about", "its", "into", "also",
    "just", "now", "here", "there", "then", "than", "more", "some", "any",
    "all", "no", "yes", "up", "out", "like", "see", "make", "want", "know",
    "think", "need", "look", "go", "come", "say", "take", "give", "try",
    "work", "run", "call", "show", "x", "y", "n",
}


# ---------------------------------------------------------------------------
# Lecture discovery
# ---------------------------------------------------------------------------

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
    return sorted(
        p
        for p in lectures_dir.rglob("*.ipynb")
        if ".ipynb_checkpoints" not in p.parts and _LECTURE_FILENAME_RE.match(p.stem)
    )


def _parse_notebook_cells(nb_path: Path, server_root: Path) -> List[Dict[str, Any]]:
    try:
        nb = nbformat.read(nb_path, as_version=4)
    except Exception:
        return []

    cells = []
    for idx, cell in enumerate(nb.cells):
        if cell.cell_type not in ("markdown", "code"):
            continue
        content = cell.source.strip()
        if not content or len(content) < 40:
            continue
        cells.append({
            "lecture": nb_path.name,
            "path": str(nb_path.relative_to(server_root)),
            "cell_index": idx,
            "cell_type": cell.cell_type,
            "content": content,
            "preview": content[:300],
        })
    return cells


def _build_lecture_index(server_root: Path) -> List[Dict[str, Any]]:
    dir_path = _find_lectures_dir()
    if dir_path is None:
        return []

    index: List[Dict[str, Any]] = []
    for nb_path in _list_lecture_notebook_paths(dir_path):
        index.extend(_parse_notebook_cells(nb_path, server_root))
    return index


# ---------------------------------------------------------------------------
# TF-IDF candidate retrieval
# ---------------------------------------------------------------------------

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


def _score_cell(query_tokens: List[str], cell_content: str, idf: Dict[str, float]) -> float:
    cell_tokens = _tokenize(cell_content)
    if not cell_tokens:
        return 0.0
    cell_tf: Dict[str, float] = {}
    for tok in cell_tokens:
        cell_tf[tok] = cell_tf.get(tok, 0) + 1
    total = len(cell_tokens)
    return sum((cell_tf[tok] / total) * idf.get(tok, 1.0) for tok in query_tokens if tok in cell_tf)


def _get_tfidf_candidates(
    question: str,
    cells: List[Dict[str, Any]],
    idf: Dict[str, float],
) -> List[Dict[str, Any]]:
    query_tokens = _tokenize(question)
    if not query_tokens:
        return []

    scored = [
        (score, cell)
        for cell in cells
        if (score := _score_cell(query_tokens, cell["content"], idf)) >= _MIN_SCORE
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [cell for _, cell in scored[:_TFIDF_CANDIDATES]]


# ---------------------------------------------------------------------------
# Gemini reranker
# ---------------------------------------------------------------------------

async def _rerank_with_gemini(
    question: str,
    candidates: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Use a single Gemini call to semantically pick the best cells from TF-IDF candidates."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return candidates[:_MAX_RESULTS]

    numbered = "\n\n".join(
        f"[{i}] Lecture: {c['lecture']} | Type: {c['cell_type']}\n{c['content'][:400]}"
        for i, c in enumerate(candidates)
    )
    prompt = (
        f'A DSC 10 student asked: "{question}"\n\n'
        f"Below are {len(candidates)} lecture notebook cells (numbered 0–{len(candidates) - 1}).\n"
        f"Pick the {_MAX_RESULTS} most relevant cells that would genuinely help answer the student's question.\n\n"
        f"{numbered}\n\n"
        f"Return ONLY a JSON list of {_MAX_RESULTS} indices, e.g. [2, 5]. No explanation.\nJSON:"
    )

    try:
        client = genai.Client(api_key=api_key)
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=get_gemini_model(),
            contents=prompt,
        )
        response_text = response.text.strip()
    except Exception:
        return candidates[:_MAX_RESULTS]

    match = re.search(r"\[.*?\]", response_text, re.DOTALL)
    if not match:
        return candidates[:_MAX_RESULTS]

    try:
        indices = json.loads(match.group())
    except json.JSONDecodeError:
        return candidates[:_MAX_RESULTS]

    result = [candidates[i] for i in indices if isinstance(i, int) and 0 <= i < len(candidates)]
    return result if result else candidates[:_MAX_RESULTS]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def retrieve_relevant_lecture_cells(
    question: str,
    server_root: Path | None = None,
) -> List[Dict[str, Any]]:
    global _LECTURE_INDEX_CACHE, _IDF_CACHE

    root = server_root or Path.home()

    if _LECTURE_INDEX_CACHE is None:
        _LECTURE_INDEX_CACHE = await asyncio.to_thread(_build_lecture_index, root)
        _IDF_CACHE = _build_idf(_LECTURE_INDEX_CACHE)

    if not _LECTURE_INDEX_CACHE:
        return []

    candidates = _get_tfidf_candidates(
        question=question,
        cells=_LECTURE_INDEX_CACHE,
        idf=_IDF_CACHE or {},
    )

    return await _rerank_with_gemini(question, candidates)
