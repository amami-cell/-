"""
foodist_journal.py
Foodist Journal 店長会資料ページから Excel をダウンロードし、
Google Sheets の各指標シートへ書き込む。

シート構成:
  A列: 年月(YYYY-MM)  B列: 店舗名  C列: 金額
  D列: 種別(中間/確定)  E列: 取込日時

実行日判定:
  1〜17日 → 種別=中間, 期間=当月1日〜15日
  18日以降 → 種別=確定, 期間=当月1日〜末日
"""
from __future__ import annotations

import calendar
import os
import time
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import openpyxl
import requests as http
import google_auth_httplib2
from google.oauth2 import service_account
from googleapiclient.discovery import build
from loguru import logger
from playwright.sync_api import Download, Page, sync_playwright

from config_loader import AppConfig

# ──────────────────────────────────────────────────────────────────────────────
# 定数
# ──────────────────────────────────────────────────────────────────────────────

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SPREADSHEET_ID = "18Fq_mpEweHOFTlF4ntmwJzDsJNSt-DOq7wQYy8E0iLc"

REPORT_URL = (
    "https://www2.pros-asp.net/corp/hassin"
    "/app/profit_loss/pl-menu-actual-result/manager_meeting_document"
)

# (metric_key, Googleシート名) の順序リスト
METRICS: list[tuple[str, str]] = [
    ("sales",          "売上"),
    ("food_purchase",  "F食材費仕入"),
    ("drink_purchase", "D飲料費仕入"),
    ("food_theory",    "フード理論原価"),
    ("drink_theory",   "ドリンク理論原価"),
]

# Excel セル位置 {metric_key: (row, col)}  ※openpyxl は 1 始まり
CELL_MAP: dict[str, tuple[int, int]] = {
    "sales":          (13,  21),
    "food_purchase":  (160, 12),
    "drink_purchase": (160, 19),
    "food_theory":    (163, 12),
    "drink_theory":   (163, 19),
}


# ──────────────────────────────────────────────────────────────────────────────
# LINE Notify
# ──────────────────────────────────────────────────────────────────────────────

def notify_line(message: str) -> None:
    """LINE Notify でメッセージを送信する。トークン未設定時はスキップ。"""
    token = os.environ.get("LINE_NOTIFY_TOKEN", "")
    if not token:
        return
    try:
        http.post(
            "https://notify-api.line.me/api/notify",
            headers={"Authorization": f"Bearer {token}"},
            data={"message": f"\n{message}"},
            timeout=10,
        )
    except Exception as e:
        logger.warning(f"LINE Notify 送信失敗: {e}")


# ──────────────────────────────────────────────────────────────────────────────
# スクレイパー本体
# ──────────────────────────────────────────────────────────────────────────────

class FoodistJournalScraper:
    """Foodist Journal 店長会資料 Excel を取得し Google Sheets へ書き込む。"""

    def __init__(self, config: AppConfig):
        self.config = config
        self.fj = config.foodist_journal
        self.screenshot_dir = Path(config.download.screenshot_dir)
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)
        self._sheets_service = None

    # ── エントリポイント ──────────────────────────────────────────────────────

    def run_all(self, target_month: date = None, stores=None) -> None:
        """
        Excel ダウンロード → 解析 → Google Sheets 書き込みを実行する。
        target_month / stores は互換性のために受け付けるが使用しない（全店舗を対象とする）。
        """
        today = date.today()

        if today.day <= 17:
            kind = "中間"
            period_end = today.replace(day=15)
        else:
            kind = "確定"
            last_day = calendar.monthrange(today.year, today.month)[1]
            period_end = today.replace(day=last_day)

        period_start = today.replace(day=1)
        year_month = today.strftime("%Y-%m")

        logger.info(
            f"Foodist Journal 開始: 種別={kind}, "
            f"期間={period_start.strftime('%Y/%m/%d')}〜{period_end.strftime('%Y/%m/%d')}"
        )

        try:
            excel_path = self._download_excel(period_start, period_end)
            store_data = self._parse_excel(excel_path)
            self._write_to_sheets(store_data, year_month, kind)
            logger.info("Foodist Journal 完了")
        except Exception as e:
            msg = f"[Foodist Journal] エラー: {e}"
            logger.exception(msg)
            notify_line(msg)
            raise

    # ── ダウンロード ─────────────────────────────────────────────────────────

    def _download_excel(self, period_start: date, period_end: date) -> Path:
        """Playwright でブラウザ操作し Excel をダウンロードして Path を返す。"""
        download_dir = Path(self.config.download.output_dir)
        download_dir.mkdir(parents=True, exist_ok=True)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False, slow_mo=500)
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            try:
                self._login(page)
                self._save_screenshot(page, "after_login")
                logger.debug(f"ログイン後ダッシュボードURL: {page.url}")

                # SPA内部でメニューをクリックして遷移（page.goto()はセッションが失われる）
                self._navigate_to_report_via_menu(page)
                self._save_screenshot(page, "report_page")
                logger.info(f"レポートページ移動後URL: {page.url}")

                logger.info("店長会資料ページへ移動完了")

                self._select_stores(page)
                self._set_period(page, period_start, period_end)
                excel_path = self._click_output(page, download_dir)
            finally:
                try:
                    browser.close()
                except Exception:
                    pass

        logger.info(f"Excel ダウンロード完了: {excel_path}")
        return excel_path

    def _login(self, page: Page) -> None:
        user_id = os.environ.get("FOODIST_JOURNAL_USER_ID") or self.fj.user_id
        password = os.environ.get("FOODIST_JOURNAL_PASSWORD") or self.fj.password

        if not user_id or not password:
            raise EnvironmentError(
                "FOODIST_JOURNAL_USER_ID / FOODIST_JOURNAL_PASSWORD が未設定です"
            )

        page.goto(self.fj.login_url, timeout=self.fj.timeout_ms)
        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)

        # Angular 4.x 対応: click() は login-container overlay にブロックされるため JS で入力
        # input.form-control[type="text"] が実際のIDフィールド（hidden-focus-item ではない）
        page.evaluate(f"""() => {{
            function angularFill(el, value) {{
                if (!el) return;
                el.focus();
                el.value = value;
                el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                el.dispatchEvent(new KeyboardEvent('keyup', {{ key: ' ', bubbles: true }}));
            }}
            angularFill(
                document.querySelector('input.form-control[type="text"]'),
                {repr(user_id)}
            );
            angularFill(
                document.querySelector('input[type="password"]'),
                {repr(password)}
            );
        }}""")
        logger.debug(f"ユーザーID / パスワード入力完了")
        time.sleep(1)
        self._save_screenshot(page, "login_before_click")

        # ログインボタンも JS でクリック（overlay 回避）
        page.evaluate("""() => {
            const btn = document.querySelector('button');
            if (btn) btn.click();
        }""")
        logger.debug("ログインボタンクリック（JS）")

        # Angular SPA のルーティングが完了するまで URL 変化を待つ（最大 15 秒）
        try:
            page.wait_for_url("**/app/**", timeout=15000)
        except Exception:
            pass

        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)

        # ログイン成功確認 — /index に留まっていたら失敗
        current_url = page.url
        logger.debug(f"ログイン後URL: {current_url}")
        if current_url.rstrip("/").endswith("/index"):
            self._save_screenshot(page, "login_failed")
            raise RuntimeError(
                f"ログインに失敗しました（URL: {current_url}）。"
                "config.yaml または環境変数のID/パスワードを確認してください。"
            )

        # ログイン後に表示されるダイアログを閉じる（バージョンアップのお知らせ等）
        self._close_dialogs(page)

        logger.info(f"ログイン完了 (URL: {current_url})")

    def _close_dialogs(self, page: Page) -> None:
        """モーダルダイアログ（バージョンアップのお知らせ等）を閉じる。"""
        time.sleep(1)
        # Escape キーで閉じる
        page.keyboard.press("Escape")
        time.sleep(0.5)

        # JS で「閉じる」ボタンを探してクリック
        closed = page.evaluate("""() => {
            const texts = ['閉じる', '閉じる', 'Close', 'OK', '×'];
            for (const text of texts) {
                const els = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
                for (const el of els) {
                    if (el.innerText && el.innerText.trim().includes(text)) {
                        el.click();
                        return true;
                    }
                }
            }
            return false;
        }""")
        if closed:
            logger.debug("ダイアログを閉じました（JS）")
            time.sleep(1)

        # × ボタンを試みる
        for sel in ['.modal-header button', 'button.close', '[data-dismiss="modal"]',
                    'button:has-text("×")']:
            try:
                loc = page.locator(sel)
                if loc.count() > 0:
                    loc.first.click(force=True)
                    logger.debug(f"ダイアログ × ボタンクリック: {sel}")
                    time.sleep(0.5)
                    break
            except Exception:
                continue

    def _navigate_to_report_via_menu(self, page: Page) -> None:
        """
        Angular SPA のセッションを保ったままメニュー経由で店長会資料ページへ移動する。
        page.goto() はフルリロードになりセッションが失われるため、クリック遷移を使う。
        メニュー階層: 損益管理 → 実績管理業務（ハブページ） → 店長会資料DLタイル
        """
        self._close_dialogs(page)
        self._save_screenshot(page, "before_menu_click")

        # 1. 損益管理メニューをクリック（ドロップダウンを開く）
        profit_selectors = [
            'a:has-text("損益管理")',
            'li:has-text("損益管理") a',
            'nav a:has-text("損益管理")',
            '[routerlink*="profit_loss"]',
        ]
        self._click_first_force(page, profit_selectors, "損益管理メニュー")
        time.sleep(2)
        self._save_screenshot(page, "menu_profit_open")

        # 2. 実績管理業務をクリック（ハブページへ移動）
        jisseki_selectors = [
            'a:has-text("実績管理業務")',
            'li:has-text("実績管理業務") a',
            '[routerlink*="actual"]',
            '[routerlink*="jisseki"]',
        ]
        self._click_first_force(page, jisseki_selectors, "実績管理業務メニュー")
        time.sleep(3)
        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
        self._save_screenshot(page, "menu_jisseki_open")

        # 3. 店長会資料DLタイル（またはサブメニュー項目）をクリック
        report_selectors = [
            'a:has-text("店長会資料DL")',
            'a:has-text("店長会資料")',
            'div:has-text("店長会資料DL")',
            'a[href*="manager_meeting_document"]',
            '[routerlink*="manager_meeting_document"]',
            'a:has-text("店長会")',
            'li:has-text("店長会") a',
        ]
        self._click_first_force(page, report_selectors, "店長会資料メニュー")

        # 4. 店舗選択ボタンが現れるまで待機（フォームの読み込み完了確認）
        try:
            page.wait_for_selector(
                'button:has-text("店舗選択"), a:has-text("店舗選択")',
                timeout=20000
            )
            logger.debug("店舗選択ボタン出現確認")
        except Exception:
            logger.warning("店舗選択ボタン出現タイムアウト（続行）")
        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
        logger.info(f"店長会資料ページ遷移完了: {page.url}")

    def _select_stores(self, page: Page) -> None:
        """店舗選択 → エリア「イニシエート」 → 全選択 → 決定する"""
        self._save_screenshot(page, "before_store_select")

        # 1. 店舗選択ボタン（force=True でAngularオーバーレイを回避）
        self._click_first_force(page, [
            'button:has-text("店舗選択")',
            'a:has-text("店舗選択")',
            'input[value="店舗選択"]',
        ], "店舗選択ボタン")
        time.sleep(2)
        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
        self._save_screenshot(page, "after_store_select_btn")

        # 2. エリアドロップダウンで「イニシエート」を選択
        area_selectors = [
            'select[name*="area"]', 'select[id*="area"]',
            'select[name*="Area"]', 'select[name*="エリア"]', 'select',
        ]
        for sel in area_selectors:
            loc = page.locator(sel)
            if loc.count() == 0:
                continue
            for label in ["イニシエート"]:
                try:
                    loc.first.select_option(label=label)
                    time.sleep(1)
                    logger.debug(f"エリア「{label}」選択完了")
                    break
                except Exception:
                    continue
            else:
                continue
            break
        self._save_screenshot(page, "after_area_select")

        # 3. 全選択ボタン
        self._click_first_force(page, [
            'button:has-text("全選択")',
            'a:has-text("全選択")',
            'input[value="全選択"]',
        ], "全選択ボタン")
        time.sleep(1)

        # 4. 決定するボタン
        self._click_first_force(page, [
            'button:has-text("決定する")',
            'a:has-text("決定する")',
            'input[value="決定する"]',
        ], "決定するボタン")
        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
        logger.info("店舗選択完了（イニシエート/全選択/決定）")

    def _set_period(self, page: Page, start: date, end: date) -> None:
        """期間の開始日・終了日を入力する。"""
        start_str = start.strftime("%Y/%m/%d")
        end_str = end.strftime("%Y/%m/%d")

        self._fill_first(page, [
            'input[name*="start"]', 'input[id*="start"]',
            'input[name*="from"]',  'input[id*="from"]',
            'input[placeholder*="開始"]', 'input[name*="From"]',
        ], start_str, "開始日")

        self._fill_first(page, [
            'input[name*="end"]',  'input[id*="end"]',
            'input[name*="to"]',   'input[id*="to"]',
            'input[placeholder*="終了"]', 'input[name*="To"]',
        ], end_str, "終了日")

        logger.info(f"期間設定完了: {start_str}〜{end_str}")

    def _click_output(self, page: Page, download_dir: Path) -> Path:
        """出力ボタンをクリックして Excel をダウンロードする。"""
        with page.expect_download(timeout=60000) as dl_info:
            self._click_first(page, [
                'button:has-text("出力")',
                'a:has-text("出力")',
                'input[value="出力"]',
            ], "出力ボタン")
        dl: Download = dl_info.value
        filename = dl.suggested_filename or f"manager_report_{date.today().strftime('%Y%m%d')}.xlsx"
        dest = download_dir / filename
        dl.save_as(str(dest))
        return dest

    # ── Excel 解析 ───────────────────────────────────────────────────────────

    def _parse_excel(self, excel_path: Path) -> dict[str, dict[str, float]]:
        """
        各シート（1シート=1店舗）から指標を抽出する。
        Returns: {店舗名: {metric_key: value, ...}}
        """
        wb = openpyxl.load_workbook(str(excel_path), data_only=True)
        store_data: dict[str, dict[str, float]] = {}

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            try:
                entry: dict[str, float] = {
                    key: self._read_cell(ws, row, col)
                    for key, (row, col) in CELL_MAP.items()
                }
                # 当月棚卸金額の行を確認（行160前後を探してログ出力）
                self._log_inventory_row(ws, sheet_name)

                store_data[sheet_name] = entry
                logger.debug(
                    f"[{sheet_name}] "
                    f"売上={entry['sales']:,.0f} "
                    f"F仕入={entry['food_purchase']:,.0f} "
                    f"D仕入={entry['drink_purchase']:,.0f} "
                    f"F理論={entry['food_theory']:,.0f} "
                    f"D理論={entry['drink_theory']:,.0f}"
                )
            except Exception as e:
                logger.warning(f"[{sheet_name}] 解析エラー（スキップ）: {e}")

        logger.info(f"Excel 解析完了: {len(store_data)} 店舗")
        return store_data

    @staticmethod
    def _read_cell(ws, row: int, col: int) -> float:
        val = ws.cell(row=row, column=col).value
        if val is None:
            return 0.0
        try:
            return float(str(val).replace(",", "").replace("，", ""))
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _log_inventory_row(ws, sheet_name: str) -> None:
        """当月棚卸金額セルを行155〜169で探してデバッグログに出力する（確認用）。"""
        for r in range(155, 170):
            for c in range(1, 25):
                val = ws.cell(row=r, column=c).value
                if val and "棚卸" in str(val):
                    logger.debug(
                        f"[{sheet_name}] 棚卸関連セル: row={r}, col={c}, value={val}"
                    )

    # ── Google Sheets 書き込み ────────────────────────────────────────────────

    @property
    def sheets_service(self):
        if self._sheets_service is None:
            credential_path = os.environ.get(
                "GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json"
            )
            creds = service_account.Credentials.from_service_account_file(
                credential_path, scopes=SCOPES
            )
            # Windows + httplib2 の SSL 証明書検証問題を回避（接続自体は TLS 暗号化済）
            import httplib2
            http = httplib2.Http(disable_ssl_certificate_validation=True)
            authorized_http = google_auth_httplib2.AuthorizedHttp(creds, http=http)
            self._sheets_service = build("sheets", "v4", http=authorized_http)
        return self._sheets_service

    def _write_to_sheets(
        self, store_data: dict[str, dict[str, float]], year_month: str, kind: str
    ) -> None:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        sheet_ids = self._ensure_sheets()

        for metric_key, sheet_name in METRICS:
            existing = self._get_values(f"'{sheet_name}'!A:E")

            if kind == "確定":
                # 同年月の「中間」行を全店舗まとめて削除してから書き込む
                self._bulk_delete_interim(sheet_ids[sheet_name], year_month, existing)
                existing = self._get_values(f"'{sheet_name}'!A:E")

            rows_to_append: list[list] = []
            for store_name, data in store_data.items():
                new_row = [year_month, store_name, data.get(metric_key, 0.0), kind, timestamp]
                dup_idx = self._find_dup(existing, year_month, store_name, kind)
                if dup_idx is not None:
                    self.sheets_service.spreadsheets().values().update(
                        spreadsheetId=SPREADSHEET_ID,
                        range=f"'{sheet_name}'!A{dup_idx}:E{dup_idx}",
                        valueInputOption="RAW",
                        body={"values": [new_row]},
                    ).execute()
                else:
                    rows_to_append.append(new_row)

            if rows_to_append:
                self.sheets_service.spreadsheets().values().append(
                    spreadsheetId=SPREADSHEET_ID,
                    range=f"'{sheet_name}'!A1",
                    valueInputOption="RAW",
                    insertDataOption="INSERT_ROWS",
                    body={"values": rows_to_append},
                ).execute()

            logger.info(f"[{sheet_name}] 書き込み完了: {len(store_data)} 店舗")

    def _ensure_sheets(self) -> dict[str, int]:
        """必要なシートを作成し {sheet_name: sheet_id} を返す。"""
        info = self.sheets_service.spreadsheets().get(
            spreadsheetId=SPREADSHEET_ID
        ).execute()
        existing: dict[str, int] = {
            s["properties"]["title"]: s["properties"]["sheetId"]
            for s in info["sheets"]
        }

        requests = [
            {"addSheet": {"properties": {"title": name}}}
            for _, name in METRICS
            if name not in existing
        ]
        if requests:
            resp = self.sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=SPREADSHEET_ID,
                body={"requests": requests},
            ).execute()
            for reply in resp.get("replies", []):
                if "addSheet" in reply:
                    props = reply["addSheet"]["properties"]
                    existing[props["title"]] = props["sheetId"]
            logger.info(f"シート新規作成: {len(requests)} 件")

        return existing

    def _bulk_delete_interim(
        self, sheet_id: int, year_month: str, existing: list[list]
    ) -> None:
        """同年月の「中間」行を降順で一括削除する。"""
        indices = [
            i for i, row in enumerate(existing)
            if len(row) >= 4 and row[0] == year_month and row[3] == "中間"
        ]
        if not indices:
            return

        requests = [
            {"deleteDimension": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": idx,
                    "endIndex": idx + 1,
                }
            }}
            for idx in sorted(indices, reverse=True)
        ]
        self.sheets_service.spreadsheets().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={"requests": requests},
        ).execute()
        logger.debug(f"「中間」行を {len(indices)} 件削除しました (sheet_id={sheet_id})")

    @staticmethod
    def _find_dup(
        existing: list[list], year_month: str, store_name: str, kind: str
    ) -> Optional[int]:
        """同年月・同店舗・同種別の行番号（1始まり）を返す。なければ None。"""
        for i, row in enumerate(existing):
            if (
                len(row) >= 4
                and row[0] == year_month
                and row[1] == store_name
                and row[3] == kind
            ):
                return i + 1
        return None

    def _get_values(self, range_notation: str) -> list[list]:
        try:
            result = self.sheets_service.spreadsheets().values().get(
                spreadsheetId=SPREADSHEET_ID, range=range_notation
            ).execute()
            return result.get("values", [])
        except Exception:
            return []

    # ── ユーティリティ ────────────────────────────────────────────────────────

    def _click_first(self, page: Page, selectors: list[str], name: str) -> None:
        """セレクタリストの先頭から順に試してクリックする。"""
        for sel in selectors:
            try:
                loc = page.locator(sel)
                if loc.count() > 0:
                    loc.first.click(timeout=5000)
                    logger.debug(f"{name} クリック: {sel}")
                    return
            except Exception:
                continue
        self._save_screenshot(page, f"missing_{name}")
        raise RuntimeError(f"'{name}' のクリック対象が見つかりません")

    def _click_first_force(self, page: Page, selectors: list[str], name: str) -> None:
        """オーバーレイを無視して force=True でクリックする。"""
        for sel in selectors:
            try:
                loc = page.locator(sel)
                if loc.count() > 0:
                    loc.first.click(force=True, timeout=5000)
                    logger.debug(f"{name} force クリック: {sel}")
                    return
            except Exception:
                continue
        # JS フォールバック: :has-text() は native JS 非対応なのでテキスト内容で検索
        import re as _re
        texts = []
        for sel in selectors:
            m = _re.search(r':has-text\(["\']([^"\']+)["\']\)', sel)
            if m:
                texts.append(m.group(1))
            m2 = _re.search(r'\[value=["\']([^"\']+)["\']\]', sel)
            if m2:
                texts.append(m2.group(1))
        if texts:
            clicked = page.evaluate("""(texts) => {
                const candidates = Array.from(document.querySelectorAll(
                    'button, a, input[type="button"], input[type="submit"], div[role="button"], span[role="button"]'
                ));
                for (const text of texts) {
                    for (const el of candidates) {
                        const t = (el.innerText || el.value || '').trim();
                        if (t === text || t.includes(text)) {
                            el.click();
                            return text;
                        }
                    }
                }
                return null;
            }""", texts)
            if clicked:
                logger.debug(f"{name} JS テキスト検索クリック: {clicked}")
                return
        self._save_screenshot(page, f"missing_{name}")
        raise RuntimeError(f"'{name}' のクリック対象が見つかりません")

    def _fill_first(
        self, page: Page, selectors: list[str], value: str, name: str
    ) -> None:
        """セレクタリストの先頭から順に試して入力する。見つからない場合は警告のみ。"""
        for sel in selectors:
            try:
                loc = page.locator(sel)
                if loc.count() > 0:
                    loc.first.fill(value)
                    logger.debug(f"{name} 入力: {value} ({sel})")
                    return
            except Exception:
                continue
        logger.warning(f"'{name}' の入力欄が見つかりませんでした（スキップ）")

    def _save_screenshot(self, page: Page, name: str) -> None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = self.screenshot_dir / f"{ts}_{name}.png"
        try:
            page.screenshot(path=str(path))
            logger.info(f"スクリーンショット保存: {path}")
        except Exception as e:
            logger.warning(f"スクリーンショット保存失敗: {e}")
