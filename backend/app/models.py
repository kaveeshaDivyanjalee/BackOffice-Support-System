"""
Pydantic request/response schemas used across the BackOffice Support System backend.
"""
from pydantic import BaseModel


class SupportQuery(BaseModel):
    agent: str
    subscriber_id: str
    query: str


class EmailChatRequest(BaseModel):
    message: str
    user_id: str = "020601"
    thread_id: str = "default_thread"


class UsageChatRequest(BaseModel):
    query: str
    session_id: str = "default"


class MainAgentChatRequest(BaseModel):
    message: str
    session_id: str = "default_main_session"