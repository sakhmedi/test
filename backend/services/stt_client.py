import os
import httpx

STT_API_URL = os.getenv("STT_API_URL", "")
STT_API_KEY = os.getenv("STT_API_KEY", "")


class STTClient:
    async def transcribe(self, audio_bytes: bytes, filename: str) -> str:
        """Send audio file to STT API and return transcribed text."""
        if not STT_API_URL:
            raise RuntimeError("STT_API_URL is not configured.")

        headers = {}
        if STT_API_KEY:
            headers["Authorization"] = f"Bearer {STT_API_KEY}"

        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                STT_API_URL,
                headers=headers,
                files={"file": (filename, audio_bytes)},
            )
            response.raise_for_status()
            data = response.json()
            # Support common response shapes: {"text": "..."} or {"transcription": "..."}
            return data.get("text") or data.get("transcription") or ""
