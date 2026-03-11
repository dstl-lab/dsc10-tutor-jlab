import json
import logging
import traceback

import tornado
from jupyter_server.base.handlers import APIHandler

from .formatter import format_problems_response
from .lecture_mapper import get_lectures_from_tutor
from .ranker import rank_problems_by_relevance
from .retriever import (
    get_practice_problems,
    get_problems_by_lecture,
    get_random_exam_question,
)

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
            
            max_problems = 5

            problems = get_practice_problems(
                topic_query=topic_query,
                max_problems=max_problems,
                use_gemini_fallback=False,
                rank_by_relevance=True,
            )

            if not problems:
                lecture_numbers = await get_lectures_from_tutor(topic_query)
                if lecture_numbers:
                    candidate_problems = get_problems_by_lecture(lecture_numbers)
                    if candidate_problems:
                        problems = rank_problems_by_relevance(
                            candidate_problems,
                            topic_query,
                            max_problems=max_problems,
                            use_gemini=True,
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


class RandomExamQuestionHandler(APIHandler):
    """Return a single random question from a previous midterm or final exam."""

    @tornado.web.authenticated
    async def get(self):
        try:
            exam_type = self.get_argument("exam_type", None)
            # Validate the exam_type argument to prevent unexpected values
            if exam_type is not None and exam_type not in ("midterm", "final"):
                self.set_status(400)
                self.finish(json.dumps({"error": "exam_type must be 'midterm' or 'final'"}))
                return

            problem = get_random_exam_question(exam_type=exam_type)

            if problem is None:
                self.set_status(404)
                self.finish(json.dumps({
                    "error": "No exam problems available. Run the exam crawler first."
                }))
                return

            self.finish(json.dumps({"problem": problem}))

        except Exception as e:
            error_trace = traceback.format_exc()
            self.set_status(500)
            self.finish(json.dumps({
                "error": str(e),
                "traceback": error_trace
            }))

