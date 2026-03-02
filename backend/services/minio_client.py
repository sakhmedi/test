import io
import os
from datetime import timedelta

from minio import Minio
from minio.error import S3Error


class MinIOClient:
    def __init__(self):
        endpoint = os.getenv("MINIO_ENDPOINT", "minio:9000")
        access_key = os.getenv("MINIO_USER", "admin")
        secret_key = os.getenv("MINIO_PASSWORD", "admin")
        self.bucket = os.getenv("MINIO_BUCKET", "test-docs")
        self._client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=False,
        )

    def upload_file(self, object_name: str, data: bytes, content_type: str) -> str:
        self._client.put_object(
            self.bucket,
            object_name,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
        return object_name

    def get_file_url(self, object_name: str) -> str:
        return self._client.presigned_get_object(
            self.bucket,
            object_name,
            expires=timedelta(days=7),
        )

    def delete_file(self, object_name: str) -> bool:
        try:
            self._client.remove_object(self.bucket, object_name)
            return True
        except S3Error:
            return False
