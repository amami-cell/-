"""設定の解決。認証情報が欠けたまま cloud で走り出さないこと。"""
import pytest

from hansoku.settings import SettingsError, load_settings


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in (
        "HANSOKU_ENV", "BIGQUERY_PROJECT", "BIGQUERY_DATASET",
        "GOOGLE_SERVICE_ACCOUNT_JSON", "NEON_DATABASE_URL",
        "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
        "LOCAL_DATABASE_URL", "FW_SPREADSHEET_ID",
    ):
        monkeypatch.delenv(name, raising=False)


def test_既定はlocalで認証情報なしでも読める():
    settings = load_settings()
    assert settings.env == "local"
    assert settings.warehouse.local_path.name.endswith(".duckdb")


def test_cloudで認証情報が欠けていれば落とす(monkeypatch):
    monkeypatch.setenv("HANSOKU_ENV", "cloud")
    with pytest.raises(SettingsError, match="BIGQUERY_PROJECT"):
        load_settings()


def test_cloudでサービスアカウント鍵が欠けていれば落とす(monkeypatch):
    monkeypatch.setenv("HANSOKU_ENV", "cloud")
    monkeypatch.setenv("BIGQUERY_PROJECT", "p")
    with pytest.raises(SettingsError, match="GOOGLE_SERVICE_ACCOUNT_JSON"):
        load_settings()


def test_cloudでNeon接続文字列が欠けていれば落とす(monkeypatch):
    monkeypatch.setenv("HANSOKU_ENV", "cloud")
    monkeypatch.setenv("BIGQUERY_PROJECT", "p")
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "{}")
    with pytest.raises(SettingsError, match="NEON_DATABASE_URL"):
        load_settings()


def test_cloudでR2の鍵が欠けていれば落とす(monkeypatch):
    monkeypatch.setenv("HANSOKU_ENV", "cloud")
    monkeypatch.setenv("BIGQUERY_PROJECT", "p")
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "{}")
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://x")
    with pytest.raises(SettingsError, match="R2_"):
        load_settings()


def test_全部揃えばcloudで読める(monkeypatch):
    for name, value in {
        "HANSOKU_ENV": "cloud",
        "BIGQUERY_PROJECT": "infomart-automation-498709",
        "GOOGLE_SERVICE_ACCOUNT_JSON": "{}",
        "NEON_DATABASE_URL": "postgresql://x",
        "R2_ACCOUNT_ID": "acc",
        "R2_ACCESS_KEY_ID": "key",
        "R2_SECRET_ACCESS_KEY": "secret",
    }.items():
        monkeypatch.setenv(name, value)
    settings = load_settings()
    assert settings.env == "cloud"
    assert settings.objects.endpoint_url == "https://acc.r2.cloudflarestorage.com"


def test_FW共有シートIDの既定は既存パイプラインのもの():
    assert load_settings().sources.fw_spreadsheet_id.startswith("18Fq_mpE")
