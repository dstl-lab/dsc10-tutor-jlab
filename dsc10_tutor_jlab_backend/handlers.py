import json
import os
from datetime import datetime

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado

try:
    import firebase_admin  # type: ignore
    from firebase_admin import credentials, firestore  # type: ignore
    from dotenv import load_dotenv  # type: ignore

    load_dotenv()

    if not firebase_admin._apps:
        firebase_credentials_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
        print(f"[Firebase Init] Checking credentials path: {firebase_credentials_path}")
        
        if firebase_credentials_path and os.path.exists(firebase_credentials_path):
            print(f"[Firebase Init] Loading credentials from: {firebase_credentials_path}")
            cred = credentials.Certificate(firebase_credentials_path)
            firebase_admin.initialize_app(cred)
        else:
            service_account_key = os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
            if service_account_key:
                import json as json_lib
                cred_dict = json_lib.loads(service_account_key)
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred)
    FIREBASE_AVAILABLE = True
except ImportError as e:
    FIREBASE_AVAILABLE = False
except Exception as e:
    import traceback
    traceback.print_exc()
    FIREBASE_AVAILABLE = False


class RouteHandler(APIHandler):
    # The following decorator should be present on all verb methods (head, get, post,
    # patch, put, delete, options) to ensure only authorized user can request the
    # Jupyter server
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({
            "data": "This is /dsc10-tutor-jlab-backend/get-example endpoint!"
        }))


class LogAutograderHandler(APIHandler):
    """Handler for logging autograder execution events to Firebase"""

    @tornado.web.authenticated
    def post(self):
        try:
            data = json.loads(self.request.body.decode("utf-8"))

            required_fields = ["grader_id", "output", "success"]
            for field in required_fields:
                if field not in data:
                    self.set_status(400)
                    self.finish(json.dumps({
                        "error": f"Missing required field: {field}"
                    }))
                    return

            if FIREBASE_AVAILABLE:
                try:
                    db = firestore.client()
                    doc_ref = db.collection("autograder_events").document()
                    doc_ref.set({
                        "grader_id": data["grader_id"],
                        "output": data["output"],
                        "success": data["success"],
                        "timestamp": firestore.SERVER_TIMESTAMP
                    })
                    self.finish(json.dumps({
                        "status": "success",
                        "message": "Autograder event logged successfully"
                    }))
                except Exception as e:
                    error_msg = f"Error logging to Firebase: {e}"
                    print(error_msg)
                    import traceback
                    traceback.print_exc()
                    self.set_status(500)
                    self.finish(json.dumps({
                        "error": "Failed to log to Firebase",
                        "details": str(e)
                    }))
            else:
                error_msg = "Firebase not configured or not available. Check backend logs and .env file."
                self.set_status(503)  # Service Unavailable
                self.finish(json.dumps({
                    "error": "Firebase logging not available",
                    "message": error_msg
                }))

        except json.JSONDecodeError:
            self.set_status(400)
            self.finish(json.dumps({
                "error": "Invalid JSON in request body"
            }))
        except Exception as e:
            self.set_status(500)
            self.finish(json.dumps({
                "error": "Internal server error",
                "details": str(e)
            }))


def setup_handlers(web_app):
    host_pattern = ".*$"

    base_url = web_app.settings["base_url"]
    
    route_pattern_example = url_path_join(base_url, "dsc10-tutor-jlab-backend", "get-example")
    
    route_pattern_log = url_path_join(base_url, "dsc10-tutor-jlab-backend", "log")
    
    handlers = [
        (route_pattern_example, RouteHandler),
        (route_pattern_log, LogAutograderHandler)
    ]
    web_app.add_handlers(host_pattern, handlers)
