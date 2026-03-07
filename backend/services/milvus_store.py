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

MILVUS_HOST = os.getenv("MILVUS_HOST", "localhost")
MILVUS_PORT = int(os.getenv("MILVUS_PORT", "19530"))
MILVUS_USER = os.getenv("MILVUS_USER", "")
MILVUS_PASSWORD = os.getenv("MILVUS_PASSWORD", "")
MILVUS_DB = os.getenv("MILVUS_DB", "default")
ALEM_EMBED_DIM = int(os.getenv("ALEM_EMBED_DIM", "1024"))

COLLECTION_NAME = "shart_chunks"

_connected = False


def _connect() -> None:
    global _connected
    if _connected:
        return
    try:
        connections.connect(
            alias="default",
            host=MILVUS_HOST,
            port=MILVUS_PORT,
            user=MILVUS_USER,
            password=MILVUS_PASSWORD,
            db_name=MILVUS_DB,
        )
        _connected = True
    except Exception:
        _connected = False
        raise


def _get_or_create_collection() -> Collection:
    _connect()

    if not utility.has_collection(COLLECTION_NAME):
        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, max_length=64, is_primary=True, auto_id=False),
            FieldSchema(name="company_id", dtype=DataType.VARCHAR, max_length=128),
            FieldSchema(name="doc_id", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="filename", dtype=DataType.VARCHAR, max_length=512),
            FieldSchema(name="page_num", dtype=DataType.INT32),
            FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
            FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=ALEM_EMBED_DIM),
        ]
        schema = CollectionSchema(fields=fields, description="Document chunks")
        col = Collection(name=COLLECTION_NAME, schema=schema)
        col.create_index(
            field_name="embedding",
            index_params={"index_type": "FLAT", "metric_type": "COSINE", "params": {}},
        )
    else:
        col = Collection(name=COLLECTION_NAME)

    col.load()
    return col


class MilvusStore:
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
        import uuid as _uuid
        col = _get_or_create_collection()
        data = [
            [str(_uuid.uuid4()) for _ in chunks],
            [company_id] * len(chunks),
            [doc_id] * len(chunks),
            [filename] * len(chunks),
            [chunk["page"] for chunk in chunks],
            [chunk["text"][:65000] for chunk in chunks],
            embeddings,
        ]
        col.insert(data)
        col.flush()

    def search(
        self,
        company_id: str,
        query_vec: list[float],
        top_k: int = 5,
        doc_ids: list[str] | None = None,
    ) -> list[dict]:
        col = _get_or_create_collection()
        if doc_ids is not None:
            ids_str = ", ".join(f'"{d}"' for d in doc_ids)
            expr = f'company_id == "{company_id}" and doc_id in [{ids_str}]'
        else:
            expr = f'company_id == "{company_id}"'

        results = col.search(
            data=[query_vec],
            anns_field="embedding",
            param={"metric_type": "COSINE", "params": {}},
            limit=top_k,
            expr=expr,
            output_fields=["filename", "page_num", "text"],
        )
        hits = []
        for hit in results[0]:
            hits.append({
                "filename": hit.entity.get("filename"),
                "page": hit.entity.get("page_num"),
                "text": hit.entity.get("text"),
            })
        return hits

    def delete_by_doc(self, doc_id: str) -> None:
        col = _get_or_create_collection()
        col.delete(f'doc_id == "{doc_id}"')
        col.flush()
