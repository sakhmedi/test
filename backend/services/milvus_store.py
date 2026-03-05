from __future__ import annotations

import json
import os
import uuid as _uuid

import numpy as np

_STORE_PATH = os.getenv("CHROMA_PATH", "/data/chroma")
_META_FILE = "metadata.json"
_EMB_FILE = "embeddings.npy"


class MilvusStore:
    """Persistent local vector store using numpy cosine similarity.

    Replaces the remote Milvus backend (which the bakashev user lacks
    CreateCollection permission for) with a fully self-contained
    file-based store at CHROMA_PATH.
    """

    def __init__(self):
        os.makedirs(_STORE_PATH, exist_ok=True)
        self._meta_path = os.path.join(_STORE_PATH, _META_FILE)
        self._emb_path = os.path.join(_STORE_PATH, _EMB_FILE)
        self._load()

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def _load(self) -> None:
        if os.path.exists(self._meta_path):
            with open(self._meta_path, "r", encoding="utf-8") as f:
                self._metadata: list[dict] = json.load(f)
        else:
            self._metadata = []

        if os.path.exists(self._emb_path) and self._metadata:
            self._embeddings: np.ndarray | None = np.load(self._emb_path)
        else:
            self._embeddings = None

    def _save(self) -> None:
        with open(self._meta_path, "w", encoding="utf-8") as f:
            json.dump(self._metadata, f)
        if self._embeddings is not None:
            np.save(self._emb_path, self._embeddings)

    # ------------------------------------------------------------------
    # Public interface (matches the original MilvusStore API)
    # ------------------------------------------------------------------

    def insert(
        self,
        company_id: str,
        doc_id: str,
        filename: str,
        chunks: list[dict],
        embeddings: list[list[float]],
    ) -> None:
        if not chunks:
            return
        new_embs = np.array(embeddings, dtype=np.float32)
        self._embeddings = (
            np.vstack([self._embeddings, new_embs])
            if self._embeddings is not None
            else new_embs
        )
        for chunk in chunks:
            self._metadata.append(
                {
                    "id": str(_uuid.uuid4()),
                    "company_id": company_id,
                    "doc_id": doc_id,
                    "filename": filename,
                    "page_num": chunk["page"],
                    "text": chunk["text"][:65000],
                }
            )
        self._save()

    def search(
        self,
        company_id: str,
        query_vec: list[float],
        top_k: int = 5,
        doc_ids: list[str] | None = None,
    ) -> list[dict]:
        if self._embeddings is None or not self._metadata:
            return []

        # Indices belonging to this company, optionally scoped to specific docs
        if doc_ids is not None:
            doc_id_set = set(doc_ids)
            indices = [
                i for i, m in enumerate(self._metadata)
                if m["company_id"] == company_id and m["doc_id"] in doc_id_set
            ]
        else:
            indices = [
                i for i, m in enumerate(self._metadata) if m["company_id"] == company_id
            ]
        if not indices:
            return []

        filtered = self._embeddings[indices]
        q = np.array(query_vec, dtype=np.float32)

        # Cosine similarity
        q_norm = q / (np.linalg.norm(q) + 1e-10)
        row_norms = np.linalg.norm(filtered, axis=1, keepdims=True) + 1e-10
        scores = (filtered / row_norms) @ q_norm

        top_n = min(top_k, len(indices))
        top_local = np.argsort(scores)[::-1][:top_n]

        return [
            {
                "filename": self._metadata[indices[li]]["filename"],
                "page": self._metadata[indices[li]]["page_num"],
                "text": self._metadata[indices[li]]["text"],
            }
            for li in top_local
        ]

    def delete_by_doc(self, doc_id: str) -> None:
        keep = [i for i, m in enumerate(self._metadata) if m["doc_id"] != doc_id]
        if len(keep) == len(self._metadata):
            return
        if keep:
            self._metadata = [self._metadata[i] for i in keep]
            self._embeddings = self._embeddings[keep]
        else:
            self._metadata = []
            self._embeddings = None
        self._save()
