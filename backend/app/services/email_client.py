"""
Client logic for calling the external Email Agent API.
"""
import requests

from app.config import EMAIL_AGENT_API_URL


def call_email_agent(message: str, user_id: str, thread_id: str, timeout: int = 60) -> requests.Response:
    """POST a chat message to the external email agent API and return the raw response."""
    payload = {
        "message": message,
        "agent_id": "backoffice_email",
        "user_id": user_id,
        "thread_id": thread_id,
    }
    return requests.post(EMAIL_AGENT_API_URL, json=payload, timeout=timeout)