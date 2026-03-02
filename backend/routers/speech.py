import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from auth_utils import get_current_user
from services.stt_client import STTClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/speech", tags=["speech"])


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    audio_bytes = await file.read()
    filename = file.filename or "audio.wav"

    try:
        stt = STTClient()
        text = await stt.transcribe(audio_bytes, filename)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error("STT transcription failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"STT error: {exc}")

    return {"text": text}
