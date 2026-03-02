import os
import httpx

OCR_API_URL = os.getenv("OCR_API_URL", "")
OCR_API_KEY = os.getenv("OCR_API_KEY", "")


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
