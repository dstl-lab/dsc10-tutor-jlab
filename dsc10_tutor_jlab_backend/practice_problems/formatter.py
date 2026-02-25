"""Format practice problems for display in chat."""

import re
from typing import List, Dict


def format_problems_response(problems: List[Dict], topic_query: str = "") -> str:
    """
    Format a list of problems into a readable response with direct links.
    """
    if not problems:
        return "I couldn't find any practice problems for that topic. Try asking about a specific DSC 10 concept like 'conditionals', 'groupby', or 'tables'."
    
    response_parts = []
    
    if topic_query:
        response_parts.append(f"Here are some practice problems about **{topic_query}**:\n")
    else:
        response_parts.append("Here are some practice problems:\n")
    
    response_parts.append("Click any link below to go directly to the problem on the practice website:\n")
    
    problems_by_lecture = {}
    for problem in problems:
        lecture_num = problem.get("lecture_number", 0)
        if lecture_num not in problems_by_lecture:
            problems_by_lecture[lecture_num] = []
        problems_by_lecture[lecture_num].append(problem)
    
    sorted_lectures = sorted(problems_by_lecture.keys())
    
    for lecture_num in sorted_lectures:
        lecture_problems = problems_by_lecture[lecture_num]
        
        response_parts.append(f"\n### 📚 Lecture {lecture_num}")
        
        for i, problem in enumerate(lecture_problems, 1):
            source_url = problem.get("source_url", "")
            source = problem.get("source", "")
            problem_text = problem.get("text", "")
            
            problem_title = "Problem"
            if problem_text:
                match = re.match(r"^(Problem\s+\d+(?:\.\d+)?)", problem_text, re.I)
                if match:
                    problem_title = match.group(1)
            
            link_text = f"**{problem_title}**"
            if source:
                link_text += f" — {source}"
            
            if source_url:
                response_parts.append(f"{i}. [{link_text}]({source_url})")
            else:
                response_parts.append(f"{i}. {link_text}")
        
        response_parts.append("")  
    
    response_parts.append(
        "\n💡 **Tip:** Click any link above to jump directly to that problem. "
        "Work through these problems on paper, just like you would on a quiz or exam."
    )
    
    return "\n".join(response_parts)

