from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ALLOW_ORIGINS
from app.routers import config_agent, email_agent, main_agent, usage_agent

# Create app with CORS configuration
app = FastAPI()

# Configure CORS with explicit parameters
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)


@app.get("/")
def read_root():
    return {"message": "Backend API is running"}


# Register routers
app.include_router(main_agent.router)
app.include_router(usage_agent.router)
app.include_router(config_agent.router)
app.include_router(email_agent.router)