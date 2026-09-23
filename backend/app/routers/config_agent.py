"""
Router for the Configuration / Support Agent endpoint (/support-query).
"""
import json
import re

import requests
from fastapi import APIRouter

from app.config import CONFIG_N8N_WEBHOOK_URL, N8N_WEBHOOK_URL, USE_TEST_MODE
from app.models import SupportQuery
from app.services.n8n_client import call_webhook, unwrap_list_response

router = APIRouter()


def _extract_clean_summary(raw_summary):
    """
    ai_analysis.customer_output.summary eka double-encoded JSON string ekak
    widihata enawanam (n8n Code node eke JSON.stringify() dewenak karala),
    eken thiyena real 'summary' text eka extract karagannawa.
    Normal plain text ekak nam, ehemama return karanawa.
    """
    if not isinstance(raw_summary, str):
        return raw_summary

    text = raw_summary.strip()

    # Double/triple-encoded JSON widihata pennenawada balanawa (e.g. starts with '{' and has \" escapes)
    if text.startswith("{") and '\\"' in text:
        try:
            # Escape backslash-quotes ain karala, real JSON widihata parse karanna try karanawa
            # Nested/malformed unath, regex ekakin 'summary' field eka pluck karagannawa
            match = re.search(r'"summary"\s*:\s*"([^"]+?)"\s*[,}]', text)
            if match:
                return match.group(1).strip()

            # Fallback: try direct JSON parse (single-encoded nam meka work karayi)
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                inner = parsed.get("customer_output", {}).get("summary")
                if inner:
                    return inner
        except Exception:
            pass

    return text


def _clean_workflow_execution(steps):
    """
    developer_output.workflow_execution eke thiyena malformed/broken JSON
    fragment strings, readable widihata clean karanawa. Parse karanna
    behe unath, raw text eka witharak return karanawa (crash wenne na).
    """
    if not isinstance(steps, list):
        return steps

    cleaned = []
    for step in steps:
        if isinstance(step, str):
            # Escaped quotes saha extra JSON syntax ain karala readable karanawa
            s = step.replace('\\"', '"').replace('\\n', ' ')
            s = re.sub(r'[{}\[\]=]', '', s)
            s = re.sub(r'"execution_trace"\s*:?\s*', '', s)
            s = re.sub(r'\s+', ' ', s).strip(' ",')
            if s:
                cleaned.append(s)
        else:
            cleaned.append(step)
    return cleaned


@router.post("/support-query")
def handle_support(query: SupportQuery):
    response = None
    try:
        print(f"Frontend request: {query.model_dump()}")
        print(f"N8N URL: {CONFIG_N8N_WEBHOOK_URL}")
        print(f"Test mode: {USE_TEST_MODE}")

        # Test mode - returns mock response without calling N8N
        if USE_TEST_MODE:
            print("Using TEST MODE - returning mock response")
            n8n_response = {
                "api_data": query.model_dump(),
                "ai_analysis": {
                    "customer_output": {
                        "summary": f"Test Response: Customer {query.subscriber_id} using {query.agent}. Query: {query.query}"
                    },
                    "developer_output": {
                        "workflow_execution": [
                            "Chat triggered",
                            "Customer ID received",
                            "Test mode active - mock response generated",
                            "Response completed"
                        ]
                    }
                }
            }
            print(f"Mock response: {json.dumps(n8n_response, indent=2)}")
            return n8n_response

        # Production mode - call N8N webhook
        payload = query.model_dump()
        payload["customer_id"] = payload["subscriber_id"]
        payload["body"] = {"customer_id": payload["subscriber_id"]}
        print(f"Final payload sent to N8N: {payload}")

        response = call_webhook(CONFIG_N8N_WEBHOOK_URL, payload, timeout=300)

        print(f"N8N HTTP Status: {response.status_code}")
        print(f"N8N Response Headers: {dict(response.headers)}")
        print(f"N8N Raw Response: {response.text}")

        response.raise_for_status()

        # Try to parse JSON
        if response.text.strip():
            n8n_response = response.json()
        else:
            # Empty response - N8N workflow executed but returned nothing
            n8n_response = {
                "status": "success",
                "message": "N8N workflow executed successfully (empty response)",
                "ai_analysis": {
                    "customer_output": {
                        "summary": "Your request has been processed."
                    },
                    "developer_output": {
                        "workflow_execution": ["Webhook triggered", "Workflow executed"]
                    }
                }
            }

        # ── Unwrap N8N array responses ─────────────────────────────────
        if isinstance(n8n_response, list):
            if len(n8n_response) > 0:
                first = n8n_response[0]
                if "output" in first:
                    n8n_response = {"output": first["output"]}
                else:
                    n8n_response = first
            else:
                n8n_response = {"status": "empty", "message": "N8N returned empty array"}

        # ── Normalize ai_analysis string → keep as-is for frontend parser ─
        ai_raw = n8n_response.get("ai_analysis")
        if isinstance(ai_raw, str):
            try:
                n8n_response["ai_analysis"] = json.loads(ai_raw)
            except json.JSONDecodeError:
                pass

        # ── NEW: Clean double-encoded customer_output.summary ──────────
        ai_analysis = n8n_response.get("ai_analysis")
        if isinstance(ai_analysis, dict):
            customer_output = ai_analysis.get("customer_output")
            if isinstance(customer_output, dict) and "summary" in customer_output:
                customer_output["summary"] = _extract_clean_summary(customer_output["summary"])

            # ── NEW: Clean malformed workflow_execution steps ──────────
            developer_output = ai_analysis.get("developer_output")
            if isinstance(developer_output, dict) and "workflow_execution" in developer_output:
                developer_output["workflow_execution"] = _clean_workflow_execution(
                    developer_output["workflow_execution"]
                )

        # ── NEW: If backend API call itself failed (ECONNREFUSED etc), flag it ──
        api_data = n8n_response.get("api_data")
        if isinstance(api_data, dict) and isinstance(api_data.get("error"), dict):
            n8n_response["backend_api_status"] = "unreachable"
            n8n_response["backend_api_error_code"] = api_data["error"].get("code", "UNKNOWN")

        print(f"N8N response (normalised): {json.dumps(n8n_response, indent=2)}")

        return n8n_response

    except requests.exceptions.ConnectionError as conn_error:
        print(f"Connection error: {str(conn_error)}")
        return {
            "status": "error",
            "message": f"Cannot connect to N8N at {CONFIG_N8N_WEBHOOK_URL}",
            "reply": "N8N service is unreachable. Please verify the webhook URL and ensure N8N is running.",
            "debug": str(conn_error)
        }
    except requests.exceptions.HTTPError as http_error:
        print(f"HTTP error: {str(http_error)}")
        return {
            "status": "error",
            "message": f"N8N returned HTTP {http_error.response.status_code}",
            "reply": "The N8N webhook URL is incorrect or the webhook is not active.",
            "debug": str(http_error),
            "url_being_used": N8N_WEBHOOK_URL
        }
    except json.JSONDecodeError as json_error:
        print(f"JSON decode error: {str(json_error)}")
        print(f"Response text was: {response.text if response is not None else ''}")
        return {
            "status": "error",
            "message": "N8N returned invalid JSON",
            "reply": "The N8N workflow did not return valid data. Check N8N logs.",
            "debug": str(json_error),
            "raw_response": response.text[:500] if response is not None else ""
        }
    except requests.exceptions.RequestException as req_error:
        print(f"Request error: {str(req_error)}")
        return {
            "status": "error",
            "message": str(req_error),
            "reply": "Failed to reach support service"
        }
    except Exception as e:
        print(f"General error: {str(e)}")
        return {
            "status": "error",
            "message": str(e),
            "reply": "System temporarily unavailable"
        }