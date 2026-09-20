# -*- coding: utf-8 -*-
"""棚卸 月次: 店舗ごとのLINEグループへ「その月の結果＋入力URL」を送る。

- 各店の入力URL（署名トークン付き）は GAS の links エンドポイントから取得する
  （署名の秘密鍵は GAS 側が持ち、Python はキーで認証して受け取るだけ）。
- 店舗↔LINEグループの対応は「店舗LINE宛先」シートで管理する（列: 店舗, グループID）。
  店舗は FWキー(0001015_店名) でも表示名(店名) でも可。
- 集計は tana_push.calc_fd を再利用（＝アプリ index.html の calcM と同じ結果）。

  python tools/tana_month.py --ym 2026-09     # 指定月
  python tools/tana_month.py                   # 既定=前月（月末に確定した月）
  python tools/tana_month.py --dry-run         # 送らず内容を表示

env:
  LINE_CHANNEL_TOKEN            … LINE Messaging API トークン（GitHub Secrets）
  GOOGLE_SERVICE_ACCOUNT_JSON   … サービスアカウントJSONのパス
  TANA_EXEC_URL                 … 棚卸アプリの /exec 公開URL
  INPUT_LINKS_KEY               … links エンドポイントの認証キー（GAS のスクリプトプロパティと同値）
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tana_push import SPREADSHEET_ID, calc_fd, load_data, prev_ym, yen  # noqa: E402
from tana_line import send_line, short_name  # noqa: E402

JST = timezone(timedelta(hours=9))
DEST_SHEET = "店舗LINE宛先"   # [店舗(キー or 表示名), グループID]


def fetch_links(exec_url, key, ym):
    """GAS の links エンドポイントから {店舗キー: 入力URL} を得る。"""
    sep = "&" if "?" in exec_url else "?"
    url = f"{exec_url}{sep}links=1&k={urllib.parse.quote(key)}&ym={ym}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("ok"):
        raise RuntimeError(f"links取得エラー: {data.get('error')}")
    return {s["key"]: s["url"] for s in data.get("stores", [])}


def load_dests(svc):
    """「店舗LINE宛先」シートから [(店舗表記, グループID)] を読む。"""
    try:
        vals = svc.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range=f"'{DEST_SHEET}'!A:B",
            valueRenderOption="UNFORMATTED_VALUE"
        ).execute().get("values", [])
    except Exception as e:
        print(f"::error::{DEST_SHEET} シートを読めません（作成して 店舗/グループID を入れてください）: {e}")
        return []
    out = []
    for i, row in enumerate(vals):
        if i == 0 or len(row) < 2:
            continue
        who, gid = str(row[0]).strip(), str(row[1]).strip()
        if who and gid:
            out.append((who, gid))
    return out


def resolve_store(who, link_keys):
    """宛先シートの店舗表記(キー or 表示名)を、実際の店舗キーへ解決する。"""
    if who in link_keys:
        return who
    for k in link_keys:
        if short_name(k) == who or k.endswith("_" + who):
            return k
    return None


def build_msg(name, ym, r, url):
    y, mo = ym.split("-")
    lines = [f"【{name}】{y}年{int(mo)}月 棚卸"]
    if r is None:
        lines.append("まだ棚卸データがありません。")
    else:
        if r.get("theory"):
            pr = f"（原価率 {r['purchaseRate'] * 100:.1f}%）" if r.get("purchaseRate") is not None else ""
            lines.append(f"理論原価: {yen(r['theory'])}{pr}")
        if r.get("turnover") is not None:
            lines.append(f"棚卸回転: {r['turnover']:.1f}日")
        if r.get("unknown") is not None:
            ur = f"（売上比 {r['unknownRate'] * 100:.1f}%）" if r.get("unknownRate") is not None else ""
            lines.append(f"不明ロス: {yen(r['unknown'])}{ur}")
    lines.append("▼ロス・理論原価の入力/修正はこちら")
    lines.append(url)
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ym", default=None, help="対象月 YYYY-MM（未指定なら前月）")
    ap.add_argument("--dry-run", action="store_true", help="送らず内容だけ表示")
    args = ap.parse_args()

    now = datetime.now(JST)
    ym = args.ym or prev_ym(now.strftime("%Y-%m"))
    if len(ym) != 7 or ym[4] != "-":
        print(f"::error::--ym の形式が不正です: {ym}（YYYY-MM）")
        return 1

    exec_url = os.environ.get("TANA_EXEC_URL", "").strip()
    links_key = os.environ.get("INPUT_LINKS_KEY", "").strip()
    token = os.environ.get("LINE_CHANNEL_TOKEN", "").strip()
    if not exec_url or not links_key:
        # 未設定＝まだ準備中。定期実行を赤くしないようスキップ（0で正常終了）。
        print("未設定のためスキップ: TANA_EXEC_URL と INPUT_LINKS_KEY を設定してください（GitHub Secrets / GASスクリプトプロパティ）")
        return 0

    cred = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json")
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(
        cred, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    svc = build("sheets", "v4", credentials=creds)

    metrics, inventory, losses, store_flags, _stores = load_data(svc)
    links = fetch_links(exec_url, links_key, ym)
    dests = load_dests(svc)
    if not dests:
        print(f"送信先がありません（{DEST_SHEET} シートに 店舗/グループID を入れてください）")
        return 0

    sent = 0
    for who, gid in dests:
        key = resolve_store(who, list(links.keys()))
        if not key:
            print(f"::warning::店舗『{who}』が見つかりません（{DEST_SHEET}の表記を確認）。スキップ")
            continue
        r = calc_fd(metrics, inventory, losses, store_flags, ym, key)
        text = build_msg(short_name(key), ym, r, links[key])
        if send_line(token, gid, text, args.dry_run):
            sent += 1
    print(f"[tana_month] {ym}: 送信 {sent}/{len(dests)} 件（{'DRY' if args.dry_run else 'LIVE'}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
