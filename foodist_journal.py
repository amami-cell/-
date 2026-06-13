"""
foodist_journal.py
Foodist Journal 店長会資料ページから Excel をダウンロードし、
Google Sheets の各指標シートへ書き込む。

シート構成:
  A列: 年月(YYYY-MM)  B列: 店舗名  C列: 金額
  D列: 種別(中間/確定)  E列: 取込日時

実行日判定:
  1〜17日 → 種別=中間, 期間=当月1日〜末日
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
    "sales":          (14,  22),   # 売上実績
    "food_purchase":  (161, 13),   # 食材仕入高(F)
    "drink_purchase": (161, 20),   # 食材仕入高(D)
    "food_theory":    (164, 13),   # 理論原価(F)
    "drink_theory":   (164, 20),   # 理論原価(D)
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

    def clear_all_metric_sheets(self) -> None:
        """5つの指標シートの全データをクリアする（一括再取込前のリセット用）。"""
        logger.info("指標シート全クリア開始")
        for _, sheet_name in METRICS:
            try:
                self.sheets_service.spreadsheets().values().clear(
                    spreadsheetId=SPREADSHEET_ID,
                    range=f"'{sheet_name}'!A:E",
                ).execute()
                logger.info(f"  [{sheet_name}] クリア完了")
                time.sleep(0.5)
            except Exception as e:
                logger.warning(f"  [{sheet_name}] クリア失敗: {e}")
        logger.info("指標シート全クリア完了")

    def run_all(self, target_month: date = None, stores=None) -> None:
        """
        Excel ダウンロード → 解析 → Google Sheets 書き込みを実行する。
        target_month が指定された場合はその月を確定として取得する。
        未指定の場合は実行日に基づいて当月の中間または確定を取得する。
        """
        if target_month is not None:
            self.run_for_month(target_month, kind="確定")
            return

        today = date.today()

        last_day = calendar.monthrange(today.year, today.month)[1]
        period_end = today.replace(day=last_day)

        if today.day <= 17:
            kind = "中間"
        else:
            kind = "確定"

        period_start = today.replace(day=1)
        year_month = today.strftime("%Y-%m")

        logger.info(
            f"[{year_month}] 種別={kind} 期間: "
            f"{period_start.strftime('%Y-%m-%d')}〜{period_end.strftime('%Y-%m-%d')}"
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

    def run_for_month(self, target_month: date, kind: str = "確定") -> None:
        """
        指定月の全期間（1日〜末日）でデータを取得して Sheets へ書き込む。
        --foodist-all による過去月一括取得で使用する。
        """
        last_day = calendar.monthrange(target_month.year, target_month.month)[1]
        period_start = target_month.replace(day=1)
        period_end = target_month.replace(day=last_day)
        year_month = target_month.strftime("%Y-%m")

        logger.info(
            f"[{year_month}] 種別={kind} 期間: "
            f"{period_start.strftime('%Y-%m-%d')}〜{period_end.strftime('%Y-%m-%d')}"
        )

        try:
            excel_path = self._download_excel(period_start, period_end)
            store_data = self._parse_excel(excel_path)
            self._write_to_sheets(store_data, year_month, kind)
            logger.info(f"Foodist Journal 完了: {year_month}")
        except Exception as e:
            msg = f"[Foodist Journal] {year_month} エラー: {e}"
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
        店長会資料ページへ移動する。
        第1手段: ログイン後のセッション Cookie を保ったまま直接URLへ goto。
        失敗時フォールバック: 損益管理 → 実績管理業務 → 店長会資料DL タイルをクリック。
        """
        self._close_dialogs(page)
        self._save_screenshot(page, "before_menu_click")

        # ── 第1手段: 直接 URL で遷移 ─────────────────────────────────────────
        direct_ok = False
        try:
            page.goto(REPORT_URL, timeout=self.fj.timeout_ms)
            page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
            if "manager_meeting_document" in page.url:
                logger.info(f"直接URL遷移成功: {page.url}")
                direct_ok = True
            else:
                logger.warning(f"直接URL遷移後のURLが期待外れ: {page.url}")
        except Exception as e:
            logger.warning(f"直接URL遷移失敗: {e}")

        if direct_ok:
            # 店舗選択ボタン待機
            try:
                page.wait_for_selector(
                    'button:has-text("店舗選択"), a:has-text("店舗選択")',
                    timeout=20000
                )
            except Exception:
                logger.warning("店舗選択ボタン出現タイムアウト（非致命）")
            logger.info(f"店長会資料ページ遷移完了: {page.url}")
            return

        # ── フォールバック: メニュークリック経由 ──────────────────────────────
        logger.info("フォールバック: メニュー経由で店長会資料ページへ遷移します")

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
        """店舗選択 → エリア「イニシエート」 → 全選択 → 追加 → 決定する"""
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
        # ng-selectコンポーネント: オプションは開いたときだけDOM上に存在するが
        # CSSで非表示なためPlaywright click(force=True)不可。JS dispatchEventを使う。
        area_selected = False

        result = page.evaluate("""async () => {
            // エリアラベル（<span>inside div.formItem form-inline）を探す
            const areaLabel = [...document.querySelectorAll('*')]
                .find(el => el.children.length === 0 &&
                            el.textContent.trim() === 'エリア' &&
                            el.offsetParent !== null);
            if (!areaLabel) return {ok: false, msg: 'no-label'};

            // ラベルの親div内のng-selectトリガーを探す
            let container = areaLabel.parentElement;
            let trigger = null;
            for (let i = 0; i < 8; i++) {
                if (!container) break;
                trigger = container.querySelector(
                    'ng-select, .ng-select, [class*="ng-select-container"], ' +
                    '.ng-arrow-wrapper, .ng-value-container, .ng-input'
                );
                if (trigger) break;
                container = container.parentElement;
            }
            if (!trigger) {
                // フォールバック: ラベルの兄弟要素をトリガーとして使う
                const siblings = [...(areaLabel.parentElement?.children || [])];
                trigger = siblings.find(s => s !== areaLabel);
            }
            if (!trigger) return {ok: false, msg: 'no-trigger'};

            // ドロップダウンを開く
            trigger.click();
            await new Promise(r => setTimeout(r, 600));

            // オプションをdispatchEventでクリック（CSS visibility不問）
            const opts = [...document.querySelectorAll(
                'li.option, [class*="ng-option"], mat-option'
            )];
            const target = opts.find(o =>
                o.textContent.trim() === 'イニシエート' ||
                o.getAttribute('title') === 'イニシエート'
            );
            if (!target) {
                document.body.click();
                return {ok: false, msg: 'no-option', optCount: opts.length,
                        triggerCls: trigger.className};
            }
            target.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
            await new Promise(r => setTimeout(r, 300));
            return {ok: true, text: target.textContent.trim()};
        }""")

        logger.debug(f"エリア選択JS結果: {result}")
        if isinstance(result, dict) and result.get('ok'):
            area_selected = True
            logger.info(f"エリア「イニシエート」選択成功: {result.get('text')}")

        # フォールバック: 座標クリック + JS dispatchEvent（ドロップダウンが閉じる前にJS実行）
        if not area_selected:
            try:
                area_rect = page.evaluate("""() => {
                    for (const el of document.querySelectorAll('*')) {
                        if (el.children.length === 0 &&
                            el.textContent.trim() === 'エリア' &&
                            el.offsetParent) {
                            const r = el.getBoundingClientRect();
                            return {right: r.right, cy: r.y + r.height / 2};
                        }
                    }
                    return null;
                }""")
                if area_rect:
                    page.mouse.click(area_rect['right'] + 150, area_rect['cy'])
                    time.sleep(0.5)
                    opt_text = page.evaluate("""() => {
                        const target = [...document.querySelectorAll(
                            'li.option, [class*="ng-option"]'
                        )].find(o => o.textContent.trim() === 'イニシエート' ||
                                     o.getAttribute('title') === 'イニシエート');
                        if (!target) return null;
                        target.dispatchEvent(
                            new MouseEvent('click', {bubbles: true, cancelable: true})
                        );
                        return target.textContent.trim();
                    }""")
                    if opt_text:
                        area_selected = True
                        logger.info(f"エリア 座標→JSクリック 成功: {opt_text}")
            except Exception as e:
                logger.debug(f"座標クリックフォールバック失敗: {e}")

        if not area_selected:
            logger.warning("エリア「イニシエート」の選択に失敗しました")
        time.sleep(1)
        self._save_screenshot(page, "after_area_select")

        # 3. 全選択ボタン（左パネル = 最初の全選択）
        self._click_first_force(page, [
            'button:has-text("全選択")',
            'a:has-text("全選択")',
            'input[value="全選択"]',
        ], "全選択ボタン")
        time.sleep(1)

        # 4. 追加ボタン（→ で右パネルへ移動）
        self._click_first_force(page, [
            'button:has-text("追加")',
            'a:has-text("追加")',
            'input[value="追加"]',
        ], "追加ボタン")
        time.sleep(1)
        self._save_screenshot(page, "after_add_stores")

        # 5. 決定するボタン
        self._click_first_force(page, [
            'button:has-text("決定する")',
            'a:has-text("決定する")',
            'input[value="決定する"]',
        ], "決定するボタン")
        page.wait_for_load_state("networkidle", timeout=self.fj.timeout_ms)
        logger.info("店舗選択完了（イニシエート/全選択/追加/決定）")

    def _set_period(self, page: Page, start: date, end: date) -> None:
        """
        期間の開始日・終了日を入力する。
        JS で入力欄座標を取得し、Playwright の mouse.click() + keyboard.type() で
        ブラウザのネイティブイベントを発火させ Angular 変更検知を確実にトリガーする。
        """
        start_str = start.strftime("%Y/%m/%d")
        end_str   = end.strftime("%Y/%m/%d")
        logger.info(f"期間設定開始: {start_str} 〜 {end_str}")
        self._save_screenshot(page, f"before_set_period_{start.strftime('%Y%m')}")

        # ── Step 1: 可視入力欄の座標を JS で取得 ─────────────────────────────
        rect_info = page.evaluate("""() => {
            const allVisible = Array.from(document.querySelectorAll('input'))
                .filter(el => el.type !== 'hidden' && el.offsetParent !== null);

            const info = allVisible.map(el => {
                const r = el.getBoundingClientRect();
                return {
                    cx: r.left + r.width / 2,
                    cy: r.top  + r.height / 2,
                    value: el.value,
                    name: el.name || '',
                    id: el.id || '',
                    placeholder: el.placeholder || '',
                    ngName: el.getAttribute('ng-reflect-name') || '',
                };
            });

            // 日付入力欄を YYYY/MM/DD パターンで優先識別
            const datePattern = /^\\d{4}\\/\\d{2}\\/\\d{2}$/;
            let si = -1, ei = -1;
            for (let i = 0; i < info.length; i++) {
                if (datePattern.test(info[i].value)) {
                    if (si < 0) si = i;
                    else if (ei < 0) { ei = i; break; }
                }
            }

            // パターン未検出時は属性で特定
            if (si < 0) {
                for (let i = 0; i < allVisible.length; i++) {
                    const el = allVisible[i];
                    const k = [el.name, el.id, el.placeholder,
                               el.getAttribute('ng-reflect-name') || ''].join(' ').toLowerCase();
                    if (si < 0 && (k.includes('start') || k.includes('from') || k.includes('開始'))) si = i;
                    else if (ei < 0 && (k.includes('end') || k.includes('to') || k.includes('終了'))) ei = i;
                }
            }
            // それでも未検出なら先頭2件
            if (si < 0 && info.length >= 1) si = 0;
            if (ei < 0 && info.length >= 2) ei = 1;

            return { inputs: info, si, ei };
        }""")

        inputs = rect_info.get('inputs', [])
        si = rect_info.get('si', 0)
        ei = rect_info.get('ei', 1)
        logger.info(f"入力欄検出: {len(inputs)}件 (開始idx={si}, 終了idx={ei})")
        logger.info(f"入力欄詳細: {inputs}")

        # ── Step 2: 座標クリック → Ctrl+A → Backspace → キーボード入力 ──────
        def fill_by_coord(rect: dict, value: str, label: str) -> bool:
            if not rect:
                logger.warning(f"'{label}': 座標が取得できません")
                return False
            try:
                page.mouse.click(rect['cx'], rect['cy'])
                time.sleep(0.3)
                page.keyboard.press("Control+a")
                time.sleep(0.1)
                page.keyboard.press("Backspace")
                time.sleep(0.1)
                page.keyboard.type(value)
                time.sleep(0.3)
                page.keyboard.press("Tab")
                time.sleep(0.5)
                logger.info(f"'{label}' キーボード入力: {value!r}")
                return True
            except Exception as e:
                logger.warning(f"'{label}' キーボード入力失敗: {e}")
                return False

        start_rect = inputs[si] if 0 <= si < len(inputs) else None
        end_rect   = inputs[ei] if 0 <= ei < len(inputs) else None

        filled_start = fill_by_coord(start_rect, start_str, "開始日")
        filled_end   = fill_by_coord(end_rect,   end_str,   "終了日")

        time.sleep(1)
        self._save_screenshot(page, f"after_set_period_{start.strftime('%Y%m')}")

        # ── Step 3: 設定後の実際値を読み返して検証 ───────────────────────────
        actual = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('input'))
                .filter(el => el.type !== 'hidden' && el.offsetParent !== null)
                .map(el => el.value);
        }""")
        logger.info(f"設定後の入力値(全{len(actual)}件): {actual}")

        # si/ei インデックスで直接検証（全体 list で確認）
        start_ok = (0 <= si < len(actual) and actual[si] == start_str) or start_str in actual
        end_ok   = (0 <= ei < len(actual) and actual[ei] == end_str)   or end_str   in actual
        if start_ok and end_ok:
            logger.info(f"期間設定完了: {start_str} 〜 {end_str}")
        else:
            sv = actual[si] if si < len(actual) else 'N/A'
            ev = actual[ei] if ei < len(actual) else 'N/A'
            logger.warning(
                f"期間が正しくセットされていない可能性！ "
                f"actual[{si}]={sv!r}, actual[{ei}]={ev!r}, "
                f"期待: {start_str!r}/{end_str!r}"
            )

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
            update_data: list[dict] = []
            for store_name, data in store_data.items():
                new_row = [year_month, store_name, data.get(metric_key, 0.0), kind, timestamp]
                dup_idx = self._find_dup(existing, year_month, store_name, kind)
                if dup_idx is not None:
                    update_data.append({
                        "range": f"'{sheet_name}'!A{dup_idx}:E{dup_idx}",
                        "values": [new_row],
                    })
                else:
                    rows_to_append.append(new_row)

            # 1回のbatchUpdateで全上書き（レート制限対策）
            if update_data:
                self.sheets_service.spreadsheets().values().batchUpdate(
                    spreadsheetId=SPREADSHEET_ID,
                    body={"valueInputOption": "RAW", "data": update_data},
                ).execute()
                time.sleep(1)

            if rows_to_append:
                self.sheets_service.spreadsheets().values().append(
                    spreadsheetId=SPREADSHEET_ID,
                    range=f"'{sheet_name}'!A1",
                    valueInputOption="RAW",
                    insertDataOption="INSERT_ROWS",
                    body={"values": rows_to_append},
                ).execute()
                time.sleep(1)

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
        self._fill_first_bool(page, selectors, value, name)

    def _fill_first_bool(
        self, page: Page, selectors: list[str], value: str, name: str
    ) -> bool:
        """セレクタリストの先頭から順に試して入力する。成功したら True を返す。"""
        for sel in selectors:
            try:
                loc = page.locator(sel)
                if loc.count() > 0:
                    loc.first.fill(value)
                    logger.info(f"{name} Playwright入力完了: {value!r} ({sel})")
                    return True
            except Exception:
                continue
        logger.warning(f"'{name}' の入力欄が Playwright で見つかりませんでした")
        return False

    def _save_screenshot(self, page: Page, name: str) -> None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = self.screenshot_dir / f"{ts}_{name}.png"
        try:
            page.screenshot(path=str(path))
            logger.info(f"スクリーンショット保存: {path}")
        except Exception as e:
            logger.warning(f"スクリーンショット保存失敗: {e}")
