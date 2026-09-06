"""
tools/tests/test_line.py
LINE未入力報告の純関数（compute_missing / build_text / pick_mode）を検証する。
Google APIには触れないので、import時に google 系をスタブして依存なしで実行する。
"""
import os
import sys
import types
from datetime import datetime, timezone, timedelta

for _name in ["google", "google.oauth2", "google.oauth2.service_account",
              "googleapiclient", "googleapiclient.discovery"]:
    sys.modules.setdefault(_name, types.ModuleType(_name))
sys.modules["google.oauth2.service_account"].Credentials = object
sys.modules["googleapiclient.discovery"].build = lambda *a, **k: None

_TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _TOOLS)

import tana_line as L  # noqa: E402

JST = timezone(timedelta(hours=9))


def test_compute_missing():
    # 売上>0 かつ 棚卸0/欠落 の店だけが未入力。売上0は対象外。
    metrics = {"2026-08": {
        "0001015_すさび湯 歌舞伎町": {"sales": 1000000},
        "0001151_NagaGutsu": {"sales": 500000},
        "0001111_ちゃーちゃん": {"sales": 0},          # 売上0 → 対象外
        "0001097_ARATA": {"sales": 800000},
    }}
    inventory = {"2026-08": {
        "0001015_すさび湯 歌舞伎町": {"food": 0, "drink": 0},   # 0 → 未入力
        "0001097_ARATA": {"food": 50000, "drink": 10000},       # 入力済 → 対象外
        # NagaGutsu: inventory欠落 → 未入力
    }}
    miss = L.compute_missing(metrics, inventory, "2026-08")
    assert miss == sorted(["すさび湯 歌舞伎町", "NagaGutsu"]), miss


def test_build_text():
    t = L.build_text(["NagaGutsu", "ARATA"], "2026-08", "月末棚 未入力", "8/5")
    assert "2 店" in t and "NagaGutsu" in t and "ARATA" in t
    done = L.build_text([], "2026-08", "月末棚 未入力", "8/5")
    assert "全店" in done and "✅" in done


def test_pick_mode():
    assert L.pick_mode(True, None, datetime(2026, 8, 5, tzinfo=JST)) == "final"
    assert L.pick_mode(True, None, datetime(2026, 8, 20, tzinfo=JST)) == "interim"
    assert L.pick_mode(True, None, datetime(2026, 8, 4, tzinfo=JST)) is None
    # 明示 mode は日付に依らず優先
    assert L.pick_mode(False, "interim", datetime(2026, 8, 4, tzinfo=JST)) == "interim"


if __name__ == "__main__":
    test_compute_missing()
    test_build_text()
    test_pick_mode()
    print("OK: tana_line 純関数テスト通過")
