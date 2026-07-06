"""
tools/excel_scan.py
FW店長会資料Excelのセル構造を調査してログに出力する（フード売上/ドリンク売上の位置特定用）。
downloads/ 内の最新のxlsxの最初のシートを対象に:
 1. 「売上」を含むラベルセルと、その右側の数値セルを表示
 2. 行1〜30の非空セルを一覧表示
"""
import glob
import os
import sys

import openpyxl


def main() -> int:
    files = sorted(glob.glob('downloads/*.xlsx'), key=os.path.getmtime)
    if not files:
        print('xlsxが見つかりません')
        return 0
    path = files[-1]
    print(f'=== スキャン対象: {path} ===')
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    print(f'シート: {wb.sheetnames[0]} (全{len(wb.sheetnames)}シート) 範囲: {ws.max_row}行 x {ws.max_column}列')

    print('--- 行44〜95の非空セル（売上内訳セクションの全列）---')
    for row in ws.iter_rows(min_row=44, max_row=95):
        cells = []
        for cell in row:
            v = cell.value
            if v is None or (isinstance(v, str) and not v.strip()):
                continue
            if isinstance(v, (int, float)):
                cells.append(f'c{cell.column}={v:,.0f}')
            else:
                cells.append(f'c{cell.column}="{str(v).strip()[:16]}"')
        if cells:
            print(f'  r{row[0].row}: ' + ' | '.join(cells))
    return 0


if __name__ == '__main__':
    sys.exit(main())
