from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import json
import os
import re

# Create app with CORS configuration
app = FastAPI()

# Configure CORS with explicit parameters
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

@app.get("/")
def read_root():
    return {"message": "Backend API is running"}

# N8N webhook URL - make it configurable via environment or use test mode
N8N_WEBHOOK_URL = os.getenv(
    "N8N_WEBHOOK_URL",
    "https://sltrnddigitallab.app.n8n.cloud/webhook/39030de0-436a-485b-9f6b-21f81f6e5f8a"
)
USE_TEST_MODE = os.getenv("USE_TEST_MODE", "false").lower() == "true"

class SupportQuery(BaseModel):
    agent: str
    subscriber_id: str
    query: str

@app.post("/support-query")
def handle_support(query: SupportQuery):
    try:
        print(f"Frontend request: {query.model_dump()}")
        print(f"N8N URL: {N8N_WEBHOOK_URL}")
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

        response = requests.post(
            N8N_WEBHOOK_URL,
            json=payload,
            timeout=120
        )

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
        # N8N often returns [{...}] or [{"output": "..."}]
        if isinstance(n8n_response, list):
            if len(n8n_response) > 0:
                first = n8n_response[0]
                # If item has 'output' key pass it through for frontend parsing
                if "output" in first:
                    n8n_response = {"output": first["output"]}
                else:
                    n8n_response = first
            else:
                n8n_response = {"status": "empty", "message": "N8N returned empty array"}

        # ── Normalize ai_analysis string → keep as-is for frontend parser ─
        # The frontend's parseAITextOutput() handles the YAML-style text.
        # Only attempt JSON parsing here; leave plain text untouched.
        ai_raw = n8n_response.get("ai_analysis")
        if isinstance(ai_raw, str):
            try:
                n8n_response["ai_analysis"] = json.loads(ai_raw)
            except json.JSONDecodeError:
                # Leave as plain text string — frontend will parse it
                pass

        print(f"N8N response (normalised): {json.dumps(n8n_response, indent=2)}")
        
        return n8n_response

    except requests.exceptions.ConnectionError as conn_error:
        print(f"Connection error: {str(conn_error)}")
        return {
            "status": "error",
            "message": f"Cannot connect to N8N at {N8N_WEBHOOK_URL}",
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
        print(f"Response text was: {response.text}")
        return {
            "status": "error",
            "message": "N8N returned invalid JSON",
            "reply": "The N8N workflow did not return valid data. Check N8N logs.",
            "debug": str(json_error),
            "raw_response": response.text[:500]  # First 500 chars of response
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