from pathlib import Path
import json
import tornado
import os

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




MAX_FILE_SIZE = 10 * 1024 * 1024 #10MB
MAX_CONTENT_LENGTH = 1024 * 1024 #1MB

class ReadFileHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        try:
            data = json.loads(self.request.body.decode('utf-8'))
            file_path = data.get('file_path', '')

            if not file_path:
                self.set_status(400)
                self.finish(json.dumps({
                    "error": "file_path parameter is required"
                }))
                return

            notebook_path = data.get('notebook_path', '')
            safe_base_dir = self._get_safe_base_directory(notebook_path)
            resolved_path = self._resolve_and_validate_path(file_path, safe_base_dir)
            
            if resolved_path is None:
                self.set_status(403)
                self.finish(json.dumps({
                    "error": f"Access denied: File path must be within allowed directories"
                }))
                return

            if not os.path.exists(resolved_path):
                self.set_status(404)
                self.finish(json.dumps({
                    "error": f"File not found: {file_path}"
                }))
                return

            if not os.path.isfile(resolved_path):
                self.set_status(400)
                self.finish(json.dumps({
                    "error": f"Path is not a file: {file_path}"
                }))
                return

            file_size = os.path.getsize(resolved_path)
            if file_size > MAX_FILE_SIZE:
                self.set_status(413)
                self.finish(json.dumps({
                    "error": f"File too large: {file_size} bytes (max {MAX_FILE_SIZE} bytes)"
                }))
                return

            try:
                with open(resolved_path, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()
            except Exception as e:
                self.set_status(500)
                self.finish(json.dumps({
                    "error": f"Error reading file: {str(e)}"
                }))
                return

            truncated = False
            if len(content) > MAX_CONTENT_LENGTH:
                content = content[:MAX_CONTENT_LENGTH]
                truncated = True
            self.finish(json.dumps({
                "file_path": file_path,
                "resolved_path": str(resolved_path),
                "content": content,
                "truncated": truncated,
                "file_size": file_size,
                "content_length": len(content)
            }))

        except json.JSONDecodeError:
            self.set_status(400)
            self.finish(json.dumps({
                "error": "Invalid JSON in request body"
            }))
        except Exception as e:
            self.set_status(500)
            self.finish(json.dumps({
                "error": f"Internal server error: {str(e)}"
            }))

    def _get_safe_base_directory(self, notebook_path: str) -> Path:
        """
        Determine the safe base directory for file access.
        Priority:
        1. Directory containing the notebook (if notebook_path provided)
        2. Jupyter server root directory
        3. Current working directory
        """
        if notebook_path:
            try:
                notebook_dir = Path(notebook_path).parent.resolve()
                if notebook_dir.exists() and notebook_dir.is_dir():
                    return notebook_dir
            except Exception:
                pass

        try:
            root_dir = self.settings.get('server_root_dir', '.')
            root_path = Path(root_dir).resolve()
            if root_path.exists() and root_path.is_dir():
                return root_path
        except Exception:
            pass

        return Path.cwd().resolve()

    def _resolve_and_validate_path(self, file_path: str, safe_base_dir: Path) -> Path | None:
        """
        Resolve the file path and validate it's within the safe base directory.
        Returns the resolved Path if valid, None otherwise.
        """
        try:
            if os.path.isabs(file_path):
                resolved = Path(file_path).resolve()
                try:
                    resolved.relative_to(safe_base_dir)
                    return resolved
                except ValueError:
                    return None
            else:
                resolved = (safe_base_dir / file_path).resolve()
                try:
                    resolved.relative_to(safe_base_dir)
                    return resolved
                except ValueError:
                    return None
        except Exception:
            return None
