"""
google_drive.py
Google Drive API を使用して Excel ファイルをアップロードするモジュール。
フォルダの自動作成・重複チェック・上書きアップロードに対応。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.oauth2 import service_account
from loguru import logger

from config_loader import AppConfig


# Google API スコープ
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

# Excel の MIME タイプ
MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MIME_FOLDER = "application/vnd.google-apps.folder"


class GoogleDriveUploader:
    """
    Google Drive へのファイルアップロードを担当するクラス。

    使用例:
        config = AppConfig.load()
        uploader = GoogleDriveUploader(config)
        file_id = uploader.upload(Path("./downloads/2026-05_UMAMI.xlsx"))
    """

    def __init__(self, config: AppConfig):
        self.config = config
        self._service = None
        self._folder_id_cache: dict[str, str] = {}

    # ------------------------------------------------------------------
    # 認証・サービス初期化
    # ------------------------------------------------------------------

    @property
    def service(self):
        """Drive サービスオブジェクト（遅延初期化）"""
        if self._service is None:
            self._service = self._build_service()
        return self._service

    def _build_service(self):
        """サービスアカウント認証で Drive API クライアントを構築する"""
        credential_path = os.environ.get(
            "GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json"
        )
        creds = service_account.Credentials.from_service_account_file(
            credential_path, scopes=SCOPES
        )
        service = build("drive", "v3", credentials=creds)
        logger.debug("Google Drive API クライアント初期化完了")
        return service

    def get_credentials(self):
        """他モジュールから認証情報を取得するためのメソッド"""
        credential_path = os.environ.get(
            "GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json"
        )
        return service_account.Credentials.from_service_account_file(
            credential_path, scopes=SCOPES
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def upload_files(self, file_paths: list[Path]) -> dict[Path, Optional[str]]:
        """
        複数ファイルを Google Drive にアップロードする。

        Args:
            file_paths: アップロードするファイルのパスリスト

        Returns:
            {ファイルパス: Google Drive ファイルID} の辞書
            アップロード失敗時は None
        """
        results: dict[Path, Optional[str]] = {}
        folder_id = self._get_or_create_folder_path(self.config.google.drive_folder_path)

        for file_path in file_paths:
            try:
                file_id = self.upload(file_path, folder_id)
                results[file_path] = file_id
                logger.info(f"アップロード成功: {file_path.name} (ID: {file_id})")
            except Exception as e:
                logger.error(f"アップロード失敗: {file_path.name} - {e}")
                results[file_path] = None

        return results

    def upload(self, file_path: Path, folder_id: Optional[str] = None) -> str:
        """
        1ファイルをアップロードする。既存ファイルがあれば上書き。

        Args:
            file_path: アップロードするファイルのパス
            folder_id: アップロード先フォルダID（None の場合は設定から取得）

        Returns:
            Google Drive のファイルID
        """
        if folder_id is None:
            folder_id = self._get_or_create_folder_path(self.config.google.drive_folder_path)

        filename = file_path.name

        # 既存ファイルを確認
        existing_id = self._find_file(filename, folder_id)

        media = MediaFileUpload(str(file_path), mimetype=MIME_XLSX, resumable=True)

        if existing_id:
            # 上書きアップロード
            logger.debug(f"既存ファイルを更新: {filename} (ID: {existing_id})")
            updated = self.service.files().update(
                fileId=existing_id,
                media_body=media,
            ).execute()
            return updated["id"]
        else:
            # 新規アップロード
            logger.debug(f"新規アップロード: {filename}")
            metadata = {"name": filename, "parents": [folder_id]}
            created = self.service.files().create(
                body=metadata,
                media_body=media,
                fields="id",
            ).execute()
            return created["id"]

    # ------------------------------------------------------------------
    # フォルダ管理
    # ------------------------------------------------------------------

    def _get_or_create_folder_path(self, folder_path: str) -> str:
        """
        "親フォルダ/子フォルダ" の形式でフォルダを再帰的に取得/作成する。

        Args:
            folder_path: "/" 区切りのフォルダパス

        Returns:
            末端フォルダの ID
        """
        # 環境変数で親フォルダIDが指定されている場合はそれを使用
        parent_id = os.environ.get("GOOGLE_DRIVE_PARENT_FOLDER_ID") or "root"

        parts = folder_path.strip("/").split("/")
        for part in parts:
            cache_key = f"{parent_id}/{part}"
            if cache_key in self._folder_id_cache:
                parent_id = self._folder_id_cache[cache_key]
            else:
                parent_id = self._get_or_create_folder(part, parent_id)
                self._folder_id_cache[cache_key] = parent_id

        return parent_id

    def _get_or_create_folder(self, name: str, parent_id: str) -> str:
        """
        指定名のフォルダを取得または作成する。

        Args:
            name: フォルダ名
            parent_id: 親フォルダID

        Returns:
            フォルダID
        """
        # 既存フォルダを検索
        query = (
            f"name='{name}' and "
            f"mimeType='{MIME_FOLDER}' and "
            f"'{parent_id}' in parents and "
            "trashed=false"
        )
        response = self.service.files().list(
            q=query, fields="files(id, name)", spaces="drive"
        ).execute()

        files = response.get("files", [])
        if files:
            logger.debug(f"既存フォルダを使用: {name} (ID: {files[0]['id']})")
            return files[0]["id"]

        # 新規作成
        metadata = {
            "name": name,
            "mimeType": MIME_FOLDER,
            "parents": [parent_id],
        }
        folder = self.service.files().create(body=metadata, fields="id").execute()
        logger.info(f"フォルダを作成: {name} (ID: {folder['id']})")
        return folder["id"]

    def _find_file(self, filename: str, folder_id: str) -> Optional[str]:
        """
        フォルダ内で指定名のファイルを検索し、IDを返す。

        Args:
            filename: ファイル名
            folder_id: 検索先フォルダID

        Returns:
            ファイルID または None
        """
        query = (
            f"name='{filename}' and "
            f"'{folder_id}' in parents and "
            "trashed=false"
        )
        response = self.service.files().list(
            q=query, fields="files(id, name)", spaces="drive"
        ).execute()
        files = response.get("files", [])
        return files[0]["id"] if files else None

    def get_folder_url(self, folder_path: str) -> str:
        """フォルダのGoogleドライブURLを返す"""
        folder_id = self._get_or_create_folder_path(folder_path)
        return f"https://drive.google.com/drive/folders/{folder_id}"
