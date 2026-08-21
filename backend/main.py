from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import requests
import json
import os
import re
import urllib.request
from jose import jwt, JWTError

# Create app with CORS configuration
app = FastAPI(title="Blitz.ai BackOffice Support System API")

# Configure CORS with explicit parameters
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://backofficeagent.sltdigitallab.lk",
        "http://backofficeagent.sltdigitallab.lk",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

# ═════════════════════════════════════════════════════════════════════════════
# Azure AD Authentication & Security Settings
# ═════════════════════════════════════════════════════════════════════════════
AZURE_TENANT_ID = os.getenv("AZURE_TENANT_ID", "534253fc-dfb6-462f-b5ca-cbe81939f5ee")
AZURE_CLIENT_ID = os.getenv("AZURE_CLIENT_ID", "1be92fb6-e237-4bd6-ae1e-f2c4644d1766")
JWKS_URL = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/discovery/v2.0/keys"

security = HTTPBearer(auto_error=False)
_jwks_cache = None

def get_jwks():
    global _jwks_cache
    if _jwks_cache is None:
        try:
            req = urllib.request.Request(JWKS_URL, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                _jwks_cache = json.loads(resp.read().decode())
        except Exception as e:
            print(f"Error fetching Azure AD JWKS keys from {JWKS_URL}: {e}")
    return _jwks_cache

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Validates the Microsoft Azure AD O365 JWT Bearer token on incoming API requests.
    """
    # Allow bypassing authentication if AUTH_DISABLED=true (e.g. for isolated internal tests)
    if os.getenv("AUTH_DISABLED", "false").lower() == "true":
        return {"preferred_username": "dev@slt.lk", "name": "Developer (Auth Disabled)"}

    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in with your SLT Microsoft account.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    token = credentials.credentials
    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing 'kid' in header."
            )

        jwks = get_jwks()
        if not jwks:
            global _jwks_cache
            _jwks_cache = None
            jwks = get_jwks()

        key = None
        for k in (jwks or {}).get("keys", []):
            if k.get("kid") == kid:
                key = k
                break

        if not key:
            # Refresh cache once in case keys rotated
            _jwks_cache = None
            jwks = get_jwks()
            for k in (jwks or {}).get("keys", []):
                if k.get("kid") == kid:
                    key = k
                    break

        if not key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: unknown signing key."
            )

        # Decode token with RSA256 signature and expiration verification
        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            options={
                "verify_aud": False,
                "verify_signature": True,
                "verify_exp": True
            }
        )

        user_email = payload.get("preferred_username") or payload.get("email") or payload.get("upn")
        print(f"Authenticated user: {user_email}")
        return payload

    except JWTError as e:
        print(f"JWT Validation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"}
        )
    except Exception as e:
        print(f"Authentication exception: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token validation failed.",
            headers={"WWW-Authenticate": "Bearer"}
        )

@app.get("/")
def read_root():
    return {"message": "Backend API is running", "auth": "Microsoft Azure AD Enabled"}

# N8N webhook URL - make it configurable via environment or use test mode
N8N_WEBHOOK_URL = os.getenv(
    "N8N_WEBHOOK_URL",
    "https://sltrnddigitallab.app.n8n.cloud/webhook/e3713862-9787-49d5-b00d-445f1a17cdc6"
)
USE_TEST_MODE = os.getenv("USE_TEST_MODE", "false").lower() == "true"

# Usage Agent n8n webhook URL (local instance)
USAGE_N8N_WEBHOOK_URL = os.getenv(
    "USAGE_N8N_WEBHOOK_URL",
    "https://sltrnddigitallab.app.n8n.cloud/webhook/891a401b-46cf-4c67-b3d6-f0eb128bbee7"
)

# Configuration Agent n8n webhook URL
CONFIG_N8N_WEBHOOK_URL = os.getenv(
    "CONFIG_N8N_WEBHOOK_URL",
    "https://sltrnddigitallab.app.n8n.cloud/webhook/bddee54a-4c52-4c92-9e1f-f552b48e8e2e"
)

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

@app.post("/main-agent-chat")
def handle_main_agent_chat(request: MainAgentChatRequest, user_token: dict = Depends(verify_token)):
    try:
        print(f"Main Agent request: {request.model_dump()} (User: {user_token.get('preferred_username', 'Unknown')})")
        print(f"Main Agent N8N URL: {N8N_WEBHOOK_URL}")

        payload = {
            "action": "sendMessage",
            "chatInput": request.message,
            "sessionId": request.session_id
        }

        # Chat trigger node requires action=sendMessage query parameter in the URL
        url = N8N_WEBHOOK_URL
        if "action=" not in url:
            connector = "&" if "?" in url else "?"
            url += f"{connector}action=sendMessage"

        response = requests.post(
            url,
            json=payload,
            timeout=300
        )

        print(f"Main Agent N8N HTTP Status: {response.status_code}")
        print(f"Main Agent N8N Raw Response: {response.text[:1000]}")

        response.raise_for_status()

        if not response.text.strip():
            return {"error": "n8n returned an empty response. Make sure the Main Agent workflow is active."}

        n8n_data = response.json()

        # Unwrap list responses
        if isinstance(n8n_data, list):
            n8n_data = n8n_data[0] if len(n8n_data) > 0 else {}

        # Extract the reply text from the n8n Respond to Webhook output
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

@app.post("/email-chat")
def handle_email_chat(request: EmailChatRequest, user_token: dict = Depends(verify_token)):
    try:
        print(f"Email agent request: {request.model_dump()} (User: {user_token.get('preferred_username', 'Unknown')})")
        url = "https://aiagents.sltdigitallab.lk/api/v1/chat"
        payload = {
            "message": request.message,
            "agent_id": "backoffice_email",
            "user_id": request.user_id,
            "thread_id": request.thread_id
        }
        response = requests.post(url, json=payload, timeout=60)
        response.raise_for_status()
        print(f"Email agent response: {response.text}")
        return {"reply": response.text}
    except Exception as e:
        print(f"Email agent error: {str(e)}")
        return {"error": str(e)}

@app.post("/usage-chat")
def handle_usage_chat(request: UsageChatRequest, user_token: dict = Depends(verify_token)):
    try:
        print(f"Usage agent request: {request.model_dump()} (User: {user_token.get('preferred_username', 'Unknown')})")
        print(f"Usage N8N URL: {USAGE_N8N_WEBHOOK_URL}")

        response = requests.post(
            USAGE_N8N_WEBHOOK_URL,
            json={"query": request.query, "session_id": request.session_id},
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
        if isinstance(n8n_data, list):
            n8n_data = n8n_data[0] if len(n8n_data) > 0 else {}

        print(f"Usage N8N parsed response: {json.dumps(n8n_data, indent=2)[:1000]}")
        return n8n_data

    except requests.exceptions.ConnectionError:
        return {"error": f"Cannot connect to n8n at {USAGE_N8N_WEBHOOK_URL}. Is your local n8n running?"}
    except requests.exceptions.HTTPError as e:
        return {"error": f"n8n returned HTTP {e.response.status_code}. Check that the workflow is Active (not just saved)."}
    except Exception as e:
        print(f"Usage agent error: {str(e)}")
        return {"error": str(e)}

@app.post("/support-query")
def handle_support(query: SupportQuery, user_token: dict = Depends(verify_token)):
    try:
        print(f"Frontend request: {query.model_dump()} (User: {user_token.get('preferred_username', 'Unknown')})")
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

        response = requests.post(
            CONFIG_N8N_WEBHOOK_URL,
            json=payload,
            timeout=300
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