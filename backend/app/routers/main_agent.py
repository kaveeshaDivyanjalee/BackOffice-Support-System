"""
Router for the Main Agent chat endpoint (/main-agent-chat).
"""
import requests
from fastapi import APIRouter

from app.config import N8N_WEBHOOK_URL
from app.models import MainAgentChatRequest
from app.services.n8n_client import call_webhook, ensure_action_param, unwrap_list_response

router = APIRouter()


@router.post("/main-agent-chat")
def handle_main_agent_chat(request: MainAgentChatRequest):
    try:
        print(f"Main Agent request: {request.model_dump()}")
        print(f"Main Agent N8N URL: {N8N_WEBHOOK_URL}")

        payload = {
            "action": "sendMessage",
            "chatInput": request.message,
            "sessionId": request.session_id
        }

        # Chat trigger node requires action=sendMessage query parameter in the URL
        url = ensure_action_param(N8N_WEBHOOK_URL)

        response = call_webhook(url, payload, timeout=300)

        print(f"Main Agent N8N HTTP Status: {response.status_code}")
        print(f"Main Agent N8N Raw Response: {response.text[:1000]}")

        response.raise_for_status()

        if not response.text.strip():
            return {"error": "n8n returned an empty response. Make sure the Main Agent workflow is active."}

        n8n_data = response.json()

        # Unwrap list responses
        n8n_data = unwrap_list_response(n8n_data)

        # Extract the reply text from the n8n Respond to Webhook output
        # The Main Agent uses "respondWith: allIncomingItems", so output key is "output"
        reply = (
            n8n_data.get("output")
            or n8n_data.get("reply")
            or n8n_data.get("ai_analysis", {}).get("customer_output", {}).get("summary")
            or str(n8n_data)
        )

        # Extract exact tool called from n8n LangChain intermediateSteps if available
        agent_used = None
        if isinstance(n8n_data, dict):
            steps = n8n_data.get("intermediateSteps") or n8n_data.get("intermediate_steps") or []
            if isinstance(steps, list) and len(steps) > 0:
                first_action = steps[0].get("action", {})
                if isinstance(first_action, dict):
                    agent_used = first_action.get("tool")

            # Also check if tool name is returned directly
            if not agent_used:
                agent_used = n8n_data.get("toolName") or n8n_data.get("tool")

        print(f"Main Agent reply: {str(reply)[:500]}")
        print(f"Main Agent extracted tool: {agent_used}")
        return {"reply": reply, "agent_used": agent_used, "raw": n8n_data}

    except requests.exceptions.ConnectionError:
        return {"error": f"Cannot connect to n8n at {N8N_WEBHOOK_URL}. Is n8n running?"}
    except requests.exceptions.HTTPError as e:
        return {"error": f"n8n returned HTTP {e.response.status_code}. Check that the Main Agent workflow is Active."}
    except Exception as e:
        print(f"Main Agent error: {str(e)}")
        return {"error": str(e)}