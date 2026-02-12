from typing import Dict, List, Tuple
import uuid

_CONVERSATIONS: Dict[str, List[Tuple[str, str]]] = {}


def create_conversation() -> str:
    conversation_id = str(uuid.uuid4())
    _CONVERSATIONS[conversation_id] = []
    return conversation_id


def get_history(conversation_id: str | None) -> tuple[str, str]:
    """
    Returns:
      (formatted_history, conversation_id)
    """
    if conversation_id is None or conversation_id not in _CONVERSATIONS:
        conversation_id = create_conversation()

    history = _CONVERSATIONS[conversation_id]

    formatted = []
    for role, message in history:
        formatted.append(f"{role.capitalize()}:\n{message}")

    return "\n\n".join(formatted), conversation_id


def append_message(
    conversation_id: str,
    student_message: str,
    tutor_message: str,
):
    _CONVERSATIONS[conversation_id].append(("student", student_message))
    _CONVERSATIONS[conversation_id].append(("tutor", tutor_message))


def reset_history(_: str | None = None) -> str:
    return create_conversation()
