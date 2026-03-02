import json
import logging
import traceback

from jupyter_server.base.handlers import APIHandler
import tornado

from .retriever import get_practice_problems
from .formatter import format_problems_response

logger = logging.getLogger(__name__)


class PracticeProblemsHandler(APIHandler):
        
    @tornado.web.authenticated
    async def post(self):
        try:
            body = json.loads(self.request.body)
            topic_query = body.get("topic_query", "").strip()
            
            if not topic_query:
                self.set_status(400)
                self.finish(json.dumps({
                    "error": "topic_query parameter is required"
                }))
                return
            
            problems = get_practice_problems(
                topic_query=topic_query,
                max_problems=5,
                use_gemini_fallback=True,
                rank_by_relevance=True 
            )
                        
            formatted_response = format_problems_response(problems, topic_query)
            
            result = {
                "problems": problems,
                "formatted_response": formatted_response,
                "count": len(problems)
            }
            
            self.finish(json.dumps(result))
            
        except Exception as e:
            error_trace = traceback.format_exc()
            self.set_status(500)
            self.finish(json.dumps({
                "error": str(e),
                "traceback": error_trace
            }))

