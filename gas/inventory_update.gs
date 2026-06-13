/**
 * inventory_update.gs
 * 棚卸仕入れ項目シートの自動更新スクリプト
 *
 * 【設置方法】
 * 1. 対象スプレッドシートを開く
 * 2. 拡張機能 > Apps Script を開く
 * 3. このコードを貼り付けて保存
 * 4. C1（店舗名）または F1（対象月）を変更すると自動実行される
 *
 * 【動作概要】
 * - C1/F1 変更 → onEdit 発火
 * - 売上・F食材費仕入・D飲料費仕入・フード理論原価・ドリンク理論原価
 *   の各シートから当月・前月データを取得
 * - 棚卸仕入れ項目シートの指定セルへ書き込み
 * - 行4・行6（インフォマート取得済み棚卸金額）は上書きしない
 */

// ─── メニュー ──────────────────────────────────────────────────────────────────

/**
 * スプレッドシートを開いたときにカスタムメニューを追加する
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 FWシート 再取得')
    .addItem('コマンドを表示', 'showUpdateCommand_')
    .addToUi();
}

/**
 * 3コマンド対応のコピーボタン付き HTML ダイアログを表示する
 *
 * ① 当月取得         : py main.py --foodist-only
 * ② 月指定取得       : py main.py --foodist-only --month YYYY-MM
 * ③ 全月一括取得     : py main.py --foodist-all   --from  YYYY-MM
 */
function showUpdateCommand_() {
  const BASE = 'cd C:\\\\Users\\\\Owner\\\\OneDrive\\\\デスクトップ\\\\infomart_automation && ';

  const htmlBody = `<!DOCTYPE html>
<html>
<head>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"Google Sans",Arial,sans-serif;padding:18px 20px;color:#202124;font-size:13px}
  h3{font-size:14px;font-weight:600;margin-bottom:14px}
  .section{margin-bottom:14px}
  .label{font-weight:500;margin-bottom:6px;color:#444}
  .row{display:flex;align-items:center;gap:6px;background:#f1f3f4;border-radius:6px;padding:8px 10px}
  .cmd{flex:1;font-family:"Roboto Mono",monospace;font-size:11px;color:#1a73e8;
       background:transparent;border:none;outline:none;resize:none;cursor:text;line-height:1.4}
  input[type=text]{font-family:"Roboto Mono",monospace;font-size:12px;border:1px solid #ccc;
                   border-radius:4px;padding:4px 7px;width:100px;outline:none}
  input[type=text]:focus{border-color:#1a73e8}
  .copy-btn{flex-shrink:0;padding:5px 12px;background:#1a73e8;color:#fff;border:none;
            border-radius:4px;font-size:12px;cursor:pointer;white-space:nowrap}
  .copy-btn:hover{background:#1557b0}
  .msg{font-size:11px;color:#188038;min-height:14px;margin-top:4px;padding-left:2px}
</style>
</head>
<body>
<h3>📊 FWシート 再取得 — コマンド一覧</h3>

<!-- ① 当月取得 -->
<div class="section">
  <div class="label">① 当月取得</div>
  <div class="row">
    <textarea class="cmd" id="cmd1" rows="1" readonly>${BASE}py main.py --foodist-only</textarea>
    <button class="copy-btn" onclick="copy('cmd1','msg1')">📋 コピー</button>
  </div>
  <div class="msg" id="msg1"></div>
</div>

<!-- ② 月指定取得 -->
<div class="section">
  <div class="label">② 月指定取得</div>
  <div class="row">
    <textarea class="cmd" id="cmd2" rows="1" readonly>${BASE}py main.py --foodist-only --month 2026-01</textarea>
    <input type="text" id="month2" value="2026-01" placeholder="YYYY-MM" oninput="update2()">
    <button class="copy-btn" onclick="copy('cmd2','msg2')">📋 コピー</button>
  </div>
  <div class="msg" id="msg2"></div>
</div>

<!-- ③ 全月一括取得 -->
<div class="section">
  <div class="label">③ 全月一括取得（開始月〜当月）</div>
  <div class="row">
    <textarea class="cmd" id="cmd3" rows="1" readonly>${BASE}py main.py --foodist-all --from 2026-01</textarea>
    <input type="text" id="month3" value="2026-01" placeholder="YYYY-MM" oninput="update3()">
    <button class="copy-btn" onclick="copy('cmd3','msg3')">📋 コピー</button>
  </div>
  <div class="msg" id="msg3"></div>
</div>

<script>
  var BASE = "${BASE}";

  function update2(){
    var m = document.getElementById('month2').value.trim() || 'YYYY-MM';
    document.getElementById('cmd2').value = BASE + 'py main.py --foodist-only --month ' + m;
  }
  function update3(){
    var m = document.getElementById('month3').value.trim() || 'YYYY-MM';
    document.getElementById('cmd3').value = BASE + 'py main.py --foodist-all --from ' + m;
  }
  function copy(cmdId, msgId){
    var el = document.getElementById(cmdId);
    el.select();
    var ok = false;
    try{ ok = document.execCommand('copy'); }catch(e){}
    document.getElementById(msgId).textContent = ok ? '✅ コピーしました！' : '❌ コピー失敗（手動でコピーしてください）';
    setTimeout(function(){ document.getElementById(msgId).textContent=''; }, 3000);
  }
<\/script>
</body>
</html>`;

  const html = HtmlService.createHtmlOutput(htmlBody)
    .setWidth(620)
    .setHeight(310);

  SpreadsheetApp.getUi().showModalDialog(html, '📊 FWシート 再取得');
}

// ─── トリガー ──────────────────────────────────────────────────────────────────

/**
 * C1（店舗名）または F1（対象月）が変更されたとき自動実行
 */
function onEdit(e) {
  if (!e) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== INVENTORY_SHEET_NAME) return;
  if (e.range.getRow() !== 1) return;
  const col = e.range.getColumn();
  if (col !== 3 && col !== 6) return;  // C1 or F1 のみ

  updateInventorySheet_(sheet);
}

// ─── メイン処理 ────────────────────────────────────────────────────────────────

/**
 * 棚卸仕入れ項目シートを更新する（手動実行・onEdit 共通）
 * @param {GoogleAppsScript.Spreadsheet.Sheet} [targetSheet]
 */
function updateInventorySheet_(targetSheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = targetSheet || ss.getSheetByName(INVENTORY_SHEET_NAME);
  if (!sheet) {
    Logger.log('シート「' + INVENTORY_SHEET_NAME + '」が見つかりません');
    return;
  }

  // C1: 店舗名 / F1: 対象月
  const storeName = String(sheet.getRange('C1').getValue()).trim();
  const monthStr  = toYYYYMM_(sheet.getRange('F1').getValue());

  if (!storeName || !monthStr) {
    Logger.log('店舗名または対象月が未設定です (C1=' + storeName + ', F1=' + monthStr + ')');
    return;
  }

  const prevMonthStr = prevMonth_(monthStr);
  Logger.log('更新開始: 店舗=' + storeName + ' 当月=' + monthStr + ' 前月=' + prevMonthStr);

  // 当月・前月のデータ取得
  const curData  = fetchMetrics_(ss, storeName, monthStr);
  const prevData = fetchMetrics_(ss, storeName, prevMonthStr);

  Logger.log('当月: ' + JSON.stringify(curData));
  Logger.log('前月: ' + JSON.stringify(prevData));

  // 売上ラベル（I1: 当月, I13: 前月）
  sheet.getRange('I1').setValue('売上：¥' + formatYen_(curData.sales));
  sheet.getRange('I13').setValue('売上：¥' + formatYen_(prevData.sales));

  // FWデータ（仕入行・理論原価行）書き込み
  Logger.log('当月売上: ' + curData.sales + ' / 前月売上: ' + prevData.sales);
  writeSection_(sheet, curData,  curData.sales,  ROWS.current.purchase, ROWS.current.theory);
  writeSection_(sheet, prevData, prevData.sales, ROWS.prev.purchase,    ROWS.prev.theory);

  // FW書き込みをコミットしてから全行の売上比を書き込む（Infomart取得値の行を含む）
  SpreadsheetApp.flush();
  writeRatiosForRows_(sheet, curData.sales,  4, 11);
  writeRatiosForRows_(sheet, prevData.sales, 15, 22);

  SpreadsheetApp.flush();
  Logger.log('更新完了');
}

// ─── データ取得 ────────────────────────────────────────────────────────────────

/**
 * 5つのソースシートから指定店舗・月の金額を取得する。
 * 同じ店舗・月に「確定」と「中間」が混在する場合は「確定」を優先。
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} storeName  店舗名（B列の値と一致させる）
 * @param {string} monthStr   "YYYY-MM"
 * @returns {{ sales, foodPurchase, drinkPurchase, foodTheory, drinkTheory }}
 */
function fetchMetrics_(ss, storeName, monthStr) {
  // インフォマート店舗名 → Foodist Journal 店舗名に変換（対応表にあれば）
  const fjStoreName = STORE_MAP[storeName] || storeName;
  if (fjStoreName !== storeName) {
    Logger.log('店舗名変換: "' + storeName + '" → "' + fjStoreName + '"');
  } else {
    Logger.log('店舗名変換なし（対応表に未登録）: "' + storeName + '"');
  }

  const result = {
    sales: 0, foodPurchase: 0, drinkPurchase: 0, foodTheory: 0, drinkTheory: 0
  };

  const range = toDateRange_(monthStr);
  const keys = Object.keys(SRC);
  for (let i = 0; i < keys.length; i++) {
    const key       = keys[i];
    const sheetName = SRC[key];
    const src       = ss.getSheetByName(sheetName);
    if (!src) {
      Logger.log('シート「' + sheetName + '」が見つかりません');
      continue;
    }

    const lastRow = src.getLastRow();
    if (lastRow < 1) continue;

    // A:月 B:店舗名 C:金額 D:種別
    const data = src.getRange(1, 1, lastRow, 4).getValues();

    let amount     = 0;
    let hasKakutei = false;

    // 比較用に全角・半角スペースを統一して正規化する
    const normalize_ = function(s) { return s.replace(/[\s　]+/g, ' ').trim(); };
    const targetStore = normalize_(fjStoreName);

    for (let r = 0; r < data.length; r++) {
      if (!dateInRange_(data[r][0], range.start, range.end)) continue;
      const rowStore = normalize_(String(data[r][1]));
      if (rowStore !== targetStore) continue;

      const kind = String(data[r][3]).trim();
      const val  = Number(data[r][2]) || 0;

      if (kind === '確定') {
        amount     = val;
        hasKakutei = true;
        break;  // 確定が見つかったらループ終了
      }
      if (kind === '中間' && !hasKakutei) {
        amount = val;
      }
    }

    result[key] = amount;
  }

  return result;
}

// ─── 書き込み ──────────────────────────────────────────────────────────────────

/**
 * 仕入金額行・理論原価行に値を書き込む。
 * 書き込み先: C=FD合計, D=FD売上比, E=食材F, F=F売上比, G=飲料D, H=D売上比
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {{ foodPurchase, drinkPurchase, foodTheory, drinkTheory }} data
 * @param {number} sales       売上金額（当月/前月それぞれを呼び出し側で明示して渡す）
 * @param {number} purchaseRow 仕入金額の行番号
 * @param {number} theoryRow   理論原価の行番号
 */
function writeSection_(sheet, data, sales, purchaseRow, theoryRow) {
  Logger.log(
    'writeSection_: 仕入行=' + purchaseRow + ' 理論行=' + theoryRow +
    ' 売上=' + sales
  );

  // ── 仕入金額行 ──────────────────────────
  const fdP = data.foodPurchase + data.drinkPurchase;
  sheet.getRange(purchaseRow, COLS.fdTotal  ).setValue(fdP);
  sheet.getRange(purchaseRow, COLS.foodVal  ).setValue(data.foodPurchase);
  sheet.getRange(purchaseRow, COLS.drinkVal ).setValue(data.drinkPurchase);
  setRatio_(sheet, purchaseRow, COLS.fdRatio,    fdP,                sales);
  setRatio_(sheet, purchaseRow, COLS.foodRatio,  data.foodPurchase,  sales);
  setRatio_(sheet, purchaseRow, COLS.drinkRatio, data.drinkPurchase, sales);

  // ── 理論原価行 ──────────────────────────
  const fdT = data.foodTheory + data.drinkTheory;
  sheet.getRange(theoryRow, COLS.fdTotal  ).setValue(fdT);
  sheet.getRange(theoryRow, COLS.foodVal  ).setValue(data.foodTheory);
  sheet.getRange(theoryRow, COLS.drinkVal ).setValue(data.drinkTheory);
  setRatio_(sheet, theoryRow, COLS.fdRatio,    fdT,             sales);
  setRatio_(sheet, theoryRow, COLS.foodRatio,  data.foodTheory, sales);
  setRatio_(sheet, theoryRow, COLS.drinkRatio, data.drinkTheory, sales);
}

/**
 * 売上比を計算して％形式（小数点2桁）でセルに書き込む。売上が 0 の場合は空文字。
 * 負値の売上（一部会計システム）にも対応するため !== 0 で判定する。
 */
function setRatio_(sheet, row, col, numerator, denominator) {
  const cell = sheet.getRange(row, col);
  if (denominator === 0) {
    cell.setValue('');
    return;
  }
  cell.setNumberFormat('0.00%');
  cell.setValue(numerator / denominator);
}

/**
 * startRow〜endRow の C/E/G列の値を読み取り D/F/H列に売上比（0.00%）を書き込む。
 * Infomart 取得済み値を含むすべての行をカバーする。
 * C列(3)〜G列(7) の 5列を一括取得し、[0]=C, [2]=E, [4]=G を使う。
 */
function writeRatiosForRows_(sheet, sales, startRow, endRow) {
  const numRows = endRow - startRow + 1;
  const vals = sheet.getRange(startRow, COLS.fdTotal, numRows, 5).getValues();
  for (let i = 0; i < numRows; i++) {
    const row      = startRow + i;
    const fdVal    = Number(vals[i][0]) || 0;  // C列 = FD合計
    const foodVal  = Number(vals[i][2]) || 0;  // E列 = 食材F
    const drinkVal = Number(vals[i][4]) || 0;  // G列 = 飲料D
    setRatio_(sheet, row, COLS.fdRatio,    fdVal,    sales);
    setRatio_(sheet, row, COLS.foodRatio,  foodVal,  sales);
    setRatio_(sheet, row, COLS.drinkRatio, drinkVal, sales);
  }
}

/**
 * 金額を "1,234,567" 形式の文字列にフォーマットする。
 */
function formatYen_(amount) {
  return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─── ユーティリティ ────────────────────────────────────────────────────────────

/**
 * "YYYY-MM" から当月の開始日・終了日（Date）を返す。
 */
function toDateRange_(monthStr) {
  const parts = monthStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return {
    start: new Date(y, m - 1, 1),
    end:   new Date(y, m, 0, 23, 59, 59, 999),
  };
}

/**
 * セル値（Date または "YYYY-MM"/"YYYY-MM-DD" 文字列）が [start, end] 内かを判定する。
 * "YYYY-MM" 文字列は月初（1日）として扱う。
 */
function dateInRange_(value, start, end) {
  let d;
  if (value instanceof Date) {
    d = value;
  } else {
    const s = String(value).trim();
    if (!s) return false;
    if (/^\d{4}-\d{2}$/.test(s)) {
      const p = s.split('-');
      d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1);
    } else {
      d = new Date(s);
    }
  }
  if (!d || isNaN(d.getTime())) return false;
  return d >= start && d <= end;
}

/**
 * Date オブジェクトまたは文字列を "YYYY-MM" に変換する。
 * スプレッドシートの日付セルは Date として返ることがある。
 */
function toYYYYMM_(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }
  return String(value).trim().slice(0, 7);  // "YYYY-MM..."の先頭7文字
}

/**
 * "YYYY-MM" の前月を返す。
 * 例: "2026-05" → "2026-04", "2026-01" → "2025-12"
 */
function prevMonth_(monthStr) {
  const parts = monthStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const prev = new Date(y, m - 2, 1);  // month は 0 始まりなので m-2 = 前月
  return prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
}

// ─── 手動実行用 ────────────────────────────────────────────────────────────────

/**
 * Apps Script エディタから直接実行してテスト・手動更新に使う。
 */
function manualUpdate() {
  updateInventorySheet_();
}
