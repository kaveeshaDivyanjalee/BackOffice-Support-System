import json
import re
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

        reply_text = ""

        # 1. Standard JSON format එකක්දැයි පරීක්ෂා කිරීම
        try:
            res_data = response.json()
            if isinstance(res_data, dict):
                reply_text = res_data.get("response") or res_data.get("output") or res_data.get("reply") or ""
        except Exception:
            pass

        # 2. JSON නොවේ නම් (SSE / Raw Text chunked response එකක් නම්) Clean කර ගැනීම
        if not reply_text:
            raw_text = response.text

            # SSE stream chunks (e.g. 'data: {"response": "..."}' or 'data: Hello') parse කිරීම
            extracted_chunks = []
            for line in raw_text.splitlines():
                line = line.strip()
                if line.startswith("data:"):
                    content = line[5:].strip()
                    try:
                        # Chunk එක JSON එකක් නම් text එක extract කිරීම
                        json_chunk = json.loads(content)
                        if isinstance(json_chunk, dict):
                            extracted_chunks.append(json_chunk.get("response") or json_chunk.get("text") or "")
                        else:
                            extracted_chunks.append(str(json_chunk))
                    except Exception:
                        extracted_chunks.append(content)

            if extracted_chunks:
                reply_text = " ".join(chunk for chunk in extracted_chunks if chunk)
            else:
                reply_text = raw_text

        # 3. Line breaks preserve කරලා, horizontal whitespace (spaces/tabs) විතරක් clean කිරීම
        reply_text = re.sub(r'[ \t]+', ' ', reply_text)      # multiple spaces/tabs -> single space
        reply_text = re.sub(r'\n{3,}', '\n\n', reply_text)   # 3+ consecutive newlines -> max 2
        reply_text = reply_text.strip()

        # 4. Strict Infrastructure / DevOps Query Guardrail Interceptor
        user_msg_lower = request.message.lower()

        # Userගේ ප්‍රශ්නයේ Infrastructure/DevOps technical terms තියෙනවාදැයි පරීක්ෂා කිරීම පමණක් සිදු කරයි
        infra_patterns = [
            r"frontend service", r"backend service", r"container name", r"internal port",
            r"health endpoint", r"health url", r"database service", r"database exporter",
            r"database name", r"prometheus", r"chroma", r"n/a because it does not exist",
            r"\bport\b", r"\bhost\b", r"\bcontainer\b", r"\bexporter\b"
        ]

        is_infra_query = any(re.search(pattern, user_msg_lower) for pattern in infra_patterns)

        if is_infra_query:
            reply_text = (
                "I'm here to assist with customer support inquiries related to SLT services. "
                "For technical details such as service names, container names, ports, databases, or "
                "infrastructure configurations, I recommend reaching out to your network administrator "
                "or referring to your company's technical documentation. If you have any issues related "
                "to email services, feel free to let me know!"
            )

        print(f"Email agent response: {reply_text}")
        return {"reply": reply_text}

    except Exception as e:
        print(f"Email agent error: {str(e)}")
        return {"error": str(e)}