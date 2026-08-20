"""
Router for the Usage Agent chat endpoint (/usage-chat).
"""
import json

import requests
from fastapi import APIRouter

from app.config import USAGE_N8N_WEBHOOK_URL
from app.models import UsageChatRequest
from app.services.n8n_client import call_webhook, unwrap_list_response

router = APIRouter()


@router.post("/usage-chat")
def handle_usage_chat(request: UsageChatRequest):
    try:
        print(f"Usage agent request: {request.model_dump()}")
        print(f"Usage N8N URL: {USAGE_N8N_WEBHOOK_URL}")

        response = call_webhook(
            USAGE_N8N_WEBHOOK_URL,
            {"query": request.query, "session_id": request.session_id},
            timeout=120
        )

        print(f"Usage N8N HTTP Status: {response.status_code}")
        print(f"Usage N8N Raw Response: {response.text[:500]}")

        response.raise_for_status()

        if response.text.strip():
            n8n_data = response.json()
        else:
            return {"error": "n8n returned an empty response. Make sure the workflow is active."}

        # Unwrap if n8n returns a list
        n8n_data = unwrap_list_response(n8n_data)

        print(f"Usage N8N parsed response: {json.dumps(n8n_data, indent=2)[:1000]}")
        return n8n_data

    except requests.exceptions.ConnectionError:
        return {"error": f"Cannot connect to n8n at {USAGE_N8N_WEBHOOK_URL}. Is your local n8n running?"}
    except requests.exceptions.HTTPError as e:
        return {"error": f"n8n returned HTTP {e.response.status_code}. Check that the workflow is Active (not just saved)."}
    except Exception as e:
        print(f"Usage agent error: {str(e)}")
        return {"error": str(e)}