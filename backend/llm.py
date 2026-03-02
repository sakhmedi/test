import os
from openai import AsyncOpenAI

# -------------------------------------------------------------
# LLM config — reads standardised LLM_* vars first,
# falls back to legacy ALEM_*/QWEN3_* for backward-compat.
# FIXED: removed hardcoded fallback URL; removed per-model key dict.
# -------------------------------------------------------------
_BASE_URL = os.getenv("LLM_API_URL") or os.getenv("ALEM_API_BASE_URL", "")
_DEFAULT_MODEL = os.getenv("LLM_MODEL") or os.getenv("DEFAULT_MODEL", "qwen3")
_API_KEY = (
    os.getenv("LLM_API_KEY")
    or os.getenv("QWEN3_API_KEY")
    or os.getenv("ALEMLLM_API_KEY", "")
)


def _api_key_for(model: str) -> str:  # noqa: ARG001 — model kept for API compat
    """Return the configured API key (single key for all models)."""
    if not _API_KEY:
        raise ValueError(
            "No LLM API key configured. Set LLM_API_KEY (or QWEN3_API_KEY / "
            "ALEMLLM_API_KEY) in your .env."
        )
    return _API_KEY


def get_client(model: str | None = None) -> tuple["AsyncOpenAI", str]:
    """
    Return (AsyncOpenAI client, model_name) ready to use.

    Usage:
        client, model = get_client()
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Hello"}],
        )
    """
    model = model or _DEFAULT_MODEL
    client = AsyncOpenAI(
        api_key=_api_key_for(model),
        base_url=_BASE_URL or None,
    )
    return client, model
