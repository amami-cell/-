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

// ─── 設定 ────────────────────────────────────────────────────────────────────

/** 更新対象のシート名（実際のシート名に合わせて変更） */
const INVENTORY_SHEET_NAME = '棚卸仕入れ項目';

/** データソースシート名 */
const SRC = {
  sales:         '売上',
  foodPurchase:  'F食材費仕入',
  drinkPurchase: 'D飲料費仕入',
  foodTheory:    'フード理論原価',
  drinkTheory:   'ドリンク理論原価',
};

/**
 * 当月・前月セクションの行番号
 * ※ 上書きしない行: 4（前月棚卸高）, 6（翌月棚卸高）, 15, 17（前月分）
 */
const ROWS = {
  current: { purchase: 5,  theory: 8  },  // 当月セクション
  prev:    { purchase: 16, theory: 19 },  // 前月セクション
};

/** セル列番号（FD合計=C:3, FD売上比=D:4, 食材F=E:5, F売上比=F:6, 飲料D=G:7, D売上比=H:8） */
const COLS = { fdTotal: 3, fdRatio: 4, foodVal: 5, foodRatio: 6, drinkVal: 7, drinkRatio: 8 };

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
 * コピーボタン付き HTML ダイアログで再取得コマンドを表示する
 */
function showUpdateCommand_() {
  const command =
    'cd C:\\Users\\Owner\\OneDrive\\デスクトップ\\infomart_automation && ' +
    'py main.py --foodist-only';

  const html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html>' +
    '<html><head><style>' +
    'body{font-family:"Google Sans",Arial,sans-serif;padding:20px;margin:0;color:#202124}' +
    'p{margin:0 0 12px;font-size:14px}' +
    '.row{display:flex;align-items:flex-start;gap:8px;background:#f1f3f4;border-radius:6px;padding:12px 14px}' +
    '#cmd{flex:1;font-family:"Roboto Mono",monospace;font-size:12px;color:#1a73e8;' +
    '     background:transparent;border:none;outline:none;resize:none;cursor:text;line-height:1.5}' +
    '#copyBtn{flex-shrink:0;padding:6px 16px;background:#1a73e8;color:#fff;border:none;' +
    '         border-radius:4px;font-size:13px;cursor:pointer;white-space:nowrap}' +
    '#copyBtn:hover{background:#1557b0}' +
    '#msg{margin-top:8px;font-size:12px;color:#188038;min-height:16px}' +
    '</style></head><body>' +
    '<p>以下のコマンドをターミナルで実行してください:</p>' +
    '<div class="row">' +
    '  <textarea id="cmd" rows="2" readonly>' + command + '</textarea>' +
    '  <button id="copyBtn" onclick="copyCmd()">📋 コピー</button>' +
    '</div>' +
    '<div id="msg"></div>' +
    '<script>' +
    'function copyCmd(){' +
    '  var el=document.getElementById("cmd");' +
    '  el.select();' +
    '  try{' +
    '    document.execCommand("copy");' +
    '    document.getElementById("msg").textContent="✅ コピーしました";' +
    '  }catch(e){' +
    '    document.getElementById("msg").textContent="❌ コピーに失敗しました（手動でコピーしてください）";' +
    '  }' +
    '}' +
    '<\/script>' +
    '</body></html>'
  ).setWidth(560).setHeight(160);

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

  // 書き込み
  writeSection_(sheet, curData,  ROWS.current.purchase, ROWS.current.theory);
  writeSection_(sheet, prevData, ROWS.prev.purchase,    ROWS.prev.theory);

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
  const result = {
    sales: 0, foodPurchase: 0, drinkPurchase: 0, foodTheory: 0, drinkTheory: 0
  };

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

    for (let r = 0; r < data.length; r++) {
      const rowMonth = toYYYYMM_(data[r][0]);
      const rowStore = String(data[r][1]).trim();
      if (rowMonth !== monthStr || rowStore !== storeName) continue;

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
 * @param {{ sales, foodPurchase, drinkPurchase, foodTheory, drinkTheory }} data
 * @param {number} purchaseRow  仕入金額の行番号
 * @param {number} theoryRow    理論原価の行番号
 */
function writeSection_(sheet, data, purchaseRow, theoryRow) {
  const sales = data.sales;

  // ── 仕入金額行 ──────────────────────────
  const fdP = data.foodPurchase + data.drinkPurchase;
  sheet.getRange(purchaseRow, COLS.fdTotal  ).setValue(fdP);
  sheet.getRange(purchaseRow, COLS.foodVal  ).setValue(data.foodPurchase);
  sheet.getRange(purchaseRow, COLS.drinkVal ).setValue(data.drinkPurchase);
  setRatio_(sheet, purchaseRow, COLS.fdRatio,    fdP,               sales);
  setRatio_(sheet, purchaseRow, COLS.foodRatio,  data.foodPurchase, sales);
  setRatio_(sheet, purchaseRow, COLS.drinkRatio, data.drinkPurchase, sales);

  // ── 理論原価行 ──────────────────────────
  const fdT = data.foodTheory + data.drinkTheory;
  sheet.getRange(theoryRow, COLS.fdTotal  ).setValue(fdT);
  sheet.getRange(theoryRow, COLS.foodVal  ).setValue(data.foodTheory);
  sheet.getRange(theoryRow, COLS.drinkVal ).setValue(data.drinkTheory);
  setRatio_(sheet, theoryRow, COLS.fdRatio,    fdT,              sales);
  setRatio_(sheet, theoryRow, COLS.foodRatio,  data.foodTheory,  sales);
  setRatio_(sheet, theoryRow, COLS.drinkRatio, data.drinkTheory, sales);
}

/**
 * 売上比を計算してセルに書き込む。売上が 0 の場合は空文字。
 */
function setRatio_(sheet, row, col, numerator, denominator) {
  sheet.getRange(row, col).setValue(denominator > 0 ? numerator / denominator : '');
}

// ─── ユーティリティ ────────────────────────────────────────────────────────────

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
