from __future__ import annotations

import os
import time
from pathlib import Path

from loguru import logger
from playwright.sync_api import sync_playwright, BrowserContext, Page


class DownloadResult:
    def __init__(self, store, success, file_path=None, error=None):
        self.store = store
        self.success = success
        self.file_path = file_path
        self.error = error
        from datetime import datetime
        self.timestamp = datetime.now()


class InfomartDownloader:
    def __init__(self, config):
        self.config = config
        self.output_dir = Path(config.download.output_dir)
        self.screenshot_dir = Path(config.download.screenshot_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)

    def run_all(self, target_month, stores=None):
        if stores is None:
            stores = self.config.stores
        results = []
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            try:
                page = self._login(context, page)
                for store in stores:
                    result = self._download_with_retry(context, page, store, target_month)
                    results.append(result)
            finally:
                browser.close()
        return results

    def _download_with_retry(self, context, page, store, target_month):
        for attempt in range(1, self.config.download.retry_count + 1):
            try:
                logger.info(f"[{store.store_id}] ダウンロード試行 {attempt}/{self.config.download.retry_count}")
                file_path = self._download_store(context, page, store, target_month)
                logger.info(f"[{store.store_id}] ダウンロード成功: {file_path}")
                return DownloadResult(store=store, success=True, file_path=file_path)
            except Exception as e:
                logger.warning(f"[{store.store_id}] 試行 {attempt} 失敗: {e}")
                self._save_screenshot(page, f"{store.file_prefix}_attempt{attempt}")
                if attempt < self.config.download.retry_count:
                    time.sleep(self.config.download.retry_wait_seconds)
        logger.error(f"[{store.store_id}] 失敗")
        return DownloadResult(store=store, success=False, error="最大リトライ回数超過")

    def _login(self, context: BrowserContext, page: Page) -> Page:
        logger.info("インフォマートへログイン中...")
        page.goto(self.config.infomart.login_url)
        page.wait_for_load_state("networkidle")
        user_id = os.environ.get("INFOMART_USER_ID", "")
        password = os.environ.get("INFOMART_PASSWORD", "")
        page.fill('input[name="UID"]', user_id)
        page.fill('input[name="PWD"]', password)
        try:
            with context.expect_page(timeout=5000) as new_page_info:
                page.click('input[name="Logon"]')
            new_page = new_page_info.value
            new_page.wait_for_load_state("networkidle")
            logger.info("新しいタブでログイン成功")
            return new_page
        except Exception:
            page.wait_for_load_state("networkidle")
            logger.info("ログイン成功")
            return page

    def _download_store(self, context: BrowserContext, page: Page, store, target_month) -> Path:
        year_str  = str(target_month.year)
        month_str = target_month.strftime("%m")  # ゼロ埋め2桁 例: "05"
        filename  = f"{target_month.strftime('%Y-%m')}_{store.file_prefix}.csv"
        dest_path = self.output_dir / filename

        page.goto(self.config.infomart.inventory_url)
        page.wait_for_load_state("networkidle")

        # 前店舗のCSV生成バッチが続いていると processing.pagex に飛ばされ
        # 店舗選択リンクが出ないため、処理が終わるまで最大3分待って再読込する
        deadline = time.time() + 180
        while "processing.pagex" in page.url or page.locator('a.open-dialog-modal').count() == 0:
            if time.time() > deadline:
                raise Exception(f"棚卸ページが処理中のまま復帰しません: {page.url}")
            logger.info(f"[{store.store_id}] 処理中画面を検出、10秒待って再読込 ({page.url})")
            time.sleep(10)
            page.goto(self.config.infomart.inventory_url)
            page.wait_for_load_state("networkidle")

        # ── STEP1: 店舗選択ダイアログを開く ──
        page.click('a.open-dialog-modal')
        time.sleep(3)

        # iframeの中から店舗を選択
        clicked = False
        for frame in page.frames:
            if frame == page.main_frame:
                continue
            try:
                rows = frame.locator('tr')
                row_count = rows.count()
                logger.info(f"[{store.store_id}] iframe行数: {row_count}")
                for i in range(row_count):
                    row = rows.nth(i)
                    try:
                        row_text = row.inner_text()
                    except Exception:
                        continue
                    if store.store_id in row_text:
                        logger.info(f"[{store.store_id}] 対象行発見: {row_text[:80]}")
                        for sel in ['a:has-text("選択")', 'button:has-text("選択")', 'input[value="選択"]']:
                            btn = row.locator(sel)
                            if btn.count() > 0:
                                btn.first.click()
                                clicked = True
                                logger.info(f"[{store.store_id}] 選択ボタンクリック成功")
                                break
                        if clicked:
                            break
            except Exception as e:
                logger.warning(f"iframe処理エラー: {e}")
                continue
            if clicked:
                break

        if not clicked:
            rows = page.locator('tr')
            for i in range(rows.count()):
                row = rows.nth(i)
                try:
                    row_text = row.inner_text()
                except Exception:
                    continue
                if store.store_id in row_text:
                    for sel in ['a:has-text("選択")', 'button:has-text("選択")', 'input[value="選択"]']:
                        btn = row.locator(sel)
                        if btn.count() > 0:
                            btn.first.click()
                            clicked = True
                            logger.info(f"[{store.store_id}] 選択ボタンクリック成功（DOM）")
                            break
                    if clicked:
                        break

        if not clicked:
            self._save_screenshot(page, f"debug_{store.store_id}")
            raise Exception(f"店舗コード {store.store_id} の選択ボタンが見つかりません")

        page.wait_for_load_state("networkidle")
        time.sleep(2)

        # ── STEP2: 年を選択（id="cmbYear"）──
        page.locator('#cmbYear').select_option(value=year_str)
        page.locator('#cmbYear').dispatch_event('change')
        page.wait_for_load_state("networkidle")
        time.sleep(1)
        logger.info(f"[{store.store_id}] 年選択完了: {year_str}")

        # ── STEP3: 月を選択（id="cmbMonth"）──
        page.locator('#cmbMonth').select_option(value=month_str)
        page.locator('#cmbMonth').dispatch_event('change')
        page.wait_for_load_state("networkidle")
        time.sleep(1)
        logger.info(f"[{store.store_id}] 月選択完了: {month_str}")

        # ── STEP4: 検索する ──
        page.click('a:has-text("検索する")')
        page.wait_for_load_state("networkidle")

        # ── STEP5: ダウンロード（「棚卸ダウンロード依頼」は除外）──
        with page.expect_download(timeout=self.config.infomart.timeout_ms) as download_info:
            links = page.locator('a:has-text("ダウンロード")')
            for i in range(links.count()):
                link = links.nth(i)
                text = link.inner_text().strip()
                if text == "ダウンロード":
                    link.click()
                    break

        download = download_info.value
        download.save_as(dest_path)

        return dest_path

    def _save_screenshot(self, page: Page, name: str):
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = self.screenshot_dir / f"{timestamp}_{name}.png"
        try:
            page.screenshot(path=str(path))
            logger.info(f"スクリーンショット保存: {path}")
        except Exception as e:
            logger.warning(f"スクリーンショット保存失敗: {e}")