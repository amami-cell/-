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

    print('--- 「売上」を含むセルと右隣の数値 ---')
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 200)):
        for cell in row:
            v = cell.value
            if isinstance(v, str) and '売上' in v:
                rights = []
                for c in range(cell.column + 1, min(cell.column + 12, ws.max_column + 1)):
                    rv = ws.cell(row=cell.row, column=c).value
                    if isinstance(rv, (int, float)):
                        rights.append(f'col{c}={rv:,.0f}')
                print(f'  r{cell.row} c{cell.column} "{v.strip()[:20]}" -> {" ".join(rights[:4])}')

    print('--- 行1〜30の非空セル ---')
    for row in ws.iter_rows(min_row=1, max_row=30):
        for cell in row:
            v = cell.value
            if v is None or (isinstance(v, str) and not v.strip()):
                continue
            if isinstance(v, (int, float)):
                print(f'  r{cell.row} c{cell.column} = {v:,.0f}')
            else:
                print(f'  r{cell.row} c{cell.column} = "{str(v).strip()[:24]}"')
    return 0


if __name__ == '__main__':
    sys.exit(main())
