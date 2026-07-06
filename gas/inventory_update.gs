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
 * - C1/F1 変更 → onEdit 発火 → 全体更新
 * - ロス入力欄（L/M/N列・行9-11/行20-22）変更
 *     → 分類1（必要ロス/廃棄ロス）× 分類2（フード/ドリンク）で集計
 *     → 必要ロス行(9/20)の E/G/C 列・廃棄ロス行(10/21)の E/G/C 列に振り分け
 *     → 売上比・不明ロスも自動再計算
 * - O列（詳細メモ）変更 → 記録のみ（計算不要・上書きなし）
 * - I1: 当月売上ラベル / I12: 前月売上ラベル
 * - 行4・行6（インフォマート取得済み棚卸金額）は上書きしない
 */

// ─── 設定・定数 ──────────────────────────────────────────────────────────────────

/** 更新対象のシート名 */
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
  current: { purchase: 5,  theory: 8  },
  prev:    { purchase: 16, theory: 19 },
};

/** 棚卸仕入れ項目シートの列番号 */
const COLS = { fdTotal: 3, fdRatio: 4, foodVal: 5, foodRatio: 6, drinkVal: 7, drinkRatio: 8 };

/** ロス入力欄の列番号（L=分類1, M=分類2, N=金額, O=詳細メモ） */
const LOSS_COLS = { cat1: 12, cat2: 13, amount: 14, memo: 15 };

/** 当月・前月ロス入力行（L〜O 列、A〜H 列の棚卸表とは独立） */
const LOSS_ROWS_CUR  = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const LOSS_ROWS_PREV = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

/** 分類1 → 集計ターゲット行（当月） */
const LOSS_TARGET_CUR  = { '必要ロス': 9,  '廃棄ロス': 10 };
/** 分類1 → 集計ターゲット行（前月） */
const LOSS_TARGET_PREV = { '必要ロス': 20, '廃棄ロス': 21 };

/** インフォマート店舗名 → Foodist Journal シート店舗名 対応表 */
const STORE_MAP = {
  'すさび湯　歌舞伎町（ＨＡＳＳＩＮ）':                         '0001015_すさび湯 歌舞伎町',
  'Ｉｔａｌｉａｎ　Ｂａｒ　ＮａｇａＧｕｔｓｕ（ＨＡＳＳＩＮ）': '0001151_NagaGutsu',
  'パフェ＆ジェラート　ＬＡＲＧＯ　ルクア店（ＨＡＳＳＩＮ）':   '0001160_ルクアLargo',
  'フレンチ酒場ＧＯＬＤ（ＨＡＳＳＩＮ）':                       '0001163_フレンチ酒場GOLD',
  'フレンチ酒場ＧＯＬＤ　京都ポルタ店（ＨＡＳＳＩＮ）':         '0001168_GOLD京都ポルタ店',
  'すさび湯　三宮店（ＨＡＳＳＩＮ）':                           '0001169_すさび湯三宮店',
  'すさび湯　京都烏丸（ＨＡＳＳＩＮ）':                         '0001712_すさび湯京都烏丸',
  '喫茶Ｌａｒｇｏ　門真（ＨＡＳＳＩＮ）':                       '0001713_門真Largo',
  'すさび湯パナンテ京阪天満橋店（ＨＡＳＳＩＮ）':               '0001728_すさび湯 天満橋店',
  'フレンチ酒場ＧＯＬＤ　お初天神店（ＨＡＳＳＩＮ）':           '0001729_フレンチ酒場GOLDお初',
  'ぎふやパナンテ天満橋（ＨＡＳＳＩＮ）':                       '0001739_ぎふや 天満橋店',
  'すさび湯　三条店（ＨＡＳＳＩＮ）':                           '0001742_すさび湯 京都三条店',
  'すさび湯　新宿東口店（ＨＡＳＳＩＮ）':                       '0001743_すさび湯 新宿東口店',
  '熊の鳥焼（ＨＡＳＳＩＮ）':                                   '0001154_熊の鳥焼',
  'ちゃーちゃん（ＨＡＳＳＩＮ）':                               '0001111_ちゃーちゃん',
  '料理と酒　たいだい（旧　にと）（ＨＡＳＳＩＮ）':             '0001137_料理と酒 たいだい',
  '曲ル角ニハ泡喰ライ（ＨＡＳＳＩＮ）':                         '0001115_大衆酒場 曲ル角ニハ泡喰ライ',
  'ひよこ飯店（ＨＡＳＳＩＮ）':                                 '0001069_ひよこ飯店',
  'んだんだ新宿三丁目店（ＨＡＳＳＩＮ）':                       '0002004_んだんだ',
  'すさび湯（ＨＡＳＳＩＮ）':                                   '0001006_大衆寿司酒場すさび湯',
  'ＵＭＡＭＩ（ＨＡＳＳＩＮ）':                                 '0001131_CRAFTMAN UMAMI',
  'ＡＲＡＴＡ（ＨＡＳＳＩＮ）':                                 '0001097_ARATA',
  '味のたぬきや（ＨＡＳＳＩＮ）':                               '0001162_味のたぬきや',
};

// ─── メニュー ──────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 棚卸管理')
    .addItem('☁️ FW再取得（クラウド実行）', 'runCloudFetchFW')
    .addItem('☁️ インフォマート再取得（クラウド実行）', 'runCloudFetchInfomart')
    .addSeparator()
    .addItem('⚙️ クラウド実行の初期設定', 'setupCloudFetchToken')
    .addItem('管理ツールを開く', 'showLaunchCommand_')
    .addToUi();
}

// ─── ダイアログ: 管理ツール起動コマンド ────────────────────────────────────────

function showLaunchCommand_() {
  const cmd = 'cd C:\\\\Users\\\\Owner\\\\OneDrive\\\\デスクトップ\\\\infomart_automation && py rerun_gui.py';

  const html = HtmlService.createHtmlOutput(`<!DOCTYPE html>
<html>
<head>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"Google Sans",Arial,sans-serif;padding:20px 22px;color:#202124;font-size:13px}
  h3{font-size:15px;font-weight:600;margin-bottom:10px}
  p{color:#555;font-size:12px;line-height:1.7;margin-bottom:12px}
  .row{display:flex;align-items:center;gap:8px;background:#f1f3f4;border-radius:6px;padding:10px 12px}
  .cmd{flex:1;font-family:"Roboto Mono",monospace;font-size:12px;color:#1a73e8;
       background:transparent;border:none;outline:none;cursor:pointer;white-space:nowrap;overflow:hidden}
  .copy-btn{flex-shrink:0;padding:6px 14px;background:#1a73e8;color:#fff;border:none;
            border-radius:4px;font-size:12px;cursor:pointer;white-space:nowrap}
  .copy-btn:hover{background:#1557b0}
  .msg{font-size:11px;color:#188038;min-height:16px;margin-top:6px}
</style>
</head>
<body>
<h3>🛠 棚卸 管理ツール</h3>
<p>以下のコマンドをコピーしてターミナルで実行してください。<br>
棚卸取得・FW取得・店舗管理・取引先管理を GUI で操作できます。</p>
<div class="row">
  <input class="cmd" id="cmd" readonly onclick="this.select()">
  <button class="copy-btn" onclick="copyCmd()">📋 コピー</button>
</div>
<div class="msg" id="msg"></div>
<script>
  document.getElementById('cmd').value = "${cmd}";
  function copyCmd(){
    var el = document.getElementById('cmd');
    el.select();
    var ok = false;
    try{ ok = document.execCommand('copy'); }catch(e){}
    document.getElementById('msg').textContent = ok ? '✅ コピーしました！' : '❌ 手動でコピーしてください';
    setTimeout(function(){ document.getElementById('msg').textContent=''; }, 3000);
  }
<\/script>
</body>
</html>`)
    .setWidth(560)
    .setHeight(185);

  SpreadsheetApp.getUi().showModalDialog(html, '🛠 棚卸 管理ツール');
}

// ─── トリガー ──────────────────────────────────────────────────────────────────

/**
 * C1/F1 変更 → 全体更新
 * L/M/N列（分類1/分類2/金額）・ロス入力行 → 分類別集計＋比率再計算
 * O列（詳細メモ）・ロス入力行 → 記録のみ
 */
function onEdit(e) {
  if (!e) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== INVENTORY_SHEET_NAME) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();

  const allLossRows = LOSS_ROWS_CUR.concat(LOSS_ROWS_PREV);

  // L/M/N列（分類1/分類2/金額）: ロス集計トリガー
  if ((col === LOSS_COLS.cat1 || col === LOSS_COLS.cat2 || col === LOSS_COLS.amount)
      && allLossRows.indexOf(row) >= 0) {
    aggregateLossInput_(sheet, LOSS_ROWS_CUR.indexOf(row) >= 0);
    return;
  }

  // O列（詳細メモ）: 記録のみ（計算不要）
  if (col === LOSS_COLS.memo && allLossRows.indexOf(row) >= 0) {
    return;
  }

  // C1（3列）または F1（6列）が変更されたとき
  if (row !== 1) return;
  if (col !== 3 && col !== 6) return;

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

  const storeName = String(sheet.getRange('C1').getValue()).trim();
  const monthStr  = toYYYYMM_(sheet.getRange('F1').getValue());

  if (!storeName || !monthStr) {
    Logger.log('店舗名または対象月が未設定です (C1=' + storeName + ', F1=' + monthStr + ')');
    return;
  }

  const prevMonthStr = prevMonth_(monthStr);
  Logger.log('更新開始: 店舗=' + storeName + ' 当月=' + monthStr + ' 前月=' + prevMonthStr);

  const curData  = fetchMetrics_(ss, storeName, monthStr);
  const prevData = fetchMetrics_(ss, storeName, prevMonthStr);

  Logger.log('当月: ' + JSON.stringify(curData));
  Logger.log('前月: ' + JSON.stringify(prevData));
  Logger.log('当月売上: ' + curData.sales + ' / 前月売上: ' + prevData.sales);

  // ── Step1: FWデータ（仕入行・理論原価行）書き込み ─────────────────────
  writeSection_(sheet, curData,  curData.sales,  ROWS.current.purchase, ROWS.current.theory);
  writeSection_(sheet, prevData, prevData.sales, ROWS.prev.purchase,    ROWS.prev.theory);

  // ── Step2: 全行の売上比を書き込む ───────────────────────────────────
  SpreadsheetApp.flush();
  Logger.log('writeRatiosForRows_ 開始 (当月: rows 4-11, 売上=' + curData.sales + ')');
  writeRatiosForRows_(sheet, curData.sales,  4, 11);
  Logger.log('writeRatiosForRows_ 開始 (前月: rows 15-22, 売上=' + prevData.sales + ')');
  writeRatiosForRows_(sheet, prevData.sales, 15, 22);

  // ── Step3: 売上ラベルを書き込む ──────────────────────────────────────
  // I1: 当月売上 / I12: 前月売上（旧I13から変更）
  SpreadsheetApp.flush();
  const i1Val  = '売上：¥' + formatYen_(curData.sales);
  const i12Val = '売上：¥' + formatYen_(prevData.sales);

  // I1（当月）書き込み
  const i1Cell = sheet.getRange('I1');
  i1Cell.clearContent();
  i1Cell.setNumberFormat('@');
  i1Cell.setValue(i1Val);
  SpreadsheetApp.flush();
  Logger.log('I1 書き込み完了: ' + i1Val + ' / 読み返し: ' + JSON.stringify(sheet.getRange('I1').getValue()));

  // I12（前月）書き込み ── 診断ログ付き多重フォールバック
  const i12Cell = sheet.getRange('I12');
  Logger.log('[I12 診断] 書き込み前 value=' + JSON.stringify(i12Cell.getValue()) +
             ' formula=' + JSON.stringify(i12Cell.getFormula()) +
             ' isMerged=' + i12Cell.isPartOfMerge());

  i12Cell.clearContent();
  i12Cell.setNumberFormat('@');
  i12Cell.setValue(i12Val);
  SpreadsheetApp.flush();

  const i12After = sheet.getRange('I12').getValue();
  Logger.log('[I12 確認] 書き込み後 getValue=' + JSON.stringify(i12After) + ' (期待値=' + i12Val + ')');

  if (String(i12After) !== i12Val) {
    Logger.log('[I12 警告] 値が残っていません。原因を調査します...');
    if (i12Cell.isPartOfMerge()) {
      const merges = i12Cell.getMergedRanges();
      if (merges.length > 0) {
        const masterCell = sheet.getRange(merges[0].getRow(), merges[0].getColumn());
        Logger.log('[I12] マージ master: ' + masterCell.getA1Notation() + ' → 書き込み直し');
        masterCell.clearContent();
        masterCell.setNumberFormat('@');
        masterCell.setValue(i12Val);
        SpreadsheetApp.flush();
        Logger.log('[I12] master 書き込み後: ' + JSON.stringify(masterCell.getValue()));
      }
    } else {
      Logger.log('[I12] setValues [[]] で再試行...');
      sheet.getRange(12, 9).setValues([[i12Val]]);
      SpreadsheetApp.flush();
      Logger.log('[I12] setValues 後: ' + JSON.stringify(sheet.getRange('I12').getValue()));
    }
  }

  Logger.log('I12 書き込み完了: ' + i12Val);

  // 行13「前月棚卸」見出しを確実に復元（旧実装で売上ラベルが書き込まれた場合）
  // 結合セルのマスターが B13 以外にある場合も getMergedRanges() で追跡する
  const prevHeaderRef = sheet.getRange(13, 2); // B13
  const prevHeaderMaster = prevHeaderRef.isPartOfMerge()
    ? sheet.getRange(prevHeaderRef.getMergedRanges()[0].getRow(),
                     prevHeaderRef.getMergedRanges()[0].getColumn())
    : prevHeaderRef;
  if (String(prevHeaderMaster.getValue()).indexOf('売上：¥') !== -1) {
    prevHeaderMaster.setValue('前月棚卸');
    Logger.log('行13 header を「前月棚卸」に復元しました');
  }

  // ── Step4: ロス入力欄レイアウト整備 ─────────────────────────────────
  setupLossLayout_(sheet);

  Logger.log('更新完了');
}

// ─── ロス入力集計処理 ─────────────────────────────────────────────────────────

/**
 * L/M/N列（分類1/分類2/金額）が編集されたとき、全ロス入力行を読み取って集計し
 * ターゲット行（必要ロス行・廃棄ロス行）の C/E/G 列に振り分ける。
 *
 * 振り分けロジック:
 *   必要ロス × フード   → 当月:row9/前月:row20 の E列（食材F）
 *   必要ロス × ドリンク → 当月:row9/前月:row20 の G列（飲料D）
 *   廃棄ロス × フード   → 当月:row10/前月:row21 の E列
 *   廃棄ロス × ドリンク → 当月:row10/前月:row21 の G列
 *   C列 = E列 + G列（FD合計を自動算出）
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {boolean} isCurrent  true=当月セクション / false=前月セクション
 */
function aggregateLossInput_(sheet, isCurrent) {
  const inputRows = isCurrent ? LOSS_ROWS_CUR    : LOSS_ROWS_PREV;
  const targets   = isCurrent ? LOSS_TARGET_CUR  : LOSS_TARGET_PREV;
  const salesCell = isCurrent ? 'I1' : 'I12';

  // 集計バッファ初期化
  const sums = {};
  const tKeys = Object.keys(targets);
  for (let i = 0; i < tKeys.length; i++) {
    sums[targets[tKeys[i]]] = { food: 0, drink: 0 };
  }

  // ロス入力行（L/M/N = cat1/cat2/amount）を一括読み取り
  const inputData = sheet.getRange(
    inputRows[0], LOSS_COLS.cat1, inputRows.length, 3
  ).getValues();

  for (let i = 0; i < inputData.length; i++) {
    const cat1   = String(inputData[i][0]).trim();
    const cat2   = String(inputData[i][1]).trim();
    const amount = Number(inputData[i][2]) || 0;
    if (!cat1 || !cat2 || amount === 0) continue;

    const targetRow = targets[cat1];
    if (!targetRow || !sums[targetRow]) continue;

    if (cat2 === 'フード')   { sums[targetRow].food   += amount; }
    if (cat2 === 'ドリンク') { sums[targetRow].drink  += amount; }
  }

  // ターゲット行の C/E/G 列に書き込む
  const rowKeys = Object.keys(sums);
  for (let i = 0; i < rowKeys.length; i++) {
    const r   = Number(rowKeys[i]);
    const val = sums[rowKeys[i]];
    const fd  = val.food + val.drink;
    sheet.getRange(r, COLS.fdTotal ).setValue(fd);
    sheet.getRange(r, COLS.foodVal ).setValue(val.food);
    sheet.getRange(r, COLS.drinkVal).setValue(val.drink);
  }

  // 売上比・不明ロスを再計算
  SpreadsheetApp.flush();
  const salesLabel = String(sheet.getRange(salesCell).getValue());
  const sales      = parseSalesLabel_(salesLabel);
  if (isCurrent) {
    writeRatiosForRows_(sheet, sales, 4, 11);
  } else {
    writeRatiosForRows_(sheet, sales, 15, 22);
  }
}

/**
 * "売上：¥1,234,567" 形式のラベルから数値を抽出する。
 */
function parseSalesLabel_(label) {
  const m = String(label).replace(/,/g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * ロス入力欄のレイアウトを整備する（updateInventorySheet_ の末尾から自動実行）。
 *
 * - 行1（L〜O）に当月ロスブロックのヘッダーを設定
 * - 行12（L〜O）に前月ロスブロックの見出し＋ヘッダーを設定
 * - 全ロス入力行（当月 rows 2-11 / 前月 rows 13-22）に
 *   ドロップダウンと背景色を設定
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function setupLossLayout_(sheet) {
  // 当月ロス入力ブロック ヘッダー（行1 L〜O）
  sheet.getRange(1, LOSS_COLS.cat1  ).setValue('分類1（種別）');
  sheet.getRange(1, LOSS_COLS.cat2  ).setValue('分類2（食材/飲料）');
  sheet.getRange(1, LOSS_COLS.amount).setValue('金額');
  sheet.getRange(1, LOSS_COLS.memo  ).setValue('詳細メモ');

  // 前月ロス入力ブロック 見出し＋ヘッダー（行12 L〜O）
  sheet.getRange(12, LOSS_COLS.cat1  ).setValue('▼ 前月ロス（種別）');
  sheet.getRange(12, LOSS_COLS.cat2  ).setValue('分類2（食材/飲料）');
  sheet.getRange(12, LOSS_COLS.amount).setValue('金額');
  sheet.getRange(12, LOSS_COLS.memo  ).setValue('詳細メモ');

  // ドロップダウン: 全ロス入力行の L（分類1）・M（分類2）列
  const cat1Rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['必要ロス', '廃棄ロス'], true)
    .setAllowInvalid(false)
    .build();
  const cat2Rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['フード', 'ドリンク'], true)
    .setAllowInvalid(false)
    .build();

  const allLossRows = LOSS_ROWS_CUR.concat(LOSS_ROWS_PREV);
  allLossRows.forEach(function(r) {
    sheet.getRange(r, LOSS_COLS.cat1).setDataValidation(cat1Rule);
    sheet.getRange(r, LOSS_COLS.cat2).setDataValidation(cat2Rule);
  });

  // 背景色: L/M/N=薄い黄色（手入力欄）、O=薄い水色（メモ欄）
  allLossRows.forEach(function(r) {
    sheet.getRange(r, LOSS_COLS.cat1  ).setBackground('#FFF9C4');
    sheet.getRange(r, LOSS_COLS.cat2  ).setBackground('#FFF9C4');
    sheet.getRange(r, LOSS_COLS.amount).setBackground('#FFF9C4');
    sheet.getRange(r, LOSS_COLS.memo  ).setBackground('#E3F2FD');
  });
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
  const fjStoreName = STORE_MAP[storeName] || storeName;
  if (fjStoreName !== storeName) {
    Logger.log('店舗名変換: "' + storeName + '" → "' + fjStoreName + '"');
  } else {
    Logger.log('店舗名変換なし（対応表に未登録）: "' + storeName + '"');
  }

  const result = {
    sales: 0, foodPurchase: 0, drinkPurchase: 0, foodTheory: 0, drinkTheory: 0
  };

  Logger.log('fetchMetrics_: 検索月=' + monthStr);

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

    const data = src.getRange(1, 1, lastRow, 4).getValues();

    let amount     = 0;
    let hasKakutei = false;

    const normalize_ = function(s) { return s.replace(/[\s　]+/g, ' ').trim(); };
    const targetStore = normalize_(fjStoreName);

    for (let r = 0; r < data.length; r++) {
      const rowMonth = toYYYYMM_(data[r][0]);
      if (rowMonth !== monthStr) continue;
      const rowStore = normalize_(String(data[r][1]));
      if (rowStore !== targetStore) continue;

      const kind = String(data[r][3]).trim();
      const val  = Number(data[r][2]) || 0;

      if (kind === '確定') {
        amount     = val;
        hasKakutei = true;
        break;
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
 */
function writeSection_(sheet, data, sales, purchaseRow, theoryRow) {
  Logger.log(
    'writeSection_: 仕入行=' + purchaseRow + ' 理論行=' + theoryRow + ' 売上=' + sales
  );

  const fdP = data.foodPurchase + data.drinkPurchase;
  sheet.getRange(purchaseRow, COLS.fdTotal  ).setValue(fdP);
  sheet.getRange(purchaseRow, COLS.foodVal  ).setValue(data.foodPurchase);
  sheet.getRange(purchaseRow, COLS.drinkVal ).setValue(data.drinkPurchase);
  setRatio_(sheet, purchaseRow, COLS.fdRatio,    fdP,                sales);
  setRatio_(sheet, purchaseRow, COLS.foodRatio,  data.foodPurchase,  sales);
  setRatio_(sheet, purchaseRow, COLS.drinkRatio, data.drinkPurchase, sales);

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
 */
function writeRatiosForRows_(sheet, sales, startRow, endRow) {
  const numRows = endRow - startRow + 1;
  const vals = sheet.getRange(startRow, COLS.fdTotal, numRows, 5).getValues();
  for (let i = 0; i < numRows; i++) {
    const row      = startRow + i;
    const fdVal    = Number(vals[i][0]) || 0;
    const foodVal  = Number(vals[i][2]) || 0;
    const drinkVal = Number(vals[i][4]) || 0;
    Logger.log(
      'row' + row + ': FD=' + fdVal + ' F=' + foodVal + ' D=' + drinkVal +
      ' → 比率D=' + (sales ? (fdVal/sales*100).toFixed(2) : '-') + '%'
    );
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

function toDateRange_(monthStr) {
  const parts = monthStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return {
    start: new Date(y, m - 1, 1),
    end:   new Date(y, m, 0, 23, 59, 59, 999),
  };
}

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
 */
function toYYYYMM_(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }
  return String(value).trim().slice(0, 7);
}

/**
 * "YYYY-MM" の前月を返す。
 * 例: "2026-05" → "2026-04", "2026-01" → "2025-12"
 */
function prevMonth_(monthStr) {
  const parts = monthStr.split('-');
  let y = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10) - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return y + '-' + String(m).padStart(2, '0');
}

// ─── 手動実行用 ────────────────────────────────────────────────────────────────

/**
 * Apps Script エディタから直接実行してテスト・手動更新に使う。
 */
function manualUpdate() {
  updateInventorySheet_();
}
