import os
import base64
import httpx

OCR_API_URL = os.getenv("OCR_API_URL", "")
OCR_API_KEY = os.getenv("OCR_API_KEY", "")

# DeepSeek OCR uses the same LLM base URL with a dedicated model and key
_OCR_BASE_URL = os.getenv("LLM_API_URL", "").rstrip("/")
_OCR_KEY = os.getenv("OCR_API_KEY", "")
_OCR_MODEL = os.getenv("OCR_MODEL", "deepseek-ocr")

_MIME_BY_EXT = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "tiff": "image/tiff",
}


class OCRClient:
    async def extract_text(self, file_bytes: bytes, filename: str) -> str:
        """Send image/scanned PDF to OCR API and return extracted text."""
        if not OCR_API_URL:
            raise RuntimeError("OCR_API_URL is not configured.")

        headers = {}
        if OCR_API_KEY:
            headers["Authorization"] = f"Bearer {OCR_API_KEY}"

        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                OCR_API_URL,
                headers=headers,
                files={"file": (filename, file_bytes)},
            )
            response.raise_for_status()
            data = response.json()
            # Support common response shapes: {"text": "..."} or {"result": "..."}
            return data.get("text") or data.get("result") or ""


class VisionClient:
    """Extract text from images using the DeepSeek OCR model."""

    async def extract_text(self, file_bytes: bytes, filename: str) -> str:
        if not _OCR_KEY:
            raise RuntimeError("OCR_API_KEY is not configured.")
        if not _OCR_BASE_URL:
            raise RuntimeError("LLM_API_URL is not configured.")

        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpeg"
        mime = _MIME_BY_EXT.get(ext, "image/jpeg")
        b64 = base64.b64encode(file_bytes).decode("utf-8")

        url = f"{_OCR_BASE_URL}/chat/completions"

        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {_OCR_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _OCR_MODEL,
                    "temperature": 0,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime};base64,{b64}"
                                    },
                                },
                                {"type": "text", "text": "Free OCR."},
                            ],
                        }
                    ],
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"] or ""
