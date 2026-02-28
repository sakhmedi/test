import os
from openai import AsyncOpenAI

# -------------------------------------------------------------
# AlemLLM config — читается из .env
# -------------------------------------------------------------
_BASE_URL = os.getenv("ALEM_API_BASE_URL", "https://api.alem.ai/v1")
_DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "qwen3")

_API_KEYS: dict[str, str] = {
    "qwen3": os.getenv("QWEN3_API_KEY", ""),
    "alemllm": os.getenv("ALEMLLM_API_KEY", ""),
}


def _api_key_for(model: str) -> str:
    """Return the right API key for the requested model."""
    key = _API_KEYS.get(model) or _API_KEYS.get("alemllm", "")
    if not key:
        raise ValueError(
            f"No API key configured for model '{model}'. "
            "Set QWEN3_API_KEY or ALEMLLM_API_KEY in your .env."
        )
    return key


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
        base_url=_BASE_URL,
    )
    return client, model
