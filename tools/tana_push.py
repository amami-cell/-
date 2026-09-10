"""
tools/tana_push.py
棚卸ダッシュボードのプッシュ通知 送信スクリプト（GitHub Actions から実行）。

- スプレッドシートの各シートを読み、アプリ（index.html の calcM）と同じ計算で
  「未入力 / 要確認 / 月末着地オーバー見込み / 月次サマリー」を判定する。
- 「通知購読」シートに保存された購読すべてへ pywebpush で配信する（＝アプリを開いて
  通知をオンにした人全員）。410/404 の無効購読は自動で掃除する。

実行例:
    python tools/tana_push.py --auto                # 実行日から送る内容を自動判定
    python tools/tana_push.py --kinds pending,alert # 種類を指定
    python tools/tana_push.py --auto --dry-run      # 送らずに内容だけ表示（動作確認用）

必要な環境変数:
    GOOGLE_SERVICE_ACCOUNT_JSON  … サービスアカウントJSONのパス
    VAPID_PRIVATE_KEY            … VAPID秘密鍵（base64url raw 32byte）※GitHub Secrets
    VAPID_SUBJECT               … 連絡先（例 mailto:amami@8sin.co.jp）任意
"""
import argparse
import base64
import json
import os
import sys
from calendar import monthrange
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from google.oauth2 import service_account
from googleapiclient.discovery import build

SPREADSHEET_ID = "18Fq_mpEweHOFTlF4ntmwJzDsJNSt-DOq7wQYy8E0iLc"
JST = timezone(timedelta(hours=9))

# 指標シートのマッピングは load_data() 内の field_by_sheet が唯一の定義（重複・誤キー防止のため
# ここにあった未使用の METRIC_SHEETS は削除）。
INVENTORY_SHEET = "月次集計"
LOSS_SHEET = "ロス記録"
SETTINGS_SHEET = "店舗設定"
SUBS_SHEET = "通知購読"
STORE_MASTER_SHEET = "店舗マスタ"  # 任意。[インフォマート名, FWキー]があれば STORE_MAP を上書き/追加（dashboard.gsと同じ）

# インフォマート店舗名 → FW店舗名（dashboard.gs STORE_MAP と同一）
STORE_MAP = {
    "すさび湯　歌舞伎町（ＨＡＳＳＩＮ）": "0001015_すさび湯 歌舞伎町",
    "Ｉｔａｌｉａｎ　Ｂａｒ　ＮａｇａＧｕｔｓｕ（ＨＡＳＳＩＮ）": "0001151_NagaGutsu",
    "パフェ＆ジェラート　ＬＡＲＧＯ　ルクア店（ＨＡＳＳＩＮ）": "0001160_ルクアLargo",
    "フレンチ酒場ＧＯＬＤ（ＨＡＳＳＩＮ）": "0001163_フレンチ酒場GOLD",
    "フレンチ酒場ＧＯＬＤ　京都ポルタ店（ＨＡＳＳＩＮ）": "0001168_GOLD京都ポルタ店",
    "すさび湯　三宮店（ＨＡＳＳＩＮ）": "0001169_すさび湯三宮店",
    "すさび湯　京都烏丸（ＨＡＳＳＩＮ）": "0001712_すさび湯京都烏丸",
    "喫茶Ｌａｒｇｏ　門真（ＨＡＳＳＩＮ）": "0001713_門真Largo",
    "すさび湯パナンテ京阪天満橋店（ＨＡＳＳＩＮ）": "0001728_すさび湯 天満橋店",
    "フレンチ酒場ＧＯＬＤ　お初天神店（ＨＡＳＳＩＮ）": "0001729_フレンチ酒場GOLDお初",
    "ぎふやパナンテ天満橋（ＨＡＳＳＩＮ）": "0001739_ぎふや 天満橋店",
    "すさび湯　三条店（ＨＡＳＳＩＮ）": "0001742_すさび湯 京都三条店",
    "すさび湯　新宿東口店（ＨＡＳＳＩＮ）": "0001743_すさび湯 新宿東口店",
    "熊の鳥焼（ＨＡＳＳＩＮ）": "0001154_熊の鳥焼",
    "ちゃーちゃん（ＨＡＳＳＩＮ）": "0001111_ちゃーちゃん",
    "料理と酒　たいだい（旧　にと）（ＨＡＳＳＩＮ）": "0001137_料理と酒 たいだい",
    "曲ル角ニハ泡喰ライ（ＨＡＳＳＩＮ）": "0001115_大衆酒場 曲ル角ニハ泡喰ライ",
    "ひよこ飯店（ＨＡＳＳＩＮ）": "0001069_ひよこ飯店",
    "んだんだ新宿三丁目店（ＨＡＳＳＩＮ）": "0002004_んだんだ",
    "すさび湯（ＨＡＳＳＩＮ）": "0001006_大衆寿司酒場すさび湯",
    "ＵＭＡＭＩ（ＨＡＳＳＩＮ）": "0001131_CRAFTMAN UMAMI",
    "ＡＲＡＴＡ（ＨＡＳＳＩＮ）": "0001097_ARATA",
    "味のたぬきや（ＨＡＳＳＩＮ）": "0001162_味のたぬきや",
}


def _num(v):
    # UNFORMATTED_VALUE では数値はそのまま来る。整形文字列(¥/円/カンマ/％/全角)も一応剥がす。
    if isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        s = (str(v).replace(",", "").replace("¥", "").replace("￥", "")
             .replace("円", "").replace("%", "").replace("％", "").strip())
        return float(s or 0)
    except Exception:
        return 0.0


def days_in_month(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return monthrange(y, m)[1]


def prev_ym(ym):
    y, m = int(ym[:4]), int(ym[5:7]) - 1
    if m == 0:
        m = 12
        y -= 1
    return f"{y}-{m:02d}"


# 店舗マスタ(任意)を反映したインフォマート名→FWキー対応表。無ければハードコードのまま（挙動不変）。
def _build_store_map(svc):
    m = dict(STORE_MAP)
    try:
        vals = svc.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range=f"'{STORE_MASTER_SHEET}'!A:B",
            valueRenderOption="UNFORMATTED_VALUE"
        ).execute().get("values", [])
        for i, row in enumerate(vals):
            if i == 0 or len(row) < 2:
                continue
            raw = str(row[0]).strip()
            key = str(row[1]).strip()
            if raw and key:
                m[raw] = key
    except Exception:
        pass  # シート未作成/読取失敗時はハードコードのまま
    return m


# ── データ読み込み（dashboard.gs getDashboardData と同じ組み立て）──────────────
def load_data(svc):
    store_map = _build_store_map(svc)
    metrics = defaultdict(dict)   # metrics[ym][store] = {field: val, kind}
    stores = set()
    field_by_sheet = {name: key for key, name in {
        "sales": "売上", "foodSales": "F売上", "drinkSales": "D売上",
        "foodPurchase": "F食材費仕入", "drinkPurchase": "D飲料費仕入",
        "foodTheory": "フード理論原価", "drinkTheory": "ドリンク理論原価",
        "budgetFoodCost": "F予算", "budgetDrinkCost": "D予算",
    }.items()}
    for sheet_name, field in field_by_sheet.items():
        try:
            vals = svc.spreadsheets().values().get(
                spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'!A:D",
                valueRenderOption="UNFORMATTED_VALUE"
            ).execute().get("values", [])
        except Exception:
            continue
        for row in vals:
            if len(row) < 3:
                continue
            ym = str(row[0]).strip()
            store = str(row[1]).strip()
            if len(ym) != 7 or ym[4] != "-" or not store:
                continue
            kind = str(row[3]).strip() if len(row) > 3 else ""
            cell = metrics[ym].setdefault(store, {})
            # 確定を優先（中間しか無い月はそのまま）
            if cell.get(field) is None or kind == "確定":
                cell[field] = _num(row[2])
                if kind:
                    cell["kind"] = kind
                elif "kind" not in cell:
                    cell["kind"] = ""
            stores.add(store)

    # 月次集計 → inventory
    inventory = defaultdict(dict)
    try:
        vals = svc.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range=f"'{INVENTORY_SHEET}'!A:E",
            valueRenderOption="UNFORMATTED_VALUE"
        ).execute().get("values", [])
    except Exception:
        vals = []
    for row in vals:
        if len(row) < 2:
            continue
        ym = str(row[0]).strip()
        if len(ym) != 7 or ym[4] != "-":
            continue
        raw = str(row[1]).strip()
        store = store_map.get(raw, raw)
        inventory[ym][store] = {
            "food": _num(row[2]) if len(row) > 2 else 0,
            "drink": _num(row[3]) if len(row) > 3 else 0,
        }

    # ロス記録 → losses[ym][store] = [{kind, cat, amount}]
    losses = defaultdict(lambda: defaultdict(list))
    try:
        vals = svc.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range=f"'{LOSS_SHEET}'!A:H",
            valueRenderOption="UNFORMATTED_VALUE"
        ).execute().get("values", [])
    except Exception:
        vals = []
    for row in vals:
        if len(row) < 7:
            continue
        ym = str(row[1]).strip()
        store = str(row[2]).strip()
        if len(ym) != 7 or not store:
            continue
        losses[ym][store].append({"kind": str(row[3]).strip(), "amount": _num(row[6])})

    # 店舗設定 → store_flags（2%込み済み）
    store_flags = {}
    try:
        vals = svc.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range=f"'{SETTINGS_SHEET}'!A:B",
            valueRenderOption="UNFORMATTED_VALUE"
        ).execute().get("values", [])
    except Exception:
        vals = []
    for row in vals:
        if not row:
            continue
        store = str(row[0]).strip()
        flag = len(row) > 1 and str(row[1]).strip().upper() == "TRUE"
        if store:
            store_flags[store] = flag

    # 店舗名一覧（順序は metrics 出現順で十分）
    return metrics, inventory, losses, store_flags, sorted(stores)


def inv_of(inventory, ym, store):
    iv = inventory.get(ym, {}).get(store)
    if not iv:
        return None
    total = (iv.get("food") or 0) + (iv.get("drink") or 0)
    return None if total == 0 else total   # 合計0は未入力扱い


# ── calcM（FD・2%込み既定）と同じ計算 ───────────────────────────────────────
def calc_fd(metrics, inventory, losses, store_flags, ym, store):
    cell = metrics.get(ym, {}).get(store)
    inv_cur = inv_of(inventory, ym, store)
    if not cell and inv_cur is None:
        return None
    cell = cell or {}
    days = days_in_month(ym)
    sales = cell.get("sales") or 0
    purchase = (cell.get("foodPurchase") or 0) + (cell.get("drinkPurchase") or 0)
    theory = (cell.get("foodTheory") or 0) + (cell.get("drinkTheory") or 0)
    pct2 = ((cell.get("foodSales") or 0) + (cell.get("drinkSales") or 0)) * 0.02
    if not store_flags.get(store):   # pct2View='incl' 既定：2%込みで無ければ加算
        theory += pct2
    ls = losses.get(ym, {}).get(store, [])
    need = sum(l["amount"] for l in ls if l["kind"] == "必要ロス")
    waste = sum(l["amount"] for l in ls if l["kind"] == "廃棄ロス")
    theory_adj = sum(l["amount"] for l in ls if l["kind"] == "理論原価")
    theory += theory_adj
    kind = cell.get("kind", "")
    theory_days = 15 if kind == "中間" else days
    turnover = inv_cur / (theory / theory_days) if (inv_cur is not None and theory > 0) else None
    inv_prev = inv_of(inventory, prev_ym(ym), store)
    actual = (inv_prev + purchase - inv_cur) if (inv_prev is not None and inv_cur is not None) else None
    unknown = (actual - theory - need - waste) if actual is not None else None
    budget_cost = (cell.get("budgetFoodCost") or 0) + (cell.get("budgetDrinkCost") or 0)
    return {
        "kind": kind, "sales": sales, "purchase": purchase, "theory": theory,
        "invCur": inv_cur, "days": days, "budgetCost": budget_cost,
        "turnover": turnover,
        "unknown": unknown,
        "unknownRate": (unknown / sales) if (sales and unknown is not None) else None,
        "purchaseRate": (purchase / sales) if sales else None,
        "budgetRate": (budget_cost / sales) if (sales and budget_cost > 0) else None,
    }


def yen(v):
    return "¥{:,}".format(int(round(v)))


# ── 通知メッセージ生成 ───────────────────────────────────────────────────────
def msg_pending(metrics, inventory, ym, kind_label, due_md):
    names = []
    for store, cell in metrics.get(ym, {}).items():
        if (cell.get("sales") or 0) > 0 and inv_of(inventory, ym, store) is None:
            names.append(store.split("_")[-1])
    if not names:
        return None
    body = "、".join(names[:6]) + ("…" if len(names) > 6 else "")
    return {"title": f"📦 棚卸 未入力 {len(names)}店（{kind_label}・締切{due_md}）",
            "body": body + " が未入力です", "tag": "pending", "url": "./"}


def msg_alert(rows):
    turn = [r for r in rows if r["turnover"] is not None and r["turnover"] >= 15]
    loss = [r for r in rows if r["unknownRate"] is not None and abs(r["unknownRate"]) * 100 > 2]
    cost = [r for r in rows if r["budgetRate"] is not None and r["purchaseRate"] is not None
            and r["purchaseRate"] > r["budgetRate"] + 0.0005]
    if not (turn or loss or cost):
        return None
    parts = []
    if turn:
        parts.append(f"在庫回転15日〜 {len(turn)}店")
    if loss:
        parts.append(f"不明ロス2%超 {len(loss)}店")
    if cost:
        parts.append(f"原価オーバー {len(cost)}店")
    return {"title": "⚠️ 要確認の店舗があります",
            "body": " / ".join(parts), "tag": "alert", "url": "./"}


def msg_forecast(rows_fc):
    over = [r for r in rows_fc if r["over"] > 0.0005]
    if not over:
        return None
    over.sort(key=lambda r: -r["over"])
    names = "、".join(r["name"].split("_")[-1] for r in over[:5])
    return {"title": f"🔮 月末 予算オーバー着地の見込み {len(over)}店",
            "body": f"中間のペースだと {names} が予算超過で着地見込み", "tag": "forecast", "url": "./"}


def msg_summary(rows, ym):
    tot_unknown = sum(r["unknown"] for r in rows if r["unknown"] is not None)
    judged = [r for r in rows if r["budgetRate"] is not None and r["purchaseRate"] is not None]
    ok = [r for r in judged if r["purchaseRate"] <= r["budgetRate"] + 0.0005]
    return {"title": f"📋 {ym} 月次サマリー",
            "body": f"不明ロス総額 {yen(tot_unknown)} ／ 予算達成 {len(ok)}/{len(judged)}店",
            "tag": "summary", "url": "./"}


# ── 送信（pywebpush）──────────────────────────────────────────────────────────
def load_subscriptions(svc):
    try:
        vals = svc.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range=f"'{SUBS_SHEET}'!A:C",
            valueRenderOption="UNFORMATTED_VALUE"
        ).execute().get("values", [])
    except Exception:
        return []
    subs = []
    for i, row in enumerate(vals):
        if i == 0 or not row:
            continue
        try:
            subs.append({"row": i + 1, "endpoint": row[0], "sub": json.loads(row[1])})
        except Exception:
            continue
    return subs


def send_all(svc, subs, payload, vapid_priv, subject, dry_run):
    if dry_run:
        print(f"  [dry-run] {payload['title']} — {payload['body']}  → {len(subs)}件")
        return 0, []
    from pywebpush import webpush, WebPushException
    sent, dead = 0, []
    claims = {"sub": subject or "mailto:admin@example.com"}
    for s in subs:
        try:
            webpush(subscription_info=s["sub"], data=json.dumps(payload, ensure_ascii=False),
                    vapid_private_key=vapid_priv, vapid_claims=dict(claims))
            sent += 1
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):
                dead.append(s["row"])
        except Exception:
            pass
    return sent, dead


def prune_dead(svc, rows):
    # 行番号の大きい方から消す（インデックスずれ防止）
    for r in sorted(rows, reverse=True):
        try:
            meta = svc.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
            sid = next(sh["properties"]["sheetId"] for sh in meta["sheets"]
                       if sh["properties"]["title"] == SUBS_SHEET)
            svc.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": [
                {"deleteDimension": {"range": {"sheetId": sid, "dimension": "ROWS",
                                               "startIndex": r - 1, "endIndex": r}}}]}).execute()
        except Exception:
            pass


def pick_kinds(auto, kinds_arg, now):
    if kinds_arg:
        return set(kinds_arg.split(","))
    if not auto:
        return set()
    d = now.day
    ks = set()
    if 16 <= d <= 20:          # 月中：中間の未入力・着地オーバー見込み
        ks |= {"pending_interim", "forecast"}
    if 3 <= d <= 5:            # 月初：前月末の未入力・要確認・サマリー
        ks |= {"pending_final", "alert", "summary"}
    return ks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--auto", action="store_true", help="実行日から送る内容を自動判定")
    ap.add_argument("--kinds", default="", help="pending_interim,pending_final,alert,forecast,summary")
    ap.add_argument("--dry-run", action="store_true", help="送らずに内容だけ表示")
    args = ap.parse_args()

    now = datetime.now(JST)
    kinds = pick_kinds(args.auto, args.kinds, now)
    if not kinds:
        print("送る種類がありません（--auto は 3-5日/16-20日のみ、または --kinds を指定）")
        return 0

    cred = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json")
    creds = service_account.Credentials.from_service_account_file(
        cred, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    svc = build("sheets", "v4", credentials=creds)

    metrics, inventory, losses, store_flags, stores = load_data(svc)
    cur_ym = now.strftime("%Y-%m")
    last_ym = prev_ym(cur_ym)

    payloads = []
    if "pending_interim" in kinds:
        p = msg_pending(metrics, inventory, cur_ym, "中間棚", f"{now.month}/20")
        if p:
            payloads.append(p)
    if "pending_final" in kinds:
        due = (datetime(now.year, now.month, 5, tzinfo=JST))
        p = msg_pending(metrics, inventory, last_ym, "月末棚", f"{due.month}/5")
        if p:
            payloads.append(p)
    if "alert" in kinds:
        rows = [r for r in (calc_fd(metrics, inventory, losses, store_flags, last_ym, s) for s in stores) if r]
        m = msg_alert(rows)
        if m:
            payloads.append(m)
    if "summary" in kinds:
        rows = [r for r in (calc_fd(metrics, inventory, losses, store_flags, last_ym, s) for s in stores) if r]
        if rows:
            payloads.append(msg_summary(rows, last_ym))
    if "forecast" in kinds:
        rows_fc = []
        for s in stores:
            cell = metrics.get(cur_ym, {}).get(s)
            if not cell or cell.get("kind") != "中間":
                continue
            sales = cell.get("sales") or 0
            if not sales:
                continue
            purchase = (cell.get("foodPurchase") or 0) + (cell.get("drinkPurchase") or 0)
            budget = (cell.get("budgetFoodCost") or 0) + (cell.get("budgetDrinkCost") or 0)
            if budget <= 0:
                continue
            days = days_in_month(cur_ym)
            proj_sales = sales * (days / 15)
            pr = purchase / sales
            br = budget / proj_sales
            rows_fc.append({"name": s, "over": pr - br})
        m = msg_forecast(rows_fc)
        if m:
            payloads.append(m)

    if not payloads:
        print("送る通知はありません（条件に該当なし）")
        return 0

    subs = load_subscriptions(svc)
    print(f"購読 {len(subs)}件 / 通知 {len(payloads)}件")
    vapid_priv = os.environ.get("VAPID_PRIVATE_KEY", "")
    subject = os.environ.get("VAPID_SUBJECT", "")
    if not args.dry_run and not vapid_priv:
        print("::error::VAPID_PRIVATE_KEY 未設定のため送信できません（GitHub Secretsに登録してください）")
        return 1

    all_dead = []
    for p in payloads:
        sent, dead = send_all(svc, subs, p, vapid_priv, subject, args.dry_run)
        if not args.dry_run:
            print(f"  送信 {sent}/{len(subs)}: {p['title']}")
        all_dead += dead
    if all_dead:
        prune_dead(svc, list(set(all_dead)))
        print(f"  無効購読を掃除: {len(set(all_dead))}件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
