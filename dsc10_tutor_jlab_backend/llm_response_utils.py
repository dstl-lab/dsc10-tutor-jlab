import re



def parse_llm_response(text: str):
    tutor_match = re.search(
        r"---TUTOR_RESPONSE_START---(.*?)---TUTOR_RESPONSE_END---",
        text,
        re.DOTALL,
    )

    followup_match = re.search(
        r"---FOLLOW_UP_QUESTIONS_START---(.*?)---FOLLOW_UP_QUESTIONS_END---",
        text,
        re.DOTALL,
    )

    tutor_response = tutor_match.group(1).strip() if tutor_match else text
    followup_block = followup_match.group(1).strip() if followup_match else ""

    # Fallback: if model omitted markers but wrote "Conceptual:" / "Coding:" with numbered list, use that
    if not followup_block and ("Conceptual:" in text or "Coding:" in text):
        fallback = re.search(
            r"(Conceptual:.*?)(?=---|\Z)",
            text,
            re.DOTALL | re.IGNORECASE,
        )
        if fallback:
            followup_block = fallback.group(1).strip()

    return tutor_response, followup_block


def extract_followup_questions(followup_block: str):
    if not followup_block or "None" in followup_block:
        return []

   
    questions = re.findall(r"\d+[.)]\s*(.+)", followup_block)
    questions = [q.strip() for q in questions]

    if len(questions) < 2 or len(questions) > 4:
        return []
    return questions[:4]
