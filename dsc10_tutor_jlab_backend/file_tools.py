from pathlib import Path
import json
import tornado

from jupyter_server.base.handlers import APIHandler

WORKSPACE_ROOT = Path.cwd().resolve()
ALLOWED_EXTENSIONS = {".ipynb", ".csv", ".md"}


class ListFilesHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        path = self.get_query_argument("path", ".")
        recursive = self.get_query_argument("recursive", "true").lower() == "true"

        target = (WORKSPACE_ROOT / path).resolve()

        # Safety check
        try:
            target.relative_to(WORKSPACE_ROOT)
        except ValueError:
            self.set_status(400)
            self.finish(json.dumps({"error": "Invalid path"}))
            return

        if not target.exists() or not target.is_dir():
            self.finish(json.dumps({"files": []}))
            return

        files = []
        iterator = target.rglob("*") if recursive else target.iterdir()

        for item in iterator:
            if item.is_file() and item.suffix in ALLOWED_EXTENSIONS:
                files.append(
                    {
                        "path": str(item.relative_to(WORKSPACE_ROOT)),
                        "type": (
                            "notebook"
                            if item.suffix == ".ipynb"
                            else "data"
                            if item.suffix == ".csv"
                            else "text"
                        ),
                    }
                )

        self.finish(json.dumps({"files": files}))


def python_search_files(query: str, scope: str = "."):
    """
    Search .ipynb files under `scope` for `query` (case-insensitive).
    Returns a list of matching file paths.
    """
    base = (WORKSPACE_ROOT / scope).resolve()
    matches = []

    # Safety check: prevent escaping workspace
    try:
        base.relative_to(WORKSPACE_ROOT)
    except ValueError:
        return matches

    if not base.exists():
        return matches

    for path in base.rglob("*.ipynb"):
        if ".ipynb_checkpoints" in path.parts:
            continue

        try:
            text = path.read_text(encoding="utf-8", errors="ignore").lower()
            if query.lower() in text:
                matches.append(str(path.relative_to(WORKSPACE_ROOT)))
        except Exception:
            continue

    return matches


class SearchFilesHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        """
        POST /search-files
        Body: { "query": "...", "scope": "." }
        """
        body = self.get_json_body() or {}

        query = body.get("query", "").strip()
        scope = body.get("scope", ".")

        if not query:
            self.finish(json.dumps({"files": []}))
            return

        files = python_search_files(query, scope)

        self.finish(json.dumps({"files": files}))
