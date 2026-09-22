import requests

def call_email_agent(message: str, user_id: str, thread_id: str, timeout: int = 120):
    url = "https://aiagents.sltdigitallab.lk/api/v1/chat"
    
    # 🎯 මෙන්න මේ Headers ටික අනිවාර්යයෙන්ම දාන්න ඕනේ:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"  # SSE වෙනුවට Normal JSON එවන්න කියන්නේ මෙන්න මේකෙන්
    }
    
    payload = {
        "message": message,
        "agent_id": "backoffice_email",
        "user_id": user_id,
        "thread_id": thread_id
    }
    
    # headers=headers සහ timeout=120 එකතු කරන්න
    response = requests.post(url, json=payload, headers=headers, timeout=timeout)
    return response