from __future__ import annotations

import io

CHUNK_SIZE = 800  # chars
OVERLAP = 100     # chars


def extract_pages(filename: str, data: bytes) -> list[dict]:
    """Return list of {"page": int, "text": str} from file bytes."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            pages = []
            for i, page in enumerate(reader.pages, start=1):
                text = page.extract_text() or ""
                if text.strip():
                    pages.append({"page": i, "text": text})
            return pages
        except Exception:
            return []

    elif ext == "docx":
        try:
            import docx
            doc = docx.Document(io.BytesIO(data))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
            return [{"page": 1, "text": text}] if text.strip() else []
        except Exception:
            return []

    else:
        # Plain text (covers _ocr.txt and any other text files)
        return [{"page": 1, "text": data.decode("utf-8", errors="replace")}]


def chunk_pages(pages: list[dict]) -> list[dict]:
    """Return list of {"page": int, "text": str} chunks."""
    chunks = []
    for p in pages:
        text = p["text"].strip()
        start = 0
        while start < len(text):
            end = start + CHUNK_SIZE
            chunks.append({"page": p["page"], "text": text[start:end]})
            start += CHUNK_SIZE - OVERLAP
    return [c for c in chunks if len(c["text"].strip()) >= 30]
