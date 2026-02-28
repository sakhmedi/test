from fastapi import APIRouter

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/")
async def list_documents():
    """TODO Day 3: list documents for the authenticated company."""
    return {"detail": "not implemented"}


@router.post("/upload")
async def upload_document():
    """TODO Day 3: upload file to MinIO, trigger RAGFlow indexing."""
    return {"detail": "not implemented"}


@router.delete("/{document_id}")
async def delete_document(document_id: str):
    """TODO Day 3: delete document from MinIO + vector DB."""
    return {"detail": "not implemented"}
