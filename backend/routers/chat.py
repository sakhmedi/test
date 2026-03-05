import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth_utils import get_current_user
from database import get_db
from llm import get_client
from models import ChatMessage, ChatSession, Document
from services.embedder_client import EmbedderClient
from services.milvus_store import MilvusStore
from services.reranker_client import RerankerClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# Langfuse is optional — gracefully skip if not configured
try:
    from langfuse import Langfuse
    _langfuse = Langfuse(
        secret_key=os.getenv("LANGFUSE_SECRET_KEY", ""),
        public_key=os.getenv("LANGFUSE_PUBLIC_KEY", ""),
        host=os.getenv("LANGFUSE_HOST", "http://langfuse:3000"),
    )
except Exception:
    _langfuse = None

# Silence Langfuse SDK's internal retry/error logs — errors are non-critical
if _langfuse:
    import logging as _logging
    _logging.getLogger("langfuse").setLevel(_logging.CRITICAL)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1)
    session_id: str | None = None


@router.post("")
async def chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
    user_id = current_user["sub"]

    # Start Langfuse trace
    trace = None
    if _langfuse:
        try:
            trace = _langfuse.trace(name="chat", user_id=user_id, metadata={"company_id": company_id})
        except Exception as exc:
            logger.warning("Langfuse trace init failed: %s", exc)

    # Embed the question and search Milvus for relevant chunks
    chunks: list[dict] = []
    retrieval_span = None
    if trace:
        try:
            retrieval_span = trace.span(name="retrieval", input={"query": body.question})
        except Exception:
            pass
    try:
        embedder = EmbedderClient()
        query_vec = await embedder.embed_one(body.question)
        store = MilvusStore()

        # Scope search to documents uploaded in this session (if session exists)
        session_doc_ids: list[str] | None = None
        if body.session_id:
            session_doc_ids = [
                str(d.id)
                for d in db.query(Document.id)
                .filter(Document.session_id == body.session_id)
                .all()
            ]
            # If the session has scoped docs, filter; if empty list, no docs yet
            if not session_doc_ids:
                session_doc_ids = None  # fall back to company-wide for sessions with no docs

        chunks = store.search(company_id, query_vec, top_k=5, doc_ids=session_doc_ids)
    except Exception as exc:
        logger.warning("Milvus search failed: %s", exc)
    if retrieval_span:
        try:
            retrieval_span.end(output={"chunk_count": len(chunks)})
        except Exception:
            pass

    # Rerank chunks
    if chunks:
        try:
            reranker = RerankerClient()
            chunks = await reranker.rerank(body.question, chunks)
        except Exception as exc:
            logger.warning("Reranker failed, using original order: %s", exc)

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
    generation_span = None
    if trace:
        try:
            generation_span = trace.generation(
                name="llm",
                model=model,
                input=[{"role": "user", "content": user_message}],
            )
        except Exception:
            pass

    try:
        response = await llm_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            timeout=30,
        )
        answer = response.choices[0].message.content or ""
    except Exception as exc:
        logger.error("LLM call failed: %s", exc)
        if generation_span:
            try:
                generation_span.end(level="ERROR", status_message=str(exc))
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}")

    if generation_span:
        try:
            generation_span.end(output=answer)
        except Exception:
            pass
    if trace:
        import asyncio
        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, _langfuse.flush)

    # Build sources list
    sources = []
    for chunk in chunks:
        sources.append(
            {
                "filename": chunk.get("filename", ""),
                "page": chunk.get("page", None),
                "excerpt": chunk.get("text", "")[:200],
            }
        )

    # Persist to DB — find or create a ChatSession
    if body.session_id:
        # Use existing session if found, otherwise create new
        session = (
            db.query(ChatSession)
            .filter(ChatSession.id == body.session_id, ChatSession.company_id == company_id)
            .first()
        )
        if not session:
            session = ChatSession(company_id=company_id, title=body.question[:80])
            db.add(session)
            db.commit()
            db.refresh(session)
    else:
        # Always create a new session when no session_id provided
        session = ChatSession(company_id=company_id, title=body.question[:80])
        db.add(session)
        db.commit()
        db.refresh(session)

    db.add(ChatMessage(session_id=session.id, role="user", content=body.question))
    db.add(ChatMessage(session_id=session.id, role="assistant", content=answer))
    db.commit()

    return {"answer": answer, "sources": sources, "session_id": str(session.id)}


@router.get("/sessions")
def list_sessions(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.company_id == company_id)
        .order_by(ChatSession.created_at.desc())
        .all()
    )
    return [
        {
            "id": str(s.id),
            "title": s.title,
            "created_at": s.created_at.isoformat(),
        }
        for s in sessions
    ]


@router.get("/sessions/{session_id}")
def get_session_messages(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.company_id == company_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
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


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.company_id == company_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.query(ChatMessage).filter(ChatMessage.session_id == session.id).delete()
    # Detach any documents linked to this session so the FK constraint doesn't block deletion
    db.query(Document).filter(Document.session_id == session.id).update({"session_id": None})
    db.delete(session)
    db.commit()
    return {"detail": "deleted"}


@router.get("/history")
def chat_history(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
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
        .order_by(ChatMessage.created_at.asc())
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
