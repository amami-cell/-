"""
cleanup_sheets.py
Google Sheets の5シートからイニシエート以外の店舗データを削除する。
"""
import glob
import os
import time

import openpyxl
import httplib2
import google_auth_httplib2
from google.oauth2 import service_account
from googleapiclient.discovery import build
from loguru import logger

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SPREADSHEET_ID = "18Fq_mpEweHOFTlF4ntmwJzDsJNSt-DOq7wQYy8E0iLc"
SHEET_NAMES = ["売上", "F食材費仕入", "D飲料費仕入", "フード理論原価", "ドリンク理論原価"]


def main():
    # 1. イニシエート23店舗名を最新Excelから取得
    xlsx_files = sorted(glob.glob("downloads/*.xlsx"))
    if not xlsx_files:
        logger.error("downloads/*.xlsx が見つかりません")
        return
    latest = xlsx_files[-1]
    wb = openpyxl.load_workbook(latest, data_only=True)
    initiate_stores = set(wb.sheetnames)
    logger.info(f"イニシエート店舗数: {len(initiate_stores)} (from {latest})")
    for s in sorted(initiate_stores):
        logger.debug(f"  {s}")

    # 2. Google Sheets サービス初期化
    cred_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json")
    creds = service_account.Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    http = httplib2.Http(disable_ssl_certificate_validation=True)
    authorized_http = google_auth_httplib2.AuthorizedHttp(creds, http=http)
    service = build("sheets", "v4", http=authorized_http)

    # 3. 各シートのクリーンアップ
    for sheet_name in SHEET_NAMES:
        logger.info(f"[{sheet_name}] クリーンアップ開始...")

        # 全データ取得
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{sheet_name}'!A:E",
        ).execute()
        rows = result.get("values", [])
        logger.info(f"[{sheet_name}] 取得行数: {len(rows)}")

        if not rows:
            logger.info(f"[{sheet_name}] データなし - スキップ")
            continue

        # B列（店舗名）がイニシエート以外の行を除去
        kept = [row for row in rows if len(row) > 1 and row[1] in initiate_stores]
        removed = len(rows) - len(kept)
        logger.info(f"[{sheet_name}] 削除: {removed}行 / 残: {len(kept)}行")

        if removed == 0:
            logger.info(f"[{sheet_name}] 削除対象なし - スキップ")
            continue

        # シートをクリアして残すデータだけ書き直す
        service.spreadsheets().values().clear(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{sheet_name}'!A:E",
        ).execute()
        time.sleep(0.5)

        if kept:
            service.spreadsheets().values().update(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{sheet_name}'!A1",
                valueInputOption="RAW",
                body={"values": kept},
            ).execute()

        logger.info(f"[{sheet_name}] クリーンアップ完了: {len(kept)}行残存")
        time.sleep(1)

    logger.info("全シートのクリーンアップ完了")


if __name__ == "__main__":
    main()
