"""
Environment variables + settings for the BackOffice Support System backend.
"""
import os

# Main Agent n8n webhook URL
N8N_WEBHOOK_URL = os.getenv(
    "N8N_WEBHOOK_URL",
    "https://sltrnddigitallab.app.n8n.cloud/webhook/e3713862-9787-49d5-b00d-445f1a17cdc6"
)

# Test mode toggle (used by the Config/Support agent)
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

# External Email Agent API endpoint
EMAIL_AGENT_API_URL = os.getenv(
    "EMAIL_AGENT_API_URL",
    "https://aiagents.sltdigitallab.lk/api/v1/chat"
)

# CORS allowed origins
CORS_ALLOW_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://backofficeagent.sltdigitallab.lk",
    "http://backofficeagent.sltdigitallab.lk",
    "*",
]