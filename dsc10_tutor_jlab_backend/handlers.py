import json
import traceback

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

from .agents.tutor_agent import ask_tutor
from .tools.files_tool import ListFilesHandler, ReadFileHandler, SearchFilesHandler


class RouteHandler(APIHandler):
    # The following decorator should be present on all verb methods (head, get, post,
    # patch, put, delete, options) to ensure only authorized user can request the
    # Jupyter server
    @tornado.web.authenticated
    def get(self):
        self.finish(
            json.dumps(
                {"data": "This is /dsc10-tutor-jlab-backend/get-example endpoint!"}
            )
        )


class AskHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self):
        try:
            body = json.loads(self.request.body)

            # Parse notebook_json if it's a JSON string
            notebook_json = body.get("notebook_json")
            if isinstance(notebook_json, str):
                try:
                    notebook_json = json.loads(notebook_json)
                except json.JSONDecodeError:
                    notebook_json = notebook_json

            # Parse structured_context if provided
            structured_context = body.get("structured_context")
            if isinstance(structured_context, str):
                try:
                    structured_context = json.loads(structured_context)
                except json.JSONDecodeError:
                    structured_context = None

            result = await ask_tutor(
                student_question=body["student_question"],
                notebook_json=notebook_json,
                prompt_mode=body.get("prompt_mode", "append"),
                conversation_id=body.get("conversation_id"),
                nearest_markdown_cell_text=body.get(
                    "nearest_markdown_cell_text"
                ),
                reset_conversation=body.get("reset_conversation", False),
                structured_context=structured_context,
            )

            self.finish(json.dumps(result))
        except Exception as e:
            error_trace = traceback.format_exc()
            self.set_status(500)
            self.finish(json.dumps({"error": str(e), "traceback": error_trace}))


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    route_pattern = url_path_join(base_url, "dsc10-tutor-jlab-backend", "get-example")
    read_file_pattern = url_path_join(base_url, "dsc10-tutor-jlab-backend", "read-file")
    search_files_pattern = url_path_join(
        base_url, "dsc10-tutor-jlab-backend", "search-files"
    )
    list_files_pattern = url_path_join(
        base_url, "dsc10-tutor-jlab-backend", "list-files"
    )
    ask_pattern = url_path_join(base_url, "dsc10-tutor-jlab-backend", "ask")
    handlers = [
        (route_pattern, RouteHandler),
        (read_file_pattern, ReadFileHandler),
        (search_files_pattern, SearchFilesHandler),
        (list_files_pattern, ListFilesHandler),
        (ask_pattern, AskHandler),
    ]
    web_app.add_handlers(host_pattern, handlers)
