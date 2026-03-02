import uuid
import logging
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from auth_utils import get_current_user
from database import get_db
from models import Company, Document
from services.minio_client import MinIOClient
from services.ocr_client import OCRClient
from services.ragflow_client import RAGFlowClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
    "image/jpg",
}
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg"}


def _ext(filename: str) -> str:
    idx = filename.rfind(".")
    return filename[idx:].lower() if idx != -1 else ""


def _is_image(content_type: str, filename: str) -> bool:
    return content_type in IMAGE_MIME_TYPES or _ext(filename) in IMAGE_EXTENSIONS


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]

    # Validate file type
    ext = _ext(file.filename or "")
    if file.content_type not in ALLOWED_MIME_TYPES and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF, Word, and image files are allowed.")

    file_bytes = await file.read()
    original_filename = file.filename or f"upload{ext}"

    # OCR branch: images and scanned PDFs get converted to text first
    if _is_image(file.content_type or "", original_filename):
        try:
            ocr = OCRClient()
            extracted_text = await ocr.extract_text(file_bytes, original_filename)
            # Replace file_bytes with text content for RAGFlow
            file_bytes = extracted_text.encode("utf-8")
            original_filename = original_filename.rsplit(".", 1)[0] + "_ocr.txt"
            ext = ".txt"
            content_type = "text/plain"
        except Exception as exc:
            logger.warning("OCR failed, uploading raw file: %s", exc)
            content_type = file.content_type or "application/octet-stream"
    else:
        content_type = file.content_type or "application/octet-stream"

    object_name = f"{company_id}/{uuid.uuid4()}{ext}"

    # Upload to MinIO
    minio = MinIOClient()
    minio.upload_file(object_name, file_bytes, content_type)

    # Determine or create RAGFlow dataset for this company
    ragflow = RAGFlowClient()
    existing_doc = (
        db.query(Document)
        .filter(Document.company_id == company_id, Document.ragflow_kb_id.isnot(None))
        .first()
    )
    if existing_doc:
        kb_id = existing_doc.ragflow_kb_id
    else:
        try:
            kb_id = await ragflow.create_dataset(f"company-{company_id[:8]}")
        except Exception as exc:
            logger.warning("RAGFlow create_dataset failed: %s", exc)
            kb_id = None

    # Upload to RAGFlow and start parsing
    ragflow_doc_id = None
    if kb_id:
        try:
            ragflow_doc_id = await ragflow.upload_document(kb_id, original_filename, file_bytes)
            await ragflow.start_parsing(kb_id, ragflow_doc_id)
        except Exception as exc:
            logger.warning("RAGFlow upload/parse failed: %s", exc)

    doc = Document(
        company_id=company_id,
        filename=original_filename,
        minio_key=object_name,
        status="processing",
        ragflow_kb_id=kb_id,
        ragflow_doc_id=ragflow_doc_id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

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

    if doc.ragflow_kb_id and doc.ragflow_doc_id:
        ragflow = RAGFlowClient()
        try:
            await ragflow.delete_document(doc.ragflow_kb_id, doc.ragflow_doc_id)
        except Exception as exc:
            logger.warning("RAGFlow delete_document failed: %s", exc)

    db.delete(doc)
    db.commit()
    return {"detail": "deleted"}
