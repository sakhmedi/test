import os
from typing import Any

import httpx


class RAGFlowClient:
    def __init__(self):
        self._base_url = os.getenv("RAGFLOW_API_URL", "http://ragflow:9380")
        self._api_key = os.getenv("RAGFLOW_API_KEY", "")
        self._headers = {"Authorization": f"Bearer {self._api_key}"}

    async def create_dataset(self, name: str) -> str:
        """Create a new knowledge-base dataset. Returns the dataset id."""
        async with httpx.AsyncClient(base_url=self._base_url, headers=self._headers) as client:
            resp = await client.post("/api/v1/datasets", json={"name": name})
            resp.raise_for_status()
            data = resp.json()
            return data["data"]["id"]

    async def upload_document(self, dataset_id: str, filename: str, file_bytes: bytes) -> str:
        """Upload a file to a dataset. Returns the document id."""
        async with httpx.AsyncClient(base_url=self._base_url, headers=self._headers) as client:
            resp = await client.post(
                f"/api/v1/datasets/{dataset_id}/documents",
                files={"file": (filename, file_bytes)},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["data"][0]["id"]

    async def start_parsing(self, dataset_id: str, doc_id: str) -> None:
        """Trigger async parsing/indexing of a document."""
        async with httpx.AsyncClient(base_url=self._base_url, headers=self._headers) as client:
            resp = await client.post(
                f"/api/v1/datasets/{dataset_id}/chunks",
                json={"document_ids": [doc_id]},
            )
            resp.raise_for_status()

    async def query(self, dataset_ids: list[str], question: str, top_k: int = 5) -> list[dict[str, Any]]:
        """Retrieve relevant chunks for a question across one or more datasets."""
        async with httpx.AsyncClient(base_url=self._base_url, headers=self._headers) as client:
            resp = await client.post(
                "/api/v1/retrieval",
                json={
                    "question": question,
                    "dataset_ids": dataset_ids,
                    "top_k": top_k,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", {}).get("chunks", [])

    async def delete_document(self, dataset_id: str, doc_id: str) -> bool:
        """Delete a document from a dataset."""
        async with httpx.AsyncClient(base_url=self._base_url, headers=self._headers) as client:
            resp = await client.request(
                "DELETE",
                f"/api/v1/datasets/{dataset_id}/documents",
                json={"ids": [doc_id]},
            )
            return resp.is_success
