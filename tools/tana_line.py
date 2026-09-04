"""
tools/tana_line.py
棚卸「未入力店」の LINE 報告スクリプト（GitHub Actions から実行）。

用途:
  毎月の最終取得日（5日=前月・月末棚の最終／20日=当月・中間棚の最終）に、
  まだ棚卸が入っていない店舗を LINE に自動報告する。

判定は tana_push.py（＝アプリ index.html の calcM）と同じデータ読み込みを再利用し、
「売上はあるのに棚卸金額が0（未入力/未取得）」の店舗を対象とする。

送信は LINE Messaging API（公式アカウント）。LINE Notify は 2025-03 で終了のため使わない。
無料プラン（月200通）で月2回の報告なら十分収まる。

実行例:
    python tools/tana_line.py --auto              # 実行日(5/20)から自動判定して送信
    python tools/tana_line.py --mode final        # 前月・月末棚の未入力を送信
    python tools/tana_line.py --mode interim      # 当月・中間棚の未入力を送信
    python tools/tana_line.py --mode final --dry-run   # 送らず内容だけ表示

必要な環境変数:
    GOOGLE_SERVICE_ACCOUNT_JSON  … サービスアカウントJSONのパス
    LINE_CHANNEL_TOKEN           … LINE Messaging API チャネルアクセストークン ※GitHub Secrets
    LINE_TO                      … 送信先ID（グループ/ユーザー/ルームID）。未設定なら公式アカウントの
                                   友だち全員へ broadcast。
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

# 同じ tools/ ディレクトリの tana_push.py を再利用（データ読み込みと未入力判定を共通化）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tana_push import load_data, inv_of, prev_ym  # noqa: E402

JST = timezone(timedelta(hours=9))
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"


def short_name(store_key):
    """FWキー '0001151_NagaGutsu' → 表示名 'NagaGutsu'。"""
    return store_key.split("_")[-1]


def compute_missing(metrics, inventory, ym):
    """対象月で「売上はあるのに棚卸金額が0（未入力）」の店舗名（表示名）一覧。"""
    names = []
    for store, cell in metrics.get(ym, {}).items():
        if (cell.get("sales") or 0) > 0 and inv_of(inventory, ym, store) is None:
            names.append(short_name(store))
    return sorted(names)


def build_text(names, ym, mode_label, due_md):
    """LINE本文を組み立てる。未入力があれば一覧、なければ完了報告。"""
    header = f"【棚卸 {mode_label}・最終日{due_md}】{ym}"
    if not names:
        return header + "\n✅ 全店の棚卸が入力済みです。"
    lines = [header, f"まだ入力されていない店舗が {len(names)} 店あります:"]
    lines += ["・" + n for n in names]
    lines.append("早めのご入力をお願いします。")
    return "\n".join(lines)


def send_line(token, to, text, dry_run):
    """LINE Messaging API で送信。to があれば push、無ければ broadcast。"""
    if dry_run:
        dest = ("push→" + to) if to else "broadcast"
        print(f"[dry-run] LINE({dest}):\n{text}\n")
        return True
    if not token:
        print("::error::LINE_CHANNEL_TOKEN 未設定のため送信できません（GitHub Secretsに登録してください）")
        return False
    payload = {"messages": [{"type": "text", "text": text}]}
    url = LINE_BROADCAST_URL
    if to:
        payload["to"] = to
        url = LINE_PUSH_URL
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"LINE送信 OK (HTTP {resp.status})")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")
        print(f"::error::LINE送信 失敗 (HTTP {e.code}): {body}")
        return False
    except Exception as e:
        print(f"::error::LINE送信 失敗: {e}")
        return False


def pick_mode(auto, mode_arg, now):
    """--mode 指定を優先。--auto は 5日→final / 20日→interim、それ以外は None。"""
    if mode_arg:
        return mode_arg
    if not auto:
        return None
    d = now.day
    if d == 5:
        return "final"
    if d == 20:
        return "interim"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--auto", action="store_true", help="実行日(5/20)から自動判定")
    ap.add_argument("--mode", choices=["final", "interim"], default=None,
                    help="final=前月・月末棚 / interim=当月・中間棚")
    ap.add_argument("--dry-run", action="store_true", help="送らず内容だけ表示")
    args = ap.parse_args()

    now = datetime.now(JST)
    mode = pick_mode(args.auto, args.mode, now)
    if not mode:
        print("送る対象がありません（--auto は 5日/20日のみ。--mode で明示指定も可）")
        return 0

    cred = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json")
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(
        cred, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    svc = build("sheets", "v4", credentials=creds)

    metrics, inventory, losses, store_flags, stores = load_data(svc)

    cur_ym = now.strftime("%Y-%m")
    if mode == "final":
        ym = prev_ym(cur_ym)          # 前月（月末棚・確定）
        mode_label = "月末棚 未入力"
        due_md = f"{now.month}/5"
    else:
        ym = cur_ym                    # 当月（中間棚）
        mode_label = "中間棚 未入力"
        due_md = f"{now.month}/20"

    names = compute_missing(metrics, inventory, ym)
    text = build_text(names, ym, mode_label, due_md)
    print(f"対象月 {ym} / 未入力 {len(names)} 店")

    token = os.environ.get("LINE_CHANNEL_TOKEN", "")
    to = os.environ.get("LINE_TO", "").strip()
    ok = send_line(token, to, text, args.dry_run)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
