import json
import os
from pathlib import Path

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado
from .files_tool import ReadFileHandler, SearchFilesHandler
from .files_tool import ListFilesHandler



class RouteHandler(APIHandler):
    # The following decorator should be present on all verb methods (head, get, post,
    # patch, put, delete, options) to ensure only authorized user can request the
    # Jupyter server
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({
            "data": "This is /dsc10-tutor-jlab-backend/get-example endpoint!"
        }))


def setup_handlers(web_app):
    host_pattern = ".*$"

    base_url = web_app.settings["base_url"]
    route_pattern = url_path_join(base_url, "dsc10-tutor-jlab-backend", "get-example")
    read_file_pattern = url_path_join(base_url, "dsc10-tutor-jlab-backend", "read-file")
    search_files_pattern = url_path_join(base_url, "dsc10-tutor-jlab-backend", "search-files")
    list_files_pattern = url_path_join(base_url, "dsc10-tutor-jlab-backend", "list-files")
    handlers = [
        (route_pattern, RouteHandler),
        (read_file_pattern, ReadFileHandler),
        (search_files_pattern, SearchFilesHandler),
        (list_files_pattern, ListFilesHandler)
    ]
    web_app.add_handlers(host_pattern, handlers)
