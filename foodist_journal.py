"""
foodist_journal.py
Foodist Journal（pros-asp.net/corp/hassin）から当月仕入金額・当月理論原価・売上データを
取得し、Google Sheets へ書き込むモジュール。
"""

from __future__ import annotations

import os
import re
import time
from datetime import datetime, date
from pathlib import Path
from typing import Optional

from loguru import logger
from playwright.sync_api import sync_playwright, Page, BrowserContext
from googleapiclient.discovery import build
from google.oauth2 import service_account

from config_loader import AppConfig, StoreConfig


SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

SHEET_HEADERS = [
    "年月", "店舗ID", "店舗名",
    "当月仕入金額", "当月理論原価", "売上高",
    "取込日時",
]


# ──────────────────────────────────────────────────────────────────────────────
# データクラス
# ──────────────────────────────────────────────────────────────────────────────

class FoodistJournalResult:
    def __init__(
        self,
        store: StoreConfig,
        success: bool,
        purchase_amount: float = 0.0,
        theoretical_cost: float = 0.0,
        sales_amount: float = 0.0,
        error: Optional[str] = None,
    ):
        self.store = store
        self.success = success
        self.purchase_amount = purchase_amount
        self.theoretical_cost = theoretical_cost
        self.sales_amount = sales_amount
        self.error = error
        self.timestamp = datetime.now()

    def to_row(self, target_month: date) -> list:
        month_str = target_month.strftime("%Y-%m")
        store_label = self.store.store_name or self.store.store_id
        return [
            month_str,
            self.store.store_id,
            store_label,
            self.purchase_amount,
            self.theoretical_cost,
            self.sales_amount,
            self.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
        ]


# ──────────────────────────────────────────────────────────────────────────────
# スクレイパー
# ──────────────────────────────────────────────────────────────────────────────

class FoodistJournalScraper:
    """Foodist Journal（pros-asp.net）から店舗別原価・売上データを取得するクラス。"""

    def __init__(self, config: AppConfig):
        self.config = config
        self.fj = config.foodist_journal
        self.screenshot_dir = Path(config.download.screenshot_dir)
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)
        self._sheets_service = None

    # ──────────────────────────────────────────────────────────────
    # パブリックエントリポイント
    # ──────────────────────────────────────────────────────────────

    def run_all(
        self, target_month: date, stores=None
    ) -> list[FoodistJournalResult]:
        """全店舗のデータを取得して Google Sheets へ書き込む。"""
        if stores is None:
            stores = self.config.stores

        logger.info(f"Foodist Journal データ取得開始: {len(stores)} 店舗, 対象月={target_month.strftime('%Y-%m')}")
        results: list[FoodistJournalResult] = []

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            context = browser.new_context()
            page = context.new_page()
            try:
                self._login(context, page)
                for store in stores:
                    result = self._fetch_with_retry(page, store, target_month)
                    results.append(result)
            finally:
                try:
                    browser.close()
                except Exception:
                    pass

        self._write_to_sheets(results, target_month)
        self._log_summary(results)
        return results

    # ──────────────────────────────────────────────────────────────
    # ログイン
    # ──────────────────────────────────────────────────────────────

    def _login(self, context: BrowserContext, page: Page) -> None:
        logger.info("Foodist Journal へログイン中...")

        user_id = os.environ.get("FOODIST_JOURNAL_USER_ID") or self.fj.user_id
        password = os.environ.get("FOODIST_JOURNAL_PASSWORD") or self.fj.password

        if not user_id or not password:
            raise EnvironmentError(
                "Foodist Journal のログイン情報が未設定です。"
                "環境変数 FOODIST_JOURNAL_USER_ID / FOODIST_JOURNAL_PASSWORD を設定するか、"
                "config.yaml の foodist_journal.user_id / password を設定してください。"
            )

        page.goto(self.fj.login_url, timeout=self.fj.timeout_ms)
        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
        logger.debug(f"ログインページURL: {page.url}")

        # ユーザーID入力 — 複数のセレクタを順に試みる
        id_selectors = [
            'input[name="user_id"]',
            'input[name="userid"]',
            'input[name="UserID"]',
            'input[name="login_id"]',
            'input[name="loginid"]',
            'input[id="user_id"]',
            'input[id="userid"]',
            'input[type="text"]:first-of-type',
        ]
        self._fill_field(page, id_selectors, user_id, "ユーザーID")

        # パスワード入力
        pwd_selectors = [
            'input[type="password"]',
            'input[name="password"]',
            'input[name="Password"]',
            'input[name="passwd"]',
            'input[id="password"]',
        ]
        self._fill_field(page, pwd_selectors, password, "パスワード")

        # ログインボタンをクリック
        submit_selectors = [
            'input[type="submit"]',
            'button[type="submit"]',
            'button:has-text("ログイン")',
            'input[value="ログイン"]',
            'a:has-text("ログイン")',
            'button:has-text("Login")',
            'input[value="Login"]',
        ]
        clicked = False
        for sel in submit_selectors:
            try:
                btn = page.locator(sel)
                if btn.count() > 0:
                    btn.first.click()
                    clicked = True
                    logger.debug(f"ログインボタンクリック: {sel}")
                    break
            except Exception:
                continue

        if not clicked:
            self._save_screenshot(page, "login_failed_no_submit")
            raise RuntimeError("ログインボタンが見つかりませんでした")

        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
        logger.info(f"Foodist Journal ログイン完了 (URL: {page.url})")

    # ──────────────────────────────────────────────────────────────
    # リトライ付きデータ取得
    # ──────────────────────────────────────────────────────────────

    def _fetch_with_retry(
        self, page: Page, store: StoreConfig, target_month: date
    ) -> FoodistJournalResult:
        retry_count = self.config.download.retry_count
        for attempt in range(1, retry_count + 1):
            try:
                logger.info(f"[{store.store_id}] データ取得試行 {attempt}/{retry_count}")
                result = self._fetch_store_data(page, store, target_month)
                logger.info(
                    f"[{store.store_id}] 取得成功: "
                    f"仕入={result.purchase_amount:,.0f}円 "
                    f"理論原価={result.theoretical_cost:,.0f}円 "
                    f"売上={result.sales_amount:,.0f}円"
                )
                return result
            except Exception as e:
                logger.warning(f"[{store.store_id}] 試行 {attempt} 失敗: {e}")
                self._save_screenshot(page, f"fj_{store.store_id}_attempt{attempt}")
                if attempt < retry_count:
                    time.sleep(self.config.download.retry_wait_seconds)

        logger.error(f"[{store.store_id}] データ取得失敗（最大リトライ超過）")
        return FoodistJournalResult(store=store, success=False, error="最大リトライ回数超過")

    # ──────────────────────────────────────────────────────────────
    # 店舗データ取得（本体）
    # ──────────────────────────────────────────────────────────────

    def _fetch_store_data(
        self, page: Page, store: StoreConfig, target_month: date
    ) -> FoodistJournalResult:
        year_str = str(target_month.year)
        month_str = target_month.strftime("%m")

        # ── STEP1: トップ（またはレポート一覧）ページへ移動 ──
        page.goto(self.fj.base_url, timeout=self.fj.timeout_ms)
        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)

        # ── STEP2: 店舗選択 ──
        self._select_store(page, store)
        time.sleep(self.fj.wait_after_select_ms / 1000)

        # ── STEP3: 対象年月選択 ──
        self._select_year_month(page, year_str, month_str, store)

        # ── STEP4: 検索 or ページ更新 ──
        self._submit_search(page, store)
        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)

        # ── STEP5: データ抽出 ──
        purchase_amount = self._extract_value(page, store, "当月仕入金額", [
            "当月仕入金額", "仕入金額", "当月仕入", "仕入高", "当月仕入高",
        ])
        theoretical_cost = self._extract_value(page, store, "当月理論原価", [
            "当月理論原価", "理論原価", "理論原価合計", "理論食材費",
        ])
        sales_amount = self._extract_value(page, store, "売上高", [
            "売上高", "当月売上", "当月売上高", "売上金額", "純売上",
        ])

        return FoodistJournalResult(
            store=store,
            success=True,
            purchase_amount=purchase_amount,
            theoretical_cost=theoretical_cost,
            sales_amount=sales_amount,
        )

    # ──────────────────────────────────────────────────────────────
    # 店舗選択ヘルパー
    # ──────────────────────────────────────────────────────────────

    def _select_store(self, page: Page, store: StoreConfig) -> None:
        """ページ上の店舗選択UI（セレクトボックス or テーブル行）で店舗を選択する。"""

        # パターンA: select/option で店舗コードを選択
        for sel_selector in [
            'select[name="shop_id"]', 'select[name="shopId"]', 'select[name="store_id"]',
            'select[name="tenpo_cd"]', 'select[name="tenpocd"]', 'select[id="shop_id"]',
            'select[id="store"]', 'select[name="shop"]', 'select',
        ]:
            loc = page.locator(sel_selector)
            if loc.count() > 0:
                try:
                    # store_id で選択を試みる
                    loc.first.select_option(value=store.store_id)
                    logger.debug(f"[{store.store_id}] セレクトボックスで店舗選択: {sel_selector}")
                    page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
                    return
                except Exception:
                    try:
                        # store_name で選択を試みる
                        loc.first.select_option(label=store.store_name)
                        logger.debug(f"[{store.store_id}] セレクトボックス(名前)で店舗選択")
                        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
                        return
                    except Exception:
                        continue

        # パターンB: テーブル行から店舗コードを探してクリック
        for frame in [page] + [f for f in page.frames if f != page.main_frame]:
            try:
                rows = frame.locator("tr")
                for i in range(rows.count()):
                    row = rows.nth(i)
                    try:
                        row_text = row.inner_text(timeout=1000)
                    except Exception:
                        continue
                    if store.store_id in row_text or store.store_name in row_text:
                        for btn_sel in [
                            'a:has-text("選択")', 'button:has-text("選択")',
                            'input[value="選択"]', 'a', 'button',
                        ]:
                            btn = row.locator(btn_sel)
                            if btn.count() > 0:
                                btn.first.click()
                                logger.debug(f"[{store.store_id}] テーブル行から店舗選択")
                                page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
                                return
            except Exception as e:
                logger.debug(f"テーブル選択試行エラー: {e}")

        # パターンC: リンクやナビゲーションから店舗名で移動
        for link_sel in [
            f'a:has-text("{store.store_id}")',
            f'a:has-text("{store.store_name[:8]}")',
            f'td:has-text("{store.store_id}")',
        ]:
            try:
                loc = page.locator(link_sel)
                if loc.count() > 0:
                    loc.first.click()
                    logger.debug(f"[{store.store_id}] リンクから店舗選択: {link_sel}")
                    page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
                    return
            except Exception:
                continue

        self._save_screenshot(page, f"fj_store_select_fail_{store.store_id}")
        raise RuntimeError(f"店舗コード {store.store_id} の選択UIが見つかりません")

    def _select_year_month(
        self, page: Page, year_str: str, month_str: str, store: StoreConfig
    ) -> None:
        """年・月のセレクトボックスまたは入力欄を操作する。"""
        year_selectors = [
            '#cmbYear', 'select[name="year"]', 'select[name="Year"]',
            'select[name="nenx"]', 'select[id="year"]',
        ]
        for sel in year_selectors:
            loc = page.locator(sel)
            if loc.count() > 0:
                try:
                    loc.first.select_option(value=year_str)
                    loc.first.dispatch_event("change")
                    logger.debug(f"[{store.store_id}] 年選択: {year_str}")
                    break
                except Exception:
                    continue

        month_selectors = [
            '#cmbMonth', 'select[name="month"]', 'select[name="Month"]',
            'select[name="tukix"]', 'select[id="month"]',
        ]
        for sel in month_selectors:
            loc = page.locator(sel)
            if loc.count() > 0:
                try:
                    loc.first.select_option(value=month_str)
                    loc.first.dispatch_event("change")
                    logger.debug(f"[{store.store_id}] 月選択: {month_str}")
                    break
                except Exception:
                    # ゼロなしで再試行
                    try:
                        loc.first.select_option(value=str(int(month_str)))
                        loc.first.dispatch_event("change")
                        break
                    except Exception:
                        continue

    def _submit_search(self, page: Page, store: StoreConfig) -> None:
        """検索ボタンをクリックする（見つからない場合はスキップ）。"""
        search_selectors = [
            'a:has-text("検索")', 'button:has-text("検索")',
            'input[value="検索"]', 'input[value="検索する"]',
            'a:has-text("表示")', 'button:has-text("表示")',
            'input[type="submit"]', 'button[type="submit"]',
        ]
        for sel in search_selectors:
            try:
                loc = page.locator(sel)
                if loc.count() > 0:
                    loc.first.click()
                    logger.debug(f"[{store.store_id}] 検索ボタンクリック: {sel}")
                    return
            except Exception:
                continue
        logger.debug(f"[{store.store_id}] 検索ボタン未検出（スキップ）")

    # ──────────────────────────────────────────────────────────────
    # データ値抽出ヘルパー
    # ──────────────────────────────────────────────────────────────

    def _extract_value(
        self, page: Page, store: StoreConfig, label: str, label_variants: list[str]
    ) -> float:
        """
        ページ上のテーブル/定義リスト/div からラベルに対応する数値を抽出する。
        複数の検索戦略を順に試みる。
        """
        # 戦略1: ラベルを含む th/td の隣接セルから数値を取得
        for variant in label_variants:
            for container in ["th", "td", "dt", "label", "span", "div"]:
                locs = page.locator(f'{container}:has-text("{variant}")')
                for i in range(locs.count()):
                    try:
                        cell = locs.nth(i)
                        # 隣の兄弟要素
                        sibling_text = cell.evaluate(
                            """el => {
                                const next = el.nextElementSibling;
                                if (next) return next.innerText;
                                const parent = el.parentElement;
                                if (parent) {
                                    const cells = parent.querySelectorAll('td,dd,span');
                                    for (let c of cells) {
                                        if (c !== el && /[0-9,，]/.test(c.innerText)) return c.innerText;
                                    }
                                }
                                return '';
                            }"""
                        )
                        value = self._parse_number(sibling_text)
                        if value is not None:
                            logger.debug(f"[{store.store_id}] {label} 抽出成功: {value:,.0f} (variant='{variant}')")
                            return value
                    except Exception:
                        continue

        # 戦略2: ページ全体テキストから正規表現で抽出
        try:
            full_text = page.inner_text("body")
            for variant in label_variants:
                pattern = rf"{re.escape(variant)}[^\d\n]{{0,20}}([\d,，]+)"
                m = re.search(pattern, full_text)
                if m:
                    value = self._parse_number(m.group(1))
                    if value is not None:
                        logger.debug(f"[{store.store_id}] {label} テキスト抽出: {value:,.0f}")
                        return value
        except Exception as e:
            logger.debug(f"[{store.store_id}] テキスト抽出エラー: {e}")

        logger.warning(f"[{store.store_id}] '{label}' の値が見つかりませんでした（0として記録）")
        return 0.0

    @staticmethod
    def _parse_number(text: str) -> Optional[float]:
        """カンマ区切り数値文字列を float に変換する。"""
        if not text:
            return None
        cleaned = re.sub(r"[^\d.]", "", text.replace(",", "").replace("，", ""))
        try:
            v = float(cleaned)
            return v if v >= 0 else None
        except ValueError:
            return None

    # ──────────────────────────────────────────────────────────────
    # Google Sheets 書き込み
    # ──────────────────────────────────────────────────────────────

    @property
    def sheets_service(self):
        if self._sheets_service is None:
            credential_path = os.environ.get(
                "GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json"
            )
            creds = service_account.Credentials.from_service_account_file(
                credential_path, scopes=SCOPES
            )
            self._sheets_service = build("sheets", "v4", credentials=creds)
        return self._sheets_service

    def _write_to_sheets(
        self, results: list[FoodistJournalResult], target_month: date
    ) -> None:
        spreadsheet_id = self.fj.spreadsheet_id
        sheet_name = self.fj.sheet_name

        logger.info(f"Google Sheets への書き込み開始: {sheet_name}")
        self._ensure_sheet(spreadsheet_id, sheet_name)

        existing = self._get_sheet_values(spreadsheet_id, f"{sheet_name}!A:G")
        rows_to_write: list[list] = []

        if not existing:
            rows_to_write.append(SHEET_HEADERS)

        month_str = target_month.strftime("%Y-%m")
        for result in results:
            if not result.success:
                logger.warning(f"[{result.store.store_id}] 失敗のためスキップ: {result.error}")
                continue

            row = result.to_row(target_month)
            store_id = result.store.store_id

            # 同月・同店舗の既存行を上書き
            dup_idx = None
            for i, existing_row in enumerate(existing):
                if len(existing_row) >= 2 and existing_row[0] == month_str and existing_row[1] == store_id:
                    dup_idx = i + 1
                    break

            if dup_idx is not None:
                self.sheets_service.spreadsheets().values().update(
                    spreadsheetId=spreadsheet_id,
                    range=f"{sheet_name}!A{dup_idx}:G{dup_idx}",
                    valueInputOption="RAW",
                    body={"values": [row]},
                ).execute()
                logger.debug(f"[{store_id}] 既存行を更新 (行 {dup_idx})")
            else:
                rows_to_write.append(row)

        if rows_to_write:
            self.sheets_service.spreadsheets().values().append(
                spreadsheetId=spreadsheet_id,
                range=f"{sheet_name}!A1",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": rows_to_write},
            ).execute()

        self._apply_number_format(spreadsheet_id, sheet_name)
        logger.info(f"Google Sheets 書き込み完了: {len([r for r in results if r.success])} 件")

    def _ensure_sheet(self, spreadsheet_id: str, sheet_name: str) -> None:
        info = self.sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        existing = {s["properties"]["title"] for s in info["sheets"]}
        if sheet_name not in existing:
            self.sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": [{"addSheet": {"properties": {"title": sheet_name}}}]},
            ).execute()
            logger.info(f"シート '{sheet_name}' を新規作成しました")

    def _apply_number_format(self, spreadsheet_id: str, sheet_name: str) -> None:
        """仕入金額・理論原価・売上高列（D・E・F列）に円書式を適用。"""
        try:
            info = self.sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
            sheet_id = next(
                (s["properties"]["sheetId"] for s in info["sheets"]
                 if s["properties"]["title"] == sheet_name), None
            )
            if sheet_id is None:
                return
            self.sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": [{
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "startColumnIndex": 3,  # D列
                            "endColumnIndex": 6,    # F列まで
                        },
                        "cell": {
                            "userEnteredFormat": {
                                "numberFormat": {"type": "CURRENCY", "pattern": "¥#,##0"}
                            }
                        },
                        "fields": "userEnteredFormat.numberFormat",
                    }
                }]},
            ).execute()
        except Exception as e:
            logger.warning(f"円書式適用失敗: {e}")

    def _get_sheet_values(self, spreadsheet_id: str, range_notation: str) -> list[list]:
        try:
            result = self.sheets_service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id, range=range_notation
            ).execute()
            return result.get("values", [])
        except Exception:
            return []

    # ──────────────────────────────────────────────────────────────
    # ユーティリティ
    # ──────────────────────────────────────────────────────────────

    def _fill_field(
        self, page: Page, selectors: list[str], value: str, field_name: str
    ) -> None:
        for sel in selectors:
            try:
                loc = page.locator(sel)
                if loc.count() > 0:
                    loc.first.fill(value)
                    logger.debug(f"{field_name} 入力: {sel}")
                    return
            except Exception:
                continue
        self._save_screenshot(page, f"login_no_{field_name}")
        raise RuntimeError(f"ログインフォームの {field_name} 欄が見つかりません")

    def _save_screenshot(self, page: Page, name: str) -> None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = self.screenshot_dir / f"{timestamp}_{name}.png"
        try:
            page.screenshot(path=str(path))
            logger.info(f"スクリーンショット保存: {path}")
        except Exception as e:
            logger.warning(f"スクリーンショット保存失敗: {e}")

    def _log_summary(self, results: list[FoodistJournalResult]) -> None:
        success = [r for r in results if r.success]
        failed = [r for r in results if not r.success]
        logger.info(f"Foodist Journal 取得サマリー: 成功={len(success)}, 失敗={len(failed)}")
        for r in failed:
            logger.error(f"  ✗ {r.store.store_id} ({r.store.store_name}): {r.error}")
