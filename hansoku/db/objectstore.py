"""
制作物PDFの置き場。本番は Cloudflare R2（S3互換・下り無料）、ローカルはFS。

R2 の egress が無料なので、ギャラリー表示で何枚読ませても費用が増えない。
"""
from __future__ import annotations

import shutil
from abc import ABC, abstractmethod
from pathlib import Path

from ..settings import ObjectStoreSettings


def creative_key(year: int, campaign_id: str, filename: str) -> str:
    """制作物のオブジェクトキー。年 / 施策 で並ぶようにしておく。"""
    safe = filename.replace("/", "_").strip()
    return f"creatives/{year}/{campaign_id}/{safe}"


class ObjectStore(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str = "application/pdf") -> str:
        """保存して公開URL（または参照用URL）を返す。"""

    @abstractmethod
    def get(self, key: str) -> bytes: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def url(self, key: str) -> str: ...


class LocalObjectStore(ObjectStore):
    """認証情報が揃う前でも動く、ローカルFS実装。"""

    def __init__(self, root: Path):
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        target = self._root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    def put(self, key: str, data: bytes, content_type: str = "application/pdf") -> str:
        self._path(key).write_bytes(data)
        return self.url(key)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return (self._root / key).exists()

    def url(self, key: str) -> str:
        return (self._root / key).as_uri()

    def clear(self) -> None:
        shutil.rmtree(self._root, ignore_errors=True)
        self._root.mkdir(parents=True, exist_ok=True)


class R2ObjectStore(ObjectStore):
    """Cloudflare R2（S3互換API）。"""

    def __init__(self, settings: ObjectStoreSettings):
        import boto3

        self._settings = settings
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.endpoint_url,
            aws_access_key_id=settings.access_key_id,
            aws_secret_access_key=settings.secret_access_key,
            region_name="auto",
        )

    def put(self, key: str, data: bytes, content_type: str = "application/pdf") -> str:
        self._client.put_object(
            Bucket=self._settings.bucket, Key=key, Body=data, ContentType=content_type
        )
        return self.url(key)

    def get(self, key: str) -> bytes:
        return self._client.get_object(Bucket=self._settings.bucket, Key=key)["Body"].read()

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self._settings.bucket, Key=key)
            return True
        except ClientError:
            return False

    def url(self, key: str) -> str:
        base = self._settings.public_base_url.rstrip("/")
        if base:
            return f"{base}/{key}"
        # 公開URLが未設定のときは署名URLで参照する（1時間有効）
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._settings.bucket, "Key": key},
            ExpiresIn=3600,
        )
