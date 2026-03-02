import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from llm import get_client
from models import ChatMessage, ChatSession, Document
from services.ragflow_client import RAGFlowClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    question: str
    company_id: str


@router.post("")
async def chat(body: ChatRequest, db: Session = Depends(get_db)):
    # Collect all dataset IDs for this company
    docs = (
        db.query(Document)
        .filter(
            Document.company_id == body.company_id,
            Document.ragflow_kb_id.isnot(None),
        )
        .all()
    )
    dataset_ids = list({d.ragflow_kb_id for d in docs if d.ragflow_kb_id})

    chunks: list[dict] = []
    if dataset_ids:
        ragflow = RAGFlowClient()
        try:
            chunks = await ragflow.query(dataset_ids, body.question)
        except Exception as exc:
            logger.warning("RAGFlow query failed: %s", exc)

    # Build prompt
    context_text = "\n\n".join(
        c.get("content", c.get("text", "")) for c in chunks
    )
    system_prompt = (
        "You are a helpful document assistant. "
        "Answer the user's question using only the provided context excerpts. "
        "If the context does not contain enough information, say so honestly."
    )
    user_message = (
        f"Context:\n{context_text}\n\nQuestion: {body.question}"
        if context_text
        else body.question
    )

    # Generate answer via LLM
    llm_client, model = get_client()
    try:
        response = await llm_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
        )
        answer = response.choices[0].message.content or ""
    except Exception as exc:
        logger.error("LLM call failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}")

    # Build sources list
    sources = []
    for chunk in chunks:
        sources.append(
            {
                "filename": chunk.get("document_keyword", chunk.get("doc_name", "")),
                "page": chunk.get("positions", [None])[0],
                "excerpt": (chunk.get("content", chunk.get("text", "")) or "")[:200],
            }
        )

    # Persist to DB — find or create a ChatSession for this company
    session = (
        db.query(ChatSession)
        .filter(ChatSession.company_id == body.company_id)
        .order_by(ChatSession.created_at.desc())
        .first()
    )
    if not session:
        session = ChatSession(company_id=body.company_id, title=body.question[:80])
        db.add(session)
        db.commit()
        db.refresh(session)

    db.add(ChatMessage(session_id=session.id, role="user", content=body.question))
    db.add(ChatMessage(session_id=session.id, role="assistant", content=answer))
    db.commit()

    return {"answer": answer, "sources": sources}


@router.get("/history")
def chat_history(company_id: str, db: Session = Depends(get_db)):
    session = (
        db.query(ChatSession)
        .filter(ChatSession.company_id == company_id)
        .order_by(ChatSession.created_at.desc())
        .first()
    )
    if not session:
        return []

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
        .all()
    )
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
        }
        for m in messages
    ]
