"""
tools/sheet_report.py
棚卸集計スプレッドシートの内容サマリを表示する確認用スクリプト。
各シートの年月×種別ごとの行数と、指定月のサンプル行を出力する。

実行例:
    python tools/sheet_report.py            # 全シートのサマリ
    python tools/sheet_report.py 2026-06    # 指定月のサンプル行も表示
"""
import os
import sys
from collections import Counter

from google.oauth2 import service_account
from googleapiclient.discovery import build

SPREADSHEET_ID = "18Fq_mpEweHOFTlF4ntmwJzDsJNSt-DOq7wQYy8E0iLc"

# (シート名, 種別列の有無)  ※5指標シートはD列=種別(中間/確定)
SHEETS = [
    ("売上", True),
    ("F売上", True),
    ("D売上", True),
    ("F食材費仕入", True),
    ("D飲料費仕入", True),
    ("フード理論原価", True),
    ("ドリンク理論原価", True),
    ("フード予算原価", True),
    ("ドリンク予算原価", True),
    ("月次集計", False),
]


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else None

    credential_path = os.environ.get(
        "GOOGLE_SERVICE_ACCOUNT_JSON", "./credentials/service_account.json"
    )
    creds = service_account.Credentials.from_service_account_file(
        credential_path,
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    svc = build("sheets", "v4", credentials=creds)

    for name, has_kind in SHEETS:
        try:
            vals = svc.spreadsheets().values().get(
                spreadsheetId=SPREADSHEET_ID, range=f"'{name}'!A:F"
            ).execute().get("values", [])
        except Exception as e:
            print(f"[{name}] 読み取り失敗: {e}")
            continue

        counter: Counter = Counter()
        for row in vals:
            if not row or not str(row[0]).strip():
                continue
            kind = row[3] if has_kind and len(row) > 3 else ""
            counter[(str(row[0]), str(kind))] += 1

        print(f"\n===== [{name}] 全{len(vals)}行 =====")
        for (ym, kind), n in sorted(counter.items()):
            label = f"{ym} {kind}".strip()
            print(f"  {label}: {n}行")

        if target:
            samples = [r for r in vals if r and str(r[0]) == target][:5]
            if samples:
                print(f"  --- {target} のサンプル ---")
                for r in samples:
                    print(f"  {r}")
            else:
                print(f"  --- {target} の行はありません ---")

    return 0


if __name__ == "__main__":
    sys.exit(main())
