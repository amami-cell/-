"""
spreadsheet.py
ダウンロードした CSV を解析し、Google Spreadsheet へ集計するモジュール。
"""

from __future__ import annotations

import os
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import pandas as pd
from googleapiclient.discovery import build
from google.oauth2 import service_account
from loguru import logger

from config_loader import AppConfig, StoreConfig
from downloader import DownloadResult


SUMMARY_HEADERS = ["年月", "店舗名", "フード", "ドリンク", "備品", "取込日時"]

CSV_SUPPLIER_NAME_COL = "[取引先]"
CSV_INVENTORY_COL     = "[当月棚卸高]"

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]


class InventoryData:
    def __init__(self, store: StoreConfig, target_month: date,
                 food: float = 0, drink: float = 0, supplies: float = 0,
                 error: Optional[str] = None):
        self.store = store
        self.target_month = target_month
        self.food = food
        self.drink = drink
        self.supplies = supplies
        self.error = error
        self.imported_at = datetime.now()

    @property
    def is_valid(self) -> bool:
        return self.error is None

    def to_row(self) -> list:
        month_str = self.target_month.strftime("%Y-%m")
        store_label = self.store.store_name if self.store.store_name else self.store.store_id
        return [
            month_str,
            store_label,
            self.food,
            self.drink,
            self.supplies,
            self.imported_at.strftime("%Y-%m-%d %H:%M:%S"),
        ]


class SpreadsheetAggregator:
    def __init__(self, config: AppConfig):
        self.config = config
        self._sheets_service = None
        self._supplier_master: Optional[pd.DataFrame] = None

    @property
    def sheets_service(self):
        if self._sheets_service is None:
            self._sheets_service = self._build_sheets_service()
        return self._sheets_service

    def _build_sheets_service(self):
        credential_path = os.environ.get(
            "GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json"
        )
        creds = service_account.Credentials.from_service_account_file(
            credential_path, scopes=SCOPES
        )
        return build("sheets", "v4", credentials=creds)

    def aggregate(self, results: list[DownloadResult], target_month: date) -> str:
        logger.info("スプレッドシートへの集計を開始")

        master = self._load_supplier_master()

        inventory_list: list[InventoryData] = []
        for result in results:
            if result.success and result.file_path:
                try:
                    data = self._parse_csv(result.file_path, result.store, target_month, master)
                    inventory_list.append(data)
                except Exception as e:
                    logger.error(f"[{result.store.store_id}] 解析失敗: {e}")
                    inventory_list.append(
                        InventoryData(result.store, target_month, error=str(e))
                    )

        spreadsheet_id = "18Fq_mpEweHOFTlF4ntmwJzDsJNSt-DOq7wQYy8E0iLc"

        self._ensure_sheets(spreadsheet_id)
        self._write_summary(spreadsheet_id, inventory_list)

        missing_stores = self._detect_missing_stores(results)
        self._write_missing_stores(spreadsheet_id, missing_stores, target_month)

        self._write_store_master(spreadsheet_id)

        url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
        logger.info(f"集計完了: {url}")
        return url

    def _load_supplier_master(self) -> pd.DataFrame:
        if self._supplier_master is not None:
            return self._supplier_master

        master_path = Path("./supplier_master.csv")
        if not master_path.exists():
            logger.warning("supplier_master.csv が見つかりません。分類なしで処理します。")
            return pd.DataFrame(columns=["取引先名", "分類"])

        self._supplier_master = pd.read_csv(master_path, encoding="utf-8-sig")
        logger.debug(f"取引先マスタ読み込み: {len(self._supplier_master)} 件")
        return self._supplier_master

    def _parse_csv(
        self, file_path: Path, store: StoreConfig,
        target_month: date, master: pd.DataFrame
    ) -> InventoryData:
        logger.debug(f"[{store.store_id}] CSV解析: {file_path.name}")

        df = None
        for enc in ["utf-8-sig", "utf-8", "shift-jis", "cp932"]:
            try:
                df = pd.read_csv(file_path, encoding=enc)
                break
            except Exception:
                continue

        if df is None:
            raise ValueError(f"CSVの読み込みに失敗: {file_path}")

        if CSV_INVENTORY_COL not in df.columns:
            raise ValueError(f"列 '{CSV_INVENTORY_COL}' が見つかりません。列一覧: {df.columns.tolist()}")

        if CSV_SUPPLIER_NAME_COL not in df.columns:
            raise ValueError(f"列 '{CSV_SUPPLIER_NAME_COL}' が見つかりません。列一覧: {df.columns.tolist()}")

        df[CSV_INVENTORY_COL] = pd.to_numeric(
            df[CSV_INVENTORY_COL].astype(str).str.replace(",", ""), errors="coerce"
        ).fillna(0)

        if not master.empty:
            df = df.merge(
                master[["取引先名", "分類"]],
                left_on=CSV_SUPPLIER_NAME_COL,
                right_on="取引先名",
                how="left"
            )
            df["分類"] = df["分類"].fillna("未分類")
        else:
            df["分類"] = "未分類"

        # nanや空白を除外して未分類を確認
        unclassified = df[
            (df["分類"] == "未分類") &
            (df[CSV_SUPPLIER_NAME_COL].notna()) &
            (df[CSV_SUPPLIER_NAME_COL].astype(str).str.strip() != "")
        ][CSV_SUPPLIER_NAME_COL].unique()
        if len(unclassified) > 0:
            logger.warning(f"[{store.store_id}] 未分類の取引先: {list(unclassified)}")

        grouped = df.groupby("分類")[CSV_INVENTORY_COL].sum()

        food     = float(grouped.get("フード", 0))
        drink    = float(grouped.get("ドリンク", 0))
        supplies = float(grouped.get("備品", 0))

        logger.info(f"[{store.store_id}] フード={food:,.0f} ドリンク={drink:,.0f} 備品={supplies:,.0f}")

        return InventoryData(store, target_month, food=food, drink=drink, supplies=supplies)

    def _ensure_sheets(self, spreadsheet_id: str) -> None:
        info = self.sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        existing = {s["properties"]["title"] for s in info["sheets"]}

        required = [
            self.config.google.summary_sheet_name,
            self.config.google.missing_sheet_name,
            self.config.google.master_sheet_name,
        ]

        requests = []
        for sheet_name in required:
            if sheet_name not in existing:
                requests.append({"addSheet": {"properties": {"title": sheet_name}}})

        if requests:
            self.sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": requests}
            ).execute()

    def _write_summary(self, spreadsheet_id: str, inventory_list: list[InventoryData]) -> None:
        sheet_name = self.config.google.summary_sheet_name

        # 既存データを取得（蓄積のため）
        existing = self._get_sheet_values(spreadsheet_id, f"{sheet_name}!A:F")

        rows_to_write: list[list] = []

        # ヘッダーがなければ追加
        if not existing:
            rows_to_write.append(SUMMARY_HEADERS)

        for inv in inventory_list:
            if not inv.is_valid:
                logger.warning(f"[{inv.store.store_id}] 解析エラーのためスキップ: {inv.error}")
                continue

            row = inv.to_row()
            year_month = row[0]
            store_name = row[1]

            # 同月・同店舗の既存行を探して上書き、なければ追記
            duplicate_idx = None
            for i, existing_row in enumerate(existing):
                if len(existing_row) >= 2 and existing_row[0] == year_month and existing_row[1] == store_name:
                    duplicate_idx = i + 1  # 1始まり
                    break

            if duplicate_idx is not None:
                self.sheets_service.spreadsheets().values().update(
                    spreadsheetId=spreadsheet_id,
                    range=f"{sheet_name}!A{duplicate_idx}:F{duplicate_idx}",
                    valueInputOption="RAW",
                    body={"values": [row]},
                ).execute()
                logger.debug(f"既存行を更新: {year_month} {store_name}")
            else:
                rows_to_write.append(row)

        if rows_to_write:
            self._append_rows(spreadsheet_id, sheet_name, rows_to_write)

        # フード・ドリンク・備品列に円書式を適用
        self._apply_currency_format(spreadsheet_id, sheet_name)

        logger.info(f"月次集計シートへ {len(inventory_list)} 件書き込み完了")

    def _apply_currency_format(self, spreadsheet_id: str, sheet_name: str) -> None:
        """フード・ドリンク・備品列（C・D・E列）に円書式を適用"""
        try:
            info = self.sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
            sheet_id = None
            for s in info["sheets"]:
                if s["properties"]["title"] == sheet_name:
                    sheet_id = s["properties"]["sheetId"]
                    break
            if sheet_id is None:
                return

            requests = [{
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "startColumnIndex": 2,  # C列
                        "endColumnIndex": 5,    # E列まで
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "numberFormat": {
                                "type": "CURRENCY",
                                "pattern": "¥#,##0"
                            }
                        }
                    },
                    "fields": "userEnteredFormat.numberFormat"
                }
            }]
            self.sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": requests}
            ).execute()
            logger.debug("円書式を適用しました")
        except Exception as e:
            logger.warning(f"円書式の適用に失敗: {e}")

    def _write_missing_stores(
        self, spreadsheet_id: str, missing: list[StoreConfig], target_month: date
    ) -> None:
        sheet_name = self.config.google.missing_sheet_name
        month_str = target_month.strftime("%Y-%m")
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        headers = ["年月", "店舗名", "ファイルプレフィックス", "確認日時"]
        rows = [headers]
        for store in missing:
            store_label = store.store_name if store.store_name else store.store_id
            rows.append([month_str, store_label, store.file_prefix, timestamp])

        self.sheets_service.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!A:Z",
        ).execute()
        self._append_rows(spreadsheet_id, sheet_name, rows)

        if missing:
            logger.warning(f"未提出店舗: {len(missing)} 件")
        else:
            logger.info("未提出店舗なし")

    def _write_store_master(self, spreadsheet_id: str) -> None:
        sheet_name = self.config.google.master_sheet_name
        headers = ["店舗ID", "店舗名", "ファイルプレフィックス", "登録日時"]
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        rows = [headers]
        for store in self.config.stores:
            rows.append([store.store_id, store.store_name, store.file_prefix, timestamp])

        self.sheets_service.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!A:Z",
        ).execute()
        self._append_rows(spreadsheet_id, sheet_name, rows)

    def _detect_missing_stores(self, results: list[DownloadResult]) -> list[StoreConfig]:
        succeeded = {r.store.store_id for r in results if r.success}
        return [s for s in self.config.stores if s.store_id not in succeeded]

    def _get_sheet_values(self, spreadsheet_id: str, range_notation: str) -> list[list]:
        try:
            result = self.sheets_service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=range_notation,
            ).execute()
            return result.get("values", [])
        except Exception:
            return []

    def _append_rows(self, spreadsheet_id: str, sheet_name: str, rows: list[list]) -> None:
        self.sheets_service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()