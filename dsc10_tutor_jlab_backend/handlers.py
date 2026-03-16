import json
from pathlib import Path

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

from .agents.tutor_agent import ask_tutor, stream_ask_tutor
from .tools.files_tool import ListFilesHandler, ReadFileHandler, SearchFilesHandler
from .practice_problems.handler import PracticeProblemsHandler


class RouteHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        self.finish(
            json.dumps(
                {"data": "This is /dsc10-tutor-jlab-backend/get-example endpoint!"}
            )
        )


def _parse_body(raw_body: bytes) -> dict:
    """Parse request body and deserialise any nested JSON strings."""
    body = json.loads(raw_body)

    notebook_json = body.get("notebook_json")
    if isinstance(notebook_json, str):
        try:
            body["notebook_json"] = json.loads(notebook_json)
        except json.JSONDecodeError:
            pass

    structured_context = body.get("structured_context")
    if isinstance(structured_context, str):
        try:
            body["structured_context"] = json.loads(structured_context)
        except json.JSONDecodeError:
            body["structured_context"] = None

    return body


class AskHandler(APIHandler):
    """Non-streaming POST /ask — kept for backwards compatibility."""

    @tornado.web.authenticated
    async def post(self):
        try:
            body = _parse_body(self.request.body)

            result = await ask_tutor(
                student_question=body["student_question"],
                notebook_json=body.get("notebook_json"),
                prompt_mode=body.get("prompt_mode", "append"),
                conversation_id=body.get("conversation_id"),
                nearest_markdown_cell_text=body.get("nearest_markdown_cell_text"),
                reset_conversation=body.get("reset_conversation", False),
                structured_context=body.get("structured_context"),
                server_root=Path(self.settings.get("server_root_dir", Path.home()))
                .expanduser()
                .resolve(),
            )

            self.finish(json.dumps(result))
        except Exception as e:
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


class AskStreamHandler(APIHandler):
    """
    Streaming POST /ask-stream — sends Server-Sent Events over the response body.
    The client reads the response as a ReadableStream.
    """

    @tornado.web.authenticated
    async def post(self):
        try:
            body = _parse_body(self.request.body)
        except Exception as e:
            self.set_status(400)
            self.finish(json.dumps({"error": f"Bad request: {e}"}))
            return

        self.set_header("Content-Type", "text/event-stream; charset=utf-8")
        self.set_header("Cache-Control", "no-cache")
        self.set_header("X-Accel-Buffering", "no")  # disable nginx buffering on DataHub

        server_root = (
            Path(self.settings.get("server_root_dir", Path.home()))
            .expanduser()
            .resolve()
        )

        try:
            async for event in stream_ask_tutor(
                student_question=body["student_question"],
                notebook_json=body.get("notebook_json"),
                prompt_mode=body.get("prompt_mode", "append"),
                conversation_id=body.get("conversation_id"),
                nearest_markdown_cell_text=body.get("nearest_markdown_cell_text"),
                reset_conversation=body.get("reset_conversation", False),
                structured_context=body.get("structured_context"),
                server_root=server_root,
            ):
                self.write(f"data: {json.dumps(event)}\n\n")
                await self.flush()
        except Exception as e:
            error_event = {"type": "error", "message": str(e)}
            self.write(f"data: {json.dumps(error_event)}\n\n")
            await self.flush()
        finally:
            self.finish()


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    def url(*parts):
        return url_path_join(base_url, "dsc10-tutor-jlab-backend", *parts)

    handlers = [
        (url("get-example"), RouteHandler),
        (url("read-file"), ReadFileHandler),
        (url("search-files"), SearchFilesHandler),
        (url("list-files"), ListFilesHandler),
        (url("ask"), AskHandler),
        (url("ask-stream"), AskStreamHandler),
        (url("practice-problems"), PracticeProblemsHandler),
    ]
    web_app.add_handlers(host_pattern, handlers)
