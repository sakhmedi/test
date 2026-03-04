import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth_utils import get_current_user
from database import get_db
from llm import get_client
from models import ChatMessage, ChatSession, Document
from services.ragflow_client import RAGFlowClient
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
    question: str = Field(..., min_length=1)  # FIXED: reject empty questions


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

    # Collect all dataset IDs for this company
    docs = (
        db.query(Document)
        .filter(
            Document.company_id == company_id,
            Document.ragflow_kb_id.isnot(None),
        )
        .all()
    )
    dataset_ids = list({d.ragflow_kb_id for d in docs if d.ragflow_kb_id})

    chunks: list[dict] = []
    if dataset_ids:
        ragflow = RAGFlowClient()
        retrieval_span = None
        if trace:
            try:
                retrieval_span = trace.span(name="retrieval", input={"query": body.question})
            except Exception:
                pass
        try:
            chunks = await ragflow.query(dataset_ids, body.question)
        except Exception as exc:
            logger.warning("RAGFlow query failed: %s", exc)
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
                "filename": chunk.get("document_keyword", chunk.get("doc_name", "")),
                "page": chunk.get("positions", [None])[0],
                "excerpt": (chunk.get("content", chunk.get("text", "")) or "")[:200],
            }
        )

    # Persist to DB — find or create a ChatSession for this company
    session = (
        db.query(ChatSession)
        .filter(ChatSession.company_id == company_id)
        .order_by(ChatSession.created_at.desc())
        .first()
    )
    if not session:
        session = ChatSession(company_id=company_id, title=body.question[:80])
        db.add(session)
        db.commit()
        db.refresh(session)

    db.add(ChatMessage(session_id=session.id, role="user", content=body.question))
    db.add(ChatMessage(session_id=session.id, role="assistant", content=answer))
    db.commit()

    return {"answer": answer, "sources": sources}


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

    # FIXED: sort ASC for chronological order; removed incorrect DESC+limit reversal
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
