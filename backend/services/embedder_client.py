import os
from openai import AsyncOpenAI

EMBED_MODEL = os.getenv("ALEM_EMBED_MODEL", "text-embedding-3-small")


class EmbedderClient:
    def __init__(self):
        self._client = AsyncOpenAI(
            api_key=os.getenv("ALEM_EMBED_KEY"),
            base_url=os.getenv("LLM_API_URL", "https://llm.alem.ai/v1"),
        )

    async def embed_many(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts. Respects OpenAI 2048-item batch limit."""
        resp = await self._client.embeddings.create(model=EMBED_MODEL, input=texts)
        return [item.embedding for item in resp.data]

    async def embed_one(self, text: str) -> list[float]:
        return (await self.embed_many([text]))[0]
