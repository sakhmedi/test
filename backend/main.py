import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import redis as redis_lib
from minio import Minio
from minio.error import S3Error
from sqlalchemy import text

from database import engine, Base
from routers import auth, documents, chat, speech
import llm as llm_module

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000")
MINIO_USER = os.getenv("MINIO_USER", "admin")
MINIO_PASSWORD = os.getenv("MINIO_PASSWORD", "admin")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "docuflow-docs")  # FIXED: renamed from test-docs
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────
    logger.info("Creating database tables…")
    Base.metadata.create_all(bind=engine)

    logger.info("Ensuring MinIO bucket exists…")
    minio_client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_USER,
        secret_key=MINIO_PASSWORD,
        secure=False,
    )
    try:
        if not minio_client.bucket_exists(MINIO_BUCKET):
            minio_client.make_bucket(MINIO_BUCKET)
            logger.info("Created bucket: %s", MINIO_BUCKET)
        else:
            logger.info("Bucket already exists: %s", MINIO_BUCKET)
    except S3Error as exc:
        logger.error("MinIO bucket setup failed: %s", exc)

    yield
    # ── Shutdown ─────────────────────────────────────────────────────────
    logger.info("Shutting down…")


app = FastAPI(title="DocuFlow AI", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(documents.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(speech.router, prefix="/api")


@app.get("/health", tags=["health"])
def health():
    services: dict[str, str] = {}

    # PostgreSQL
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        services["postgres"] = "ok"
    except Exception as exc:
        services["postgres"] = f"error: {exc}"

    # Redis
    try:
        r = redis_lib.from_url(REDIS_URL, socket_connect_timeout=2)
        r.ping()
        services["redis"] = "ok"
    except Exception as exc:
        services["redis"] = f"error: {exc}"

    # MinIO
    try:
        minio_client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_USER,
            secret_key=MINIO_PASSWORD,
            secure=False,
        )
        minio_client.bucket_exists(MINIO_BUCKET)
        services["minio"] = "ok"
    except Exception as exc:
        services["minio"] = f"error: {exc}"

    # AlemLLM — just check the key is set, no network call
    try:
        model = llm_module._DEFAULT_MODEL
        llm_module._api_key_for(model)
        services["llm"] = "ok"
        logger.info("LLM model: %s", model)
    except ValueError as exc:
        services["llm"] = f"error: {exc}"

    overall = "ok" if all(v == "ok" for v in services.values()) else "degraded"
    return {"status": overall, "services": services}
