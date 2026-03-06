import os
import uuid
import logging
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from auth_utils import get_current_user
from database import get_db
from models import Company, Document, ChatSession
from services.minio_client import MinIOClient
from services.ocr_client import VisionClient
from services.embedder_client import EmbedderClient
from services.text_extractor import extract_pages, chunk_pages
from services.milvus_store import MilvusStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

# Langfuse is optional — gracefully skip if not configured
_lf_secret = os.getenv("LANGFUSE_SECRET_KEY", "")
_lf_public = os.getenv("LANGFUSE_PUBLIC_KEY", "")
_lf_host   = os.getenv("LANGFUSE_HOST", "https://a1-langfuse1.alem.ai")

if _lf_secret and _lf_public:
    try:
        from langfuse import Langfuse
        _langfuse = Langfuse(secret_key=_lf_secret, public_key=_lf_public, host=_lf_host)
    except Exception:
        _langfuse = None
else:
    _langfuse = None  # Keys not set — Langfuse disabled

if _langfuse:
    import logging as _logging
    _logging.getLogger("langfuse").setLevel(_logging.CRITICAL)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/tiff",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".tiff", ".xlsx", ".xls", ".pptx"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tiff"}
IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/tiff"}


def _ext(filename: str) -> str:
    idx = filename.rfind(".")
    return filename[idx:].lower() if idx != -1 else ""


def _is_image(content_type: str, filename: str) -> bool:
    return content_type in IMAGE_MIME_TYPES or _ext(filename) in IMAGE_EXTENSIONS


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    session_id: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
    user_id = current_user["sub"]

    # Start Langfuse trace for the upload pipeline
    upload_trace = None
    if _langfuse:
        try:
            upload_trace = _langfuse.trace(
                name="document_upload",
                user_id=user_id,
                metadata={"company_id": company_id, "filename": file.filename},
            )
        except Exception as exc:
            logger.warning("Langfuse trace init failed: %s", exc)

    # Resolve or create the chat session for scoping
    resolved_session_id: str | None = None
    if session_id == "new":
        new_session = ChatSession(company_id=company_id, title="New chat")
        db.add(new_session)
        db.commit()
        db.refresh(new_session)
        resolved_session_id = str(new_session.id)
    elif session_id:
        existing = (
            db.query(ChatSession)
            .filter(ChatSession.id == session_id, ChatSession.company_id == company_id)
            .first()
        )
        resolved_session_id = str(existing.id) if existing else None

    # Validate file type
    ext = _ext(file.filename or "")
    if file.content_type not in ALLOWED_MIME_TYPES and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Allowed: PDF, Word (.doc/.docx), plain text, images (.png/.jpg/.jpeg/.tiff), spreadsheets (.xlsx/.xls), presentations (.pptx).",
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 50 MB.")
    original_filename = file.filename or f"upload{ext}"

    # Vision branch: images are sent to Qwen VLM to extract text
    if _is_image(file.content_type or "", original_filename):
        ocr_span = None
        if upload_trace:
            try:
                ocr_span = upload_trace.span(name="ocr", input={"filename": original_filename})
            except Exception:
                pass
        try:
            vision = VisionClient()
            extracted_text = await vision.extract_text(file_bytes, original_filename)
            file_bytes = extracted_text.encode("utf-8")
            original_filename = original_filename.rsplit(".", 1)[0] + "_extracted.txt"
            ext = ".txt"
            content_type = "text/plain"
            if ocr_span:
                try:
                    ocr_span.end(output={"char_count": len(extracted_text)})
                except Exception:
                    pass
        except Exception as exc:
            # Vision failed — store the raw image but do NOT attempt text extraction
            # (decoding binary image bytes as UTF-8 produces megabytes of garbage,
            # which would flood the embedder and time out the request)
            logger.warning("Vision extraction failed, storing raw image without indexing: %s", exc)
            content_type = file.content_type or "application/octet-stream"
            if ocr_span:
                try:
                    ocr_span.end(level="ERROR", status_message=str(exc))
                except Exception:
                    pass
    else:
        content_type = file.content_type or "application/octet-stream"

    object_name = f"{company_id}/{uuid.uuid4()}{ext}"

    # Upload to MinIO
    minio = MinIOClient()
    minio.upload_file(object_name, file_bytes, content_type)

    # Extract text, chunk, embed, and store in Milvus
    pages = extract_pages(original_filename, file_bytes)
    chunks = chunk_pages(pages)
    doc_status = "processing"

    doc = Document(
        company_id=company_id,
        session_id=resolved_session_id,
        filename=original_filename,
        minio_key=object_name,
        status=doc_status,
        ragflow_kb_id=None,
        ragflow_doc_id=None,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    if chunks:
        embedding_span = None
        if upload_trace:
            try:
                embedding_span = upload_trace.span(name="embedding", input={"chunk_count": len(chunks)})
            except Exception:
                pass
        try:
            embedder = EmbedderClient()
            texts = [c["text"] for c in chunks]
            all_embeddings: list[list[float]] = []
            for i in range(0, len(texts), 100):
                all_embeddings.extend(await embedder.embed_many(texts[i : i + 100]))
            store = MilvusStore()
            store.insert(company_id, doc.id, original_filename, chunks, all_embeddings)
            doc_status = "indexed"
            if embedding_span:
                try:
                    embedding_span.end(output={"status": "indexed"})
                except Exception:
                    pass
        except Exception as exc:
            logger.warning("Embedding/indexing failed: %s", exc)
            doc_status = "error"
            if embedding_span:
                try:
                    embedding_span.end(level="ERROR", status_message=str(exc))
                except Exception:
                    pass
    else:
        doc_status = "indexed"  # no text to extract (e.g. .doc binary)

    doc.status = doc_status
    db.commit()

    if upload_trace:
        import asyncio
        try:
            asyncio.get_running_loop().run_in_executor(None, _langfuse.flush)
        except Exception:
            pass

    return {"id": doc.id, "filename": doc.filename, "status": doc.status, "session_id": resolved_session_id}


@router.get("/")
def list_documents(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
    docs = db.query(Document).filter(Document.company_id == company_id).all()
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "status": d.status,
            "created_at": d.created_at.isoformat(),
            "session_id": d.session_id,
        }
        for d in docs
    ]


@router.delete("/{document_id}")
async def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
    doc = (
        db.query(Document)
        .filter(Document.id == document_id, Document.company_id == company_id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    minio = MinIOClient()
    minio.delete_file(doc.minio_key)

    try:
        store = MilvusStore()
        store.delete_by_doc(doc.id)
    except Exception as exc:
        logger.warning("Milvus delete_by_doc failed: %s", exc)

    db.delete(doc)
    db.commit()
    return {"detail": "deleted"}
