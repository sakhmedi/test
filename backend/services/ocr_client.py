import os
import base64
import httpx

OCR_API_URL = os.getenv("OCR_API_URL", "")
OCR_API_KEY = os.getenv("OCR_API_KEY", "")

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
    """Send an image directly to the Qwen VLM as base64 and return extracted text."""

    async def extract_text(self, file_bytes: bytes, filename: str) -> str:
        from llm import get_client  # local import to avoid circular deps

        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpeg"
        mime = _MIME_BY_EXT.get(ext, "image/jpeg")
        b64 = base64.b64encode(file_bytes).decode("utf-8")

        client, model = get_client()
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                        {
                            "type": "text",
                            "text": (
                                "Extract all text from this document image. "
                                "Return only the extracted text, nothing else."
                            ),
                        },
                    ],
                }
            ],
        )
        return response.choices[0].message.content or ""
