"""
Google Sheets の読み取り口。

既存パイプライン（infomart_automation / foodist_journal.py）が書き込んでいる
共有シートを *読むだけ* に使う。書き込みは一切しない。
テストとオフライン検証のために、同じインターフェースの
フィクスチャ実装（JSONファイル）も用意する。
"""
from __future__ import annotations

import json
from abc import ABC, abstractmethod
from pathlib import Path

# 読み取り専用スコープ。既存シートを壊さないため書き込み権限は要求しない。
READONLY_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


class SheetReader(ABC):
    @abstractmethod
    def tab_names(self) -> list[str]:
        """シート（タブ）名の一覧。"""

    @abstractmethod
    def values(self, tab: str) -> list[list]:
        """1タブ分の値を行列で返す。空セルは空文字で埋まる。"""


class GoogleSheetReader(SheetReader):
    def __init__(self, spreadsheet_id: str, service_account_json: str):
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        text = service_account_json.strip()
        if text.startswith("{"):
            creds = service_account.Credentials.from_service_account_info(
                json.loads(text), scopes=READONLY_SCOPES
            )
        else:
            creds = service_account.Credentials.from_service_account_file(
                text, scopes=READONLY_SCOPES
            )
        self._id = spreadsheet_id
        self._service = build("sheets", "v4", credentials=creds, cache_discovery=False)

    def tab_names(self) -> list[str]:
        info = self._service.spreadsheets().get(spreadsheetId=self._id).execute()
        return [s["properties"]["title"] for s in info.get("sheets", [])]

    def values(self, tab: str) -> list[list]:
        result = (
            self._service.spreadsheets()
            .values()
            .get(spreadsheetId=self._id, range=f"'{tab}'!A:E")
            .execute()
        )
        return result.get("values", [])


class FixtureSheetReader(SheetReader):
    """``{タブ名: [[...行...]]}`` の JSON を読む。テスト・オフライン検証用。"""

    def __init__(self, data: dict[str, list[list]]):
        self._data = data

    @classmethod
    def from_file(cls, path: Path | str) -> "FixtureSheetReader":
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f))

    def tab_names(self) -> list[str]:
        return list(self._data)

    def values(self, tab: str) -> list[list]:
        return self._data.get(tab, [])
