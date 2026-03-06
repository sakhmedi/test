import os
import httpx

RERANKER_API_URL = os.getenv("RERANKER_API_URL", "")
RERANKER_API_KEY = os.getenv("RERANKER_API_KEY", "")
RERANK_THRESHOLD = 0.1  # FIXED: filter out low-confidence chunks


class RerankerClient:
    async def rerank(self, query: str, chunks: list[dict]) -> list[dict]:
        """Score and sort chunks by relevance to query using reranker API.

        Falls back to returning chunks unchanged if API is not configured.
        """
        if not RERANKER_API_URL or not chunks:
            return chunks

        documents = [c.get("content", c.get("text", "")) for c in chunks]

        headers = {}
        if RERANKER_API_KEY:
            headers["Authorization"] = f"Bearer {RERANKER_API_KEY}"

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                RERANKER_API_URL,
                json={"query": query, "documents": documents},
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

        # Expected response: [{"index": 0, "score": 0.95}, ...]
        scores = data if isinstance(data, list) else data.get("results", [])

        scored = []
        for item in scores:
            idx = item.get("index", item.get("corpus_id", 0))
            score = item.get("score", item.get("relevance_score", 0.0))
            if idx < len(chunks):
                scored.append((score, chunks[idx]))

        scored.sort(key=lambda x: x[0], reverse=True)
        # FIXED: apply score threshold — discard chunks below RERANK_THRESHOLD
        scored = [(s, c) for s, c in scored if s >= RERANK_THRESHOLD]
        return [chunk for _, chunk in scored] if scored else chunks
