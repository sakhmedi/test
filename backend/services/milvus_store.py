from __future__ import annotations

import os

from pymilvus import (
    Collection,
    CollectionSchema,
    DataType,
    FieldSchema,
    connections,
    utility,
)

COLLECTION_NAME = "docuflow_chunks"
DIM = int(os.getenv("ALEM_EMBED_DIM", "1536"))


def _connect() -> None:
    host = os.getenv("MILVUS_HOST", "milvus")
    port = int(os.getenv("MILVUS_PORT", "19530"))
    user = os.getenv("MILVUS_USER", "")
    password = os.getenv("MILVUS_PASSWORD", "")
    db_name = os.getenv("MILVUS_DB", "")
    kwargs: dict = {"alias": "default", "host": host, "port": port}
    if user:
        kwargs["user"] = user
        kwargs["password"] = password
    if db_name:
        kwargs["db_name"] = db_name
    connections.connect(**kwargs)


class MilvusStore:
    def __init__(self):
        _connect()
        self._col = self.ensure_collection()

    def ensure_collection(self) -> Collection:
        if utility.has_collection(COLLECTION_NAME):
            col = Collection(COLLECTION_NAME)
            col.load()
            return col

        fields = [
            FieldSchema(name="chunk_id", dtype=DataType.INT64, is_primary=True, auto_id=True),
            FieldSchema(name="company_id", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="doc_id", dtype=DataType.INT64),
            FieldSchema(name="filename", dtype=DataType.VARCHAR, max_length=512),
            FieldSchema(name="page_num", dtype=DataType.INT64),
            FieldSchema(name="chunk_text", dtype=DataType.VARCHAR, max_length=65000),
            FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=DIM),
        ]
        schema = CollectionSchema(fields=fields, description="DocuFlow document chunks")
        col = Collection(name=COLLECTION_NAME, schema=schema)

        col.create_index(
            field_name="embedding",
            index_params={
                "index_type": "HNSW",
                "metric_type": "COSINE",
                "params": {"M": 16, "efConstruction": 200},
            },
        )
        col.load()
        return col

    def insert(
        self,
        company_id: str,
        doc_id: int,
        filename: str,
        chunks: list[dict],
        embeddings: list[list[float]],
    ) -> None:
        if not chunks:
            return
        data = [
            [company_id] * len(chunks),
            [doc_id] * len(chunks),
            [filename] * len(chunks),
            [c["page"] for c in chunks],
            [c["text"][:65000] for c in chunks],
            embeddings,
        ]
        self._col.insert(data)
        self._col.flush()

    def search(
        self,
        company_id: str,
        query_vec: list[float],
        top_k: int = 5,
    ) -> list[dict]:
        results = self._col.search(
            data=[query_vec],
            anns_field="embedding",
            param={"metric_type": "COSINE", "params": {"ef": 64}},
            limit=top_k,
            expr=f'company_id == "{company_id}"',
            output_fields=["filename", "page_num", "chunk_text"],
        )
        hits = []
        for hit in results[0]:
            hits.append(
                {
                    "filename": hit.entity.get("filename", ""),
                    "page": hit.entity.get("page_num", 0),
                    "text": hit.entity.get("chunk_text", ""),
                }
            )
        return hits

    def delete_by_doc(self, doc_id: int) -> None:
        self._col.delete(expr=f"doc_id == {doc_id}")
        self._col.flush()
