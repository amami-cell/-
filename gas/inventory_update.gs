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

/**
 * インフォマート店舗名（C1）→ Foodist Journal 店舗名（各シートB列）の対応表
 * C1 の値をキーにして、シート上の B列値を引く。
 */
const STORE_MAP = {
  'すさび湯　歌舞伎町（ＨＡＳＳＩＮ）':             '0001015_すさび湯 歌舞伎町',
  'Ｉｔａｌｉａｎ　Ｂａｒ　ＮａｇａＧｕｔｓｕ（ＨＡＳＳＩＮ）': '0001151_NagaGutsu',
  'パフェ＆ジェラート　ＬＡＲＧＯ　ルクア店（ＨＡＳＳＩＮ）': '0001160_ルクアLargo',
  'フレンチ酒場ＧＯＬＤ（ＨＡＳＳＩＮ）':           '0001163_フレンチ酒場GOLD',
  'フレンチ酒場ＧＯＬＤ　京都ポルタ店（ＨＡＳＳＩＮ）': '0001168_GOLD京都ポルタ店',
  'すさび湯　三宮店（ＨＡＳＳＩＮ）':               '0001169_すさび湯三宮店',
  'すさび湯　京都烏丸（ＨＡＳＳＩＮ）':             '0001712_すさび湯京都烏丸',
  '喫茶Ｌａｒｇｏ　門真（ＨＡＳＳＩＮ）':           '0001713_門真Largo',
  'すさび湯パナンテ京阪天満橋店（ＨＡＳＳＩＮ）':   '0001728_すさび湯 天満橋店',
  'フレンチ酒場ＧＯＬＤ　お初天神店（ＨＡＳＳＩＮ）': '0001729_フレンチ酒場GOLDお初',
  'ぎふやパナンテ天満橋（ＨＡＳＳＩＮ）':           '0001739_ぎふや 天満橋店',
  'すさび湯　三条店（ＨＡＳＳＩＮ）':               '0001742_すさび湯 京都三条店',
  'すさび湯　新宿東口店（ＨＡＳＳＩＮ）':           '0001743_すさび湯 新宿東口店',
  '熊の鳥焼（ＨＡＳＳＩＮ）':                       '0001154_熊の鳥焼',
  'ちゃーちゃん（ＨＡＳＳＩＮ）':                   '0001111_ちゃーちゃん',
  '料理と酒　たいだい（旧　にと）（ＨＡＳＳＩＮ）': '0001137_料理と酒 たいだい',
  '曲ル角ニハ泡喰ライ（ＨＡＳＳＩＮ）':             '0001115_大衆酒場 曲ル角ニハ泡喰ライ',
  'ひよこ飯店（ＨＡＳＳＩＮ）':                     '0001069_ひよこ飯店',
  'んだんだ新宿三丁目店（ＨＡＳＳＩＮ）':           '0002004_んだんだ',
  'すさび湯（ＨＡＳＳＩＮ）':                       '0001006_大衆寿司酒場すさび湯',
  'ＵＭＡＭＩ（ＨＡＳＳＩＮ）':                     '0001131_CRAFTMAN UMAMI',
  'ＡＲＡＴＡ（ＨＡＳＳＩＮ）':                     '0001097_ARATA',
  '味のたぬきや（ＨＡＳＳＩＮ）':                   '0001162_味のたぬきや',
};

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
      if (rowMonth !== monthStr || rowStore !== fjStoreName) continue;

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
