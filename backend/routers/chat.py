from fastapi import APIRouter
from llm import get_client  # noqa: F401  — used from Day 4 onwards

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/sessions")
async def list_sessions():
    """TODO Day 4: list chat sessions for the authenticated company."""
    return {"detail": "not implemented"}


@router.post("/sessions")
async def create_session():
    """TODO Day 4: create a new chat session."""
    return {"detail": "not implemented"}


@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: str):
    """TODO Day 4: send message, get RAG response, store history."""
    return {"detail": "not implemented"}


@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    """TODO Day 4: retrieve message history for a session."""
    return {"detail": "not implemented"}
