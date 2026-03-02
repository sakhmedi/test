import uuid
import logging
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from models import Company, Document
from services.minio_client import MinIOClient
from services.ragflow_client import RAGFlowClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}


def _ext(filename: str) -> str:
    idx = filename.rfind(".")
    return filename[idx:].lower() if idx != -1 else ""


def get_or_create_company(db: Session, company_id_str: str) -> Company:
    company = db.query(Company).filter(Company.id == company_id_str).first()
    if not company:
        slug = f"company-{company_id_str[:8]}"
        company = Company(id=company_id_str, name=slug, slug=slug)
        db.add(company)
        db.commit()
        db.refresh(company)
    return company


@router.post("/upload")
async def upload_document(
    company_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    # Validate file type
    ext = _ext(file.filename or "")
    if file.content_type not in ALLOWED_MIME_TYPES and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF and Word documents are allowed.")

    company = get_or_create_company(db, company_id)

    file_bytes = await file.read()
    object_name = f"{company_id}/{uuid.uuid4()}{ext}"

    # Upload to MinIO
    minio = MinIOClient()
    minio.upload_file(object_name, file_bytes, file.content_type or "application/octet-stream")

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
            ragflow_doc_id = await ragflow.upload_document(kb_id, file.filename or object_name, file_bytes)
            await ragflow.start_parsing(kb_id, ragflow_doc_id)
        except Exception as exc:
            logger.warning("RAGFlow upload/parse failed: %s", exc)

    doc = Document(
        company_id=company_id,
        filename=file.filename or object_name,
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
def list_documents(company_id: str, db: Session = Depends(get_db)):
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
async def delete_document(document_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == document_id).first()
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
