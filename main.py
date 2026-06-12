"""
main.py
発注インフォマート 棚卸自動化システム エントリーポイント。

実行方法:
    # 通常実行（前月を自動取得）
    python main.py

    # 対象月を指定して実行
    python main.py --month 2026-05

    # 特定店舗のみ再実行
    python main.py --stores "UMAMI ARATA すさび" "UMAMI BURGER 渋谷"

    # ダウンロードのみ（スプレッドシート集計をスキップ）
    python main.py --download-only

    # 集計のみ（既存のダウンロードファイルを使用）
    python main.py --aggregate-only
"""

from __future__ import annotations

import argparse
import sys
from calendar import monthrange
from datetime import date, datetime
from pathlib import Path

from loguru import logger

from config_loader import AppConfig, StoreConfig
from downloader import InfomartDownloader, DownloadResult
from google_drive import GoogleDriveUploader
from spreadsheet import SpreadsheetAggregator


# ==============================================================================
# ロガー設定
# ==============================================================================

def setup_logger(log_level: str = "INFO") -> None:
    """loguru のロガーを設定する"""
    log_dir = Path("./logs")
    log_dir.mkdir(exist_ok=True)

    logger.remove()  # デフォルトハンドラを削除

    # コンソール出力
    logger.add(
        sys.stderr,
        level=log_level,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{message}</cyan>",
        colorize=True,
    )

    # ファイル出力（日次ローテーション）
    logger.add(
        log_dir / "infomart_{time:YYYY-MM-DD}.log",
        level="DEBUG",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} | {message}",
        rotation="1 day",
        retention="30 days",
        encoding="utf-8",
    )


# ==============================================================================
# ターゲット月計算
# ==============================================================================

def get_previous_month(reference: date = None) -> date:
    """前月の1日を返す"""
    if reference is None:
        reference = date.today()
    year = reference.year
    month = reference.month - 1
    if month == 0:
        month = 12
        year -= 1
    return date(year, month, 1)


def parse_month(month_str: str) -> date:
    """'YYYY-MM' 形式の文字列を date に変換する"""
    try:
        return datetime.strptime(month_str, "%Y-%m").date().replace(day=1)
    except ValueError:
        raise ValueError(f"月の形式が不正です: '{month_str}' (例: 2026-05)")


# ==============================================================================
# 引数パーサー
# ==============================================================================

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="発注インフォマート 棚卸自動化システム",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用例:
  python main.py                          # 通常実行（前月を自動取得）
  python main.py --month 2026-05          # 対象月を指定
  python main.py --stores "UMAMI ARATA すさび"  # 特定店舗のみ
  python main.py --download-only          # ダウンロードのみ
  python main.py --aggregate-only         # 集計のみ（既存ファイル使用）
        """,
    )
    parser.add_argument(
        "--month", "-m",
        type=str,
        default=None,
        help="取得対象年月 (YYYY-MM形式)。未指定の場合は前月。",
    )
    parser.add_argument(
        "--stores", "-s",
        type=str,
        nargs="+",
        default=None,
        help="対象店舗名を指定（複数可）。未指定の場合は全店舗。",
    )
    parser.add_argument(
        "--download-only",
        action="store_true",
        help="ダウンロードのみ実行（Drive アップロード・集計をスキップ）",
    )
    parser.add_argument(
        "--aggregate-only",
        action="store_true",
        help="集計のみ実行（./downloads 内の既存ファイルを使用）",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default=None,
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="ログレベル (デフォルト: .env の LOG_LEVEL または INFO)",
    )
    return parser


# ==============================================================================
# メイン処理クラス
# ==============================================================================

class AutomationPipeline:
    """
    棚卸自動化の全工程を管理するパイプラインクラス。

    工程:
        1. ダウンロード (InfomartDownloader)
        2. Drive アップロード (GoogleDriveUploader)
        3. スプレッドシート集計 (SpreadsheetAggregator)
    """

    def __init__(self, config: AppConfig):
        self.config = config
        self.downloader = InfomartDownloader(config)
        self.uploader = GoogleDriveUploader(config)
        self.aggregator = SpreadsheetAggregator(config)

    def run(
        self,
        target_month: date,
        stores: list[StoreConfig] = None,
        skip_download: bool = False,
        skip_upload: bool = False,
        skip_aggregate: bool = False,
    ) -> None:
        """
        パイプラインを実行する。

        Args:
            target_month: 取得対象年月
            stores: 対象店舗リスト（None の場合は全店舗）
            skip_download: True の場合ダウンロードをスキップ
            skip_upload: True の場合 Drive アップロードをスキップ
            skip_aggregate: True の場合スプレッドシート集計をスキップ
        """
        if stores is None:
            stores = self.config.stores

        month_str = target_month.strftime("%Y-%m")
        logger.info("=" * 60)
        logger.info(f"棚卸自動化 開始: 対象月={month_str}, 店舗数={len(stores)}")
        logger.info("=" * 60)

        download_results: list[DownloadResult] = []

        # ──────────────────────────────────────────
        # STEP 1: ダウンロード
        # ──────────────────────────────────────────
        if not skip_download:
            logger.info("[STEP 1/3] インフォマートからダウンロード開始")
            download_results = self.downloader.run_all(target_month, stores)
            self._log_download_summary(download_results)
        else:
            logger.info("[STEP 1/3] ダウンロードをスキップ（既存ファイルを使用）")
            download_results = self._load_existing_files(target_month, stores)

        # ──────────────────────────────────────────
        # STEP 2: Google Drive アップロード
        # ──────────────────────────────────────────
        if not skip_upload:
            logger.info("[STEP 2/3] Google Drive へアップロード開始")
            successful_files = [r.file_path for r in download_results if r.success and r.file_path]
            if successful_files:
                upload_results = self.uploader.upload_files(successful_files)
                success_count = sum(1 for v in upload_results.values() if v)
                logger.info(f"アップロード完了: {success_count}/{len(successful_files)} 件")
                drive_url = self.uploader.get_folder_url(self.config.google.drive_folder_path)
                logger.info(f"保存先: {drive_url}")
            else:
                logger.warning("アップロード対象ファイルなし")
        else:
            logger.info("[STEP 2/3] アップロードをスキップ")

        # ──────────────────────────────────────────
        # STEP 3: スプレッドシート集計
        # ──────────────────────────────────────────
        if not skip_aggregate:
            logger.info("[STEP 3/3] スプレッドシートへ集計開始")
            spreadsheet_url = self.aggregator.aggregate(download_results, target_month)
            logger.info(f"集計先: {spreadsheet_url}")
        else:
            logger.info("[STEP 3/3] 集計をスキップ")

        logger.info("=" * 60)
        logger.info("棚卸自動化 完了")
        logger.info("=" * 60)

    def _load_existing_files(
        self, target_month: date, stores: list[StoreConfig]
    ) -> list[DownloadResult]:
        """
        ./downloads ディレクトリの既存ファイルを DownloadResult として返す
        （--aggregate-only 用）
        """
        results = []
        month_str = target_month.strftime("%Y-%m")
        download_dir = Path(self.config.download.output_dir)

        for store in stores:
            filename = f"{month_str}_{store.file_prefix}.xlsx"
            file_path = download_dir / filename
            if file_path.exists():
                results.append(DownloadResult(store=store, success=True, file_path=file_path))
                logger.debug(f"既存ファイル検出: {filename}")
            else:
                results.append(DownloadResult(
                    store=store, success=False, error=f"ファイルが見つかりません: {filename}"
                ))
                logger.warning(f"既存ファイルなし: {filename}")

        return results

    def _log_download_summary(self, results: list[DownloadResult]) -> None:
        """ダウンロード結果のサマリーをログに出力する"""
        success = [r for r in results if r.success]
        failed = [r for r in results if not r.success]

        logger.info(f"ダウンロードサマリー: 成功={len(success)}, 失敗={len(failed)}")
        if failed:
            for r in failed:
                logger.error(f"  ✗ {r.store.store_id}: {r.error}")


# ==============================================================================
# エントリーポイント
# ==============================================================================

def main() -> int:
    """メイン関数。終了コード (0=成功, 1=失敗) を返す"""

    parser = build_arg_parser()
    args = parser.parse_args()

    # ログ設定
    import os
    log_level = args.log_level or os.environ.get("LOG_LEVEL", "INFO")
    setup_logger(log_level)

    logger.info("発注インフォマート 棚卸自動化システム 起動")

    try:
        # 設定読み込み
        config = AppConfig.load()
        logger.info(f"設定読み込み完了: {len(config.stores)} 店舗")

        # 対象月決定
        if args.month:
            target_month = parse_month(args.month)
            logger.info(f"対象月（指定）: {target_month.strftime('%Y-%m')}")
        else:
            target_month = get_previous_month()
            logger.info(f"対象月（前月自動）: {target_month.strftime('%Y-%m')}")

        # 対象店舗フィルタリング
        stores = None
        if args.stores:
            stores = []
            for store_name in args.stores:
                store = config.get_store_by_id(store_name)
                if store is None:
                    logger.warning(f"店舗が見つかりません: '{store_name}' (スキップ)")
                else:
                    stores.append(store)
            if not stores:
                logger.error("有効な店舗が1件もありません")
                return 1

        # パイプライン実行
        pipeline = AutomationPipeline(config)
        pipeline.run(
            target_month=target_month,
            stores=stores,
            skip_download=args.aggregate_only,
            skip_upload=args.download_only or args.aggregate_only,
            skip_aggregate=args.download_only,
        )

        return 0

    except EnvironmentError as e:
        logger.error(f"環境設定エラー: {e}")
        return 1
    except FileNotFoundError as e:
        logger.error(f"ファイルエラー: {e}")
        return 1
    except KeyboardInterrupt:
        logger.info("ユーザーによって中断されました")
        return 1
    except Exception as e:
        logger.exception(f"予期しないエラーが発生しました: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
