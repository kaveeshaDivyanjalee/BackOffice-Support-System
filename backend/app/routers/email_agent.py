"""
Router for the Email Agent chat endpoint (/email-chat).
"""
from fastapi import APIRouter

from app.models import EmailChatRequest
from app.services.email_client import call_email_agent

router = APIRouter()


@router.post("/email-chat")
def handle_email_chat(request: EmailChatRequest):
    try:
        print(f"Email agent request: {request.model_dump()}")
        response = call_email_agent(
            message=request.message,
            user_id=request.user_id,
            thread_id=request.thread_id,
            timeout=60
        )
        response.raise_for_status()
        print(f"Email agent response: {response.text}")
        return {"reply": response.text}
    except Exception as e:
        print(f"Email agent error: {str(e)}")
        return {"error": str(e)}