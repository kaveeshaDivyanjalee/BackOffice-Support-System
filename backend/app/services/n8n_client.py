"""
Common logic for calling n8n webhooks and normalising their responses.
Used by the main_agent, usage_agent and config_agent routers.
"""
import requests


def call_webhook(url: str, payload: dict, timeout: int = 300) -> requests.Response:
    """POST a payload to an n8n webhook URL and return the raw response."""
    return requests.post(url, json=payload, timeout=timeout)


def ensure_action_param(url: str, action: str = "sendMessage") -> str:
    """
    The n8n Chat Trigger node requires an action=<action> query parameter
    in the URL. Append it if it isn't already present.
    """
    if "action=" not in url:
        connector = "&" if "?" in url else "?"
        url += f"{connector}action={action}"
    return url


def unwrap_list_response(data):
    """
    n8n frequently returns a list-wrapped response, e.g. [{...}].
    Unwrap it to the first item (or an empty dict) so callers can
    work with a plain dict.
    """
    if isinstance(data, list):
        return data[0] if len(data) > 0 else {}
    return data