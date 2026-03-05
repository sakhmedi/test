import uuid
import logging
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from auth_utils import get_current_user
from database import get_db
from models import Company, Document
from services.minio_client import MinIOClient
from services.ocr_client import VisionClient
from services.embedder_client import EmbedderClient
from services.text_extractor import extract_pages, chunk_pages
from services.milvus_store import MilvusStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

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
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]

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
        try:
            vision = VisionClient()
            extracted_text = await vision.extract_text(file_bytes, original_filename)
            file_bytes = extracted_text.encode("utf-8")
            original_filename = original_filename.rsplit(".", 1)[0] + "_extracted.txt"
            ext = ".txt"
            content_type = "text/plain"
        except Exception as exc:
            logger.warning("Vision extraction failed, uploading raw file: %s", exc)
            content_type = file.content_type or "application/octet-stream"
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
        try:
            embedder = EmbedderClient()
            texts = [c["text"] for c in chunks]
            all_embeddings: list[list[float]] = []
            for i in range(0, len(texts), 100):
                all_embeddings.extend(await embedder.embed_many(texts[i : i + 100]))
            store = MilvusStore()
            store.insert(company_id, doc.id, original_filename, chunks, all_embeddings)
            doc_status = "indexed"
        except Exception as exc:
            logger.warning("Embedding/indexing failed: %s", exc)
            doc_status = "error"
    else:
        doc_status = "indexed"  # no text to extract (e.g. .doc binary)

    doc.status = doc_status
    db.commit()

    return {"id": doc.id, "filename": doc.filename, "status": doc.status}


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
