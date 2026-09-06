"""
tools/tests/test_calc.py
Python側の在庫計算 calc_fd（通知/LINE報告が使う）を、共有ゴールデンケース
(golden_cases.json) と突き合わせて検証する。JS側(calcM)も同じJSONと突き合わせる
（parity_calcm.js）ので、片方だけ直してドリフトすると必ずどちらかが落ちる。

Google APIには触れない純計算なので、import時に google 系モジュールをスタブして
どこでも（依存未インストールでも）実行できるようにしている。
"""
import json
import os
import sys
import types

# tana_push は先頭で google 系を import するが、calc_fd は純計算で使わない。
# テストを依存なしで動かすため、import 前にダミーモジュールを差し込む。
for _name in ["google", "google.oauth2", "google.oauth2.service_account",
              "googleapiclient", "googleapiclient.discovery"]:
    sys.modules.setdefault(_name, types.ModuleType(_name))
sys.modules["google.oauth2.service_account"].Credentials = object
sys.modules["googleapiclient.discovery"].build = lambda *a, **k: None

_TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _TOOLS)

from tana_push import calc_fd  # noqa: E402

_HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_HERE, "golden_cases.json"), encoding="utf-8") as f:
    GOLDEN = json.load(f)
STORE = GOLDEN["store"]

# 比較する項目と許容誤差（率・回転はfloat、金額はexact）
TOL = {
    "theory": 0.5,          # 円（実質exact）
    "turnover": 1e-3,       # 日
    "unknown": 0.5,         # 円
    "unknownRate": 1e-6,
    "purchaseRate": 1e-6,
    "budgetRate": 1e-6,
}


def _build(case):
    """ゴールデン1件を calc_fd が食える {ym:{store:...}} 構造へ組み立てる。"""
    metrics = {ym: {STORE: dict(v)} for ym, v in case["metrics"].items()}
    inventory = {ym: {STORE: dict(v)} for ym, v in case["inventory"].items()}
    losses = {ym: {STORE: [dict(x) for x in arr]} for ym, arr in case.get("losses", {}).items()}
    store_flags = {STORE: bool(case.get("storeFlag"))}
    return metrics, inventory, losses, store_flags


def _check(name, got, exp):
    for key, tol in TOL.items():
        if key not in exp:
            continue
        e = exp[key]
        g = got.get(key)
        if e is None:
            assert g is None, f"[{name}] {key}: 期待 None / 実際 {g!r}"
        else:
            assert g is not None, f"[{name}] {key}: 期待 {e} / 実際 None"
            assert abs(g - e) <= tol, f"[{name}] {key}: 期待 {e} / 実際 {g}（許容 {tol}）"


def test_calc_fd_matches_golden():
    for case in GOLDEN["cases"]:
        metrics, inventory, losses, flags = _build(case)
        got = calc_fd(metrics, inventory, losses, flags, case["ym"], STORE)
        assert got is not None, f"[{case['name']}] calc_fd が None を返した"
        _check(case["name"], got, case["expected"])


if __name__ == "__main__":
    test_calc_fd_matches_golden()
    print("OK: calc_fd はゴールデンケースと一致")
