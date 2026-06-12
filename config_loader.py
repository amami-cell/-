from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml
from dotenv import load_dotenv


@dataclass
class InfomartConfig:
    base_url: str
    login_url: str
    inventory_url: str
    timeout_ms: int = 30000
    wait_after_select_ms: int = 3000
    download_wait_ms: int = 5000


@dataclass
class DownloadConfig:
    output_dir: str = "./downloads"
    screenshot_dir: str = "./screenshots"
    retry_count: int = 3
    retry_wait_seconds: int = 5


@dataclass
class GoogleConfig:
    drive_folder_path: str = "棚卸自動化/インフォマート"
    spreadsheet_name: str = "棚卸集計_インフォマート"
    summary_sheet_name: str = "月次集計"
    missing_sheet_name: str = "未提出店舗"
    master_sheet_name: str = "店舗マスタ"


@dataclass
class StoreConfig:
    store_id: str
    store_name: str = ""
    file_prefix: str = ""

    def __repr__(self) -> str:
        return f"Store({self.store_id})"


@dataclass
class AppConfig:
    infomart: InfomartConfig
    download: DownloadConfig
    google: GoogleConfig
    stores: list[StoreConfig] = field(default_factory=list)

    @classmethod
    def load(cls, config_path: str = "./config.yaml", env_path: str = "./.env") -> "AppConfig":
        load_dotenv(env_path)
        with open(config_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        infomart = InfomartConfig(**data.get("infomart", {}))
        download = DownloadConfig(**data.get("download", {}))
        google = GoogleConfig(**data.get("google", {}))

        stores = []
        for s in data.get("stores", []):
            stores.append(StoreConfig(
                store_id=str(s.get("store_id", "")),
                store_name=str(s.get("store_name", "")),
                file_prefix=str(s.get("file_prefix", "")),
            ))

        return cls(infomart=infomart, download=download, google=google, stores=stores)
