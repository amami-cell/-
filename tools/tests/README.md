# 計算ロジックのテスト（JS/Python ドリフト検知）

在庫計算（在庫回転日数・不明ロス・理論原価2%・予算比 など）は、**アプリのJS(`gas/dashboard/index.html` の `calcM`)** と **通知のPython(`tools/tana_push.py` の `calc_fd`)** に**二重実装**されている。片方だけ直すと画面と通知で数字が食い違う（ドリフト）。

このテストは、両者を**同じ入力(ゴールデンケース)**で走らせて**同じ結果になること**を保証する。

## 単一の真実
- `golden_cases.json` … 代表入力と期待出力（確定/中間/棚卸0/前月なし/2%込みフラグ）。**ここだけを直せば両テストが同じ基準を見る。**

## 何が何を検証するか
- `test_calc.py`（pytest）… Python の `calc_fd` が `golden_cases.json` と一致するか。
- `test_line.py`（pytest）… LINE未入力報告の純関数（`compute_missing`/`build_text`/`pick_mode`）。
- `parity_calcm.js`（Playwright）… アプリの `calcM` を実ブラウザで走らせ、同じ `golden_cases.json` と一致するか。
  - index.html 末尾のテスト用フック `window.__tanaCalc`（本番動作に影響なし）を使って `calcM` を直接呼ぶ。

→ **どちらかの計算を直してドリフトすると、pytest か parity のどちらかが必ず落ちる。**

## 実行
```bash
# Python
pip install pytest && pytest tools/tests -q
# 依存なしでも各ファイル単体で実行可（google系はテスト内でスタブ）
python3 tools/tests/test_calc.py

# JS パリティ（要 playwright）
node tools/tests/parity_calcm.js
#   ローカルで既存のchromiumを使う場合:
#   NODE_PATH=/opt/node22/lib/node_modules PW_CHROME=<chrome> node tools/tests/parity_calcm.js
```

CI（`.github/workflows/tests.yml`）が push / PR 時に両方を自動実行する（公開リポなので無料）。

## 計算を変更するときの約束
1. `golden_cases.json` に、変更で影響するケースを足す（or 期待値を更新）。
2. JS(`calcM`) と Python(`calc_fd`) の**両方**を同じルールで直す。
3. `pytest tools/tests` と `node tools/tests/parity_calcm.js` が緑になることを確認。

> しきい値（在庫回転15日・不明ロス2%・2%手数料・EPS 等）が各所に散っている点は別課題(MNT-4)。将来ここへ集約するのが望ましい。値の集約は「現状は一致しているが下手に触ると静かにドリフトする」ため、テスト網羅を広げてから慎重に行う（本テストはしきい値そのものは検証しない）。

## 二重実装の対象範囲（重要な前提）
- **共有パリティ（JS↔Python）で守るのは FD合算・2%込み(incl) の `calcM`/`calc_fd` のみ。** 通知Python は FD・incl 固定実装のため、ここが唯一の正。
- したがって **F単独 / D単独 / 2%なし(excl) / forecast（中間着地）** は golden/parity の対象外（＝JS専用経路）。これらを変更するときは JS 側で個別に確認する。将来 golden をJS専用ケースに拡張する余地はある（MNT-4と合わせて）。
- `理論原価`（手動加算ロス）は両実装が対応しており、golden にケースあり（`theory`へ上乗せ）。
