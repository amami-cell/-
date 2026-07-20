/**
 * dashboard.gs — 棚卸ダッシュボード（GAS Webアプリ バックエンド）
 *
 * 【設置方法】
 * 1. https://script.google.com → 「新しいプロジェクト」
 * 2. このファイルを「コード.gs」に貼り付け
 * 3. ＋ → HTML で「index」を作成し index.html を貼り付け
 * 4. デプロイ → 新しいデプロイ → 種類: ウェブアプリ
 *    - 実行ユーザー: 自分 ／ アクセスできるユーザー: 組織 or リンクを知っている全員
 * 5. 発行されたURLを社内に共有
 *
 * 【再取得ボタンの初期設定（管理者のみ・1回だけ）】
 * 画面の取込ボタン →「初期設定」に GitHub トークンを貼り付け。
 * トークンの作り方: https://github.com/settings/personal-access-tokens/new
 *   Repository access: Only select repositories → amami-cell/-
 *   Permissions > Repository permissions > Actions: Read and write
 */

const SPREADSHEET_ID = '18Fq_mpEweHOFTlF4ntmwJzDsJNSt-DOq7wQYy8E0iLc';

const METRIC_SHEETS = {
  sales: '売上',
  foodSales: 'F売上',
  drinkSales: 'D売上',
  foodPurchase: 'F食材費仕入',
  drinkPurchase: 'D飲料費仕入',
  foodTheory: 'フード理論原価',
  drinkTheory: 'ドリンク理論原価',
  // FW（店長会資料）から取り込む予算比。原価判定（商品開発 vs 店舗コントロール）に使う。
  budgetFdRate: 'FD予算比',
  budgetFoodRate: 'フード予算比',
  budgetDrinkRate: 'ドリンク予算比',
};

const INVENTORY_SHEET = '月次集計';
const LOSS_SHEET = 'ロス記録';
const SETTINGS_SHEET = '店舗設定';

const GH_OWNER = 'amami-cell';
const GH_REPO = '-';
const GH_WORKFLOW = 'fetch.yml';

/** インフォマート店舗名 → FWシート店舗名 対応表（inventory_update.gs と同一） */
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

// ─── Webアプリ入口 ────────────────────────────────────────────────────────────

var APP_FAVICON = 'data:image/png;base64,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';

function doGet() {
  var out = HtmlService.createHtmlOutputFromFile('index')
    .setTitle('棚卸')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // ホーム画面用のPWA入口ページ（GitHub Pages）から全画面iframeで表示できるように許可。
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  // ブラウザのタブ／ブックマークのアイコンを棚卸アイコンに。
  // data URIが弾かれる環境でもアプリが落ちないよう try/catch で保護。
  try { out.setFaviconUrl(APP_FAVICON); } catch (e) {}
  return out;
}

// ─── パスワード（閲覧ロック）────────────────────────────────────────────────────
// 「リンクを知っている全員」公開のため、合言葉で保護する。合言葉はスクリプト
// プロパティに保存し、画面コードには出ない。管理者はいつでも変更できる。

const PASSCODE_PROP = 'DASH_PASSCODE';
const DEFAULT_PASSCODE = '8888';   // 未変更時の初期パスワード（画面の🔒からいつでも変更可）

/** 現在有効なパスワード。未設定なら初期値 8888。 */
function currentPass_() {
  return PropertiesService.getScriptProperties().getProperty(PASSCODE_PROP) || DEFAULT_PASSCODE;
}

/** サーバ内部用: 合言葉が一致するか。 */
function verifyPass_(pass) {
  return String(pass || '') === currentPass_();
}

/** 合言葉は常に有効（初期値8888）なので必ずログイン画面を出す。 */
function getPasscodeStatus() {
  return { set: true };
}

/** 合言葉の照合。 */
function verifyPasscode(pass) {
  return { ok: verifyPass_(pass) };
}

/** 合言葉を変更する。現在の合言葉（初期は8888）が必要。 */
function changePasscode(current, next) {
  if (String(current || '') !== currentPass_()) {
    return { ok: false, message: '現在のパスワードが違います' };
  }
  next = String(next || '').trim();
  if (next.length < 4) return { ok: false, message: 'パスワードは4文字以上にしてください' };
  PropertiesService.getScriptProperties().setProperty(PASSCODE_PROP, next);
  return { ok: true, message: 'パスワードを変更しました' };
}

// ─── データ提供 ───────────────────────────────────────────────────────────────

/** 全データを返す（5分キャッシュ）。月・店舗・F/D切替はクライアント側で行う。 */
function getDashboardData(pass, forceRefresh) {
  if (!verifyPass_(pass)) return { authError: true };
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const hit = cache.get('dash_v2');
    if (hit) return JSON.parse(hit);
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const monthsSet = {};
  const storesSet = {};
  const metrics = {};   // metrics[ym][storeKey] = {sales, foodPurchase, ..., kind}

  Object.keys(METRIC_SHEETS).forEach(function (key) {
    const sheet = ss.getSheetByName(METRIC_SHEETS[key]);
    if (!sheet) return;
    sheet.getDataRange().getValues().forEach(function (row) {
      const ym = String(row[0] || '').trim();
      const store = String(row[1] || '').trim();
      const val = Number(row[2]) || 0;
      const kind = String(row[3] || '').trim();
      if (!/^\d{4}-\d{2}$/.test(ym) || !store) return;
      monthsSet[ym] = true;
      storesSet[store] = true;
      if (!metrics[ym]) metrics[ym] = {};
      if (!metrics[ym][store]) metrics[ym][store] = {};
      const cell = metrics[ym][store];
      // 確定を優先（中間しか無い月はそのまま使い kind で明示）
      if (cell[key] === undefined || kind === '確定') {
        cell[key] = val;
        cell.kind = kind || cell.kind;
      }
    });
  });

  // 月次集計（インフォマート棚卸高）: [年月, 店舗名(インフォマート), フード, ドリンク, 備品, 取込日時]
  const inventory = {};  // inventory[ym][storeKey] = {food, drink, supplies}
  const invSheet = ss.getSheetByName(INVENTORY_SHEET);
  if (invSheet) {
    invSheet.getDataRange().getValues().forEach(function (row) {
      const ym = String(row[0] || '').trim();
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      const rawName = String(row[1] || '').trim();
      const storeKey = STORE_MAP[rawName] || rawName;
      if (!inventory[ym]) inventory[ym] = {};
      inventory[ym][storeKey] = {
        food: Number(row[2]) || 0,
        drink: Number(row[3]) || 0,
        supplies: Number(row[4]) || 0,
      };
      monthsSet[ym] = true;
    });
  }

  // ロス記録: [ID, 年月, 店舗, 種別, 区分, 内容, 金額, 登録日時]
  const losses = {};  // losses[ym][storeKey] = [{id, kind, cat, memo, amount, ts}]
  const lossSheet = ss.getSheetByName(LOSS_SHEET);
  if (lossSheet) {
    lossSheet.getDataRange().getValues().forEach(function (row, i) {
      if (i === 0) return; // ヘッダー
      const id = String(row[0] || '').trim();
      const ym = String(row[1] || '').trim();
      const store = String(row[2] || '').trim();
      if (!id || !/^\d{4}-\d{2}$/.test(ym) || !store) return;
      if (!losses[ym]) losses[ym] = {};
      if (!losses[ym][store]) losses[ym][store] = [];
      losses[ym][store].push({
        id: id,
        kind: String(row[3] || ''),
        cat: String(row[4] || ''),
        memo: String(row[5] || ''),
        amount: Number(row[6]) || 0,
        ts: String(row[7] || ''),
      });
    });
  }

  // 店舗設定: [店舗, 理論原価2%込み, 更新日時]
  const storeFlags = {};
  const setSheet = ss.getSheetByName(SETTINGS_SHEET);
  if (setSheet) {
    setSheet.getDataRange().getValues().forEach(function (row, i) {
      if (i === 0) return;
      const store = String(row[0] || '').trim();
      if (!store) return;
      storeFlags[store] = row[1] === true || String(row[1]).toUpperCase() === 'TRUE';
    });
  }

  const months = Object.keys(monthsSet).sort();
  const stores = Object.keys(storesSet).sort().map(function (key) {
    const idx = key.indexOf('_');
    return {
      key: key,
      id: idx > 0 ? key.slice(0, idx) : '',
      name: idx > 0 ? key.slice(idx + 1) : key,
    };
  });

  const out = {
    updatedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    months: months,
    stores: stores,
    metrics: metrics,
    inventory: inventory,
    losses: losses,
    storeFlags: storeFlags,
  };

  try {
    cache.put('dash_v2', JSON.stringify(out), 300);
  } catch (e) {
    // キャッシュ上限超過時は素通し
  }
  return out;
}

// ─── ロス記録の追加・削除 ─────────────────────────────────────────────────────

function lossSheet_(ss) {
  let sh = ss.getSheetByName(LOSS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOSS_SHEET);
    sh.appendRow(['ID', '年月', '店舗', '種別', '区分', '内容', '金額', '登録日時']);
  }
  return sh;
}

/**
 * ロスを1件登録する。
 * @param {string} storeKey FWシート店舗名
 * @param {string} ym 'YYYY-MM'
 * @param {string} kind '廃棄ロス' | '必要ロス'
 * @param {string} cat 'フード' | 'ドリンク'
 * @param {string} memo 内容
 * @param {number} amount 金額（円）
 */
function addLoss(storeKey, ym, kind, cat, memo, amount) {
  storeKey = String(storeKey || '').trim();
  ym = String(ym || '').trim();
  memo = String(memo || '').trim().slice(0, 200);
  amount = Number(amount);
  if (!storeKey) return { ok: false, message: '店舗が不正です' };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, message: '月の形式が不正です' };
  if (['廃棄ロス', '必要ロス', '理論原価'].indexOf(kind) < 0) return { ok: false, message: '種別が不正です' };
  if (['フード', 'ドリンク'].indexOf(cat) < 0) return { ok: false, message: '区分が不正です' };
  if (!memo) return { ok: false, message: '内容を入力してください' };
  if (!isFinite(amount) || amount <= 0) return { ok: false, message: '金額は1円以上で入力してください' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = lossSheet_(ss);
    const rec = {
      id: Utilities.getUuid(),
      kind: kind, cat: cat, memo: memo, amount: Math.round(amount),
      ts: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    };
    sh.appendRow([rec.id, ym, storeKey, rec.kind, rec.cat, rec.memo, rec.amount, rec.ts]);
    CacheService.getScriptCache().remove('dash_v2');
    return { ok: true, rec: rec };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ロスを複数件まとめて登録する。
 * @param {string} storeKey FWシート店舗名
 * @param {string} ym 'YYYY-MM'
 * @param {string} kind '廃棄ロス' | '必要ロス'
 * @param {Array<{cat:string, memo:string, amount:number}>} items
 */
function addLosses(pass, storeKey, ym, kind, items) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  storeKey = String(storeKey || '').trim();
  ym = String(ym || '').trim();
  if (!storeKey) return { ok: false, message: '店舗が不正です' };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, message: '月の形式が不正です' };
  if (['廃棄ロス', '必要ロス', '理論原価'].indexOf(kind) < 0) return { ok: false, message: '種別が不正です' };
  if (!items || !items.length) return { ok: false, message: '入力された項目がありません' };
  if (items.length > 50) return { ok: false, message: '一度に登録できるのは50件までです' };

  const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  const recs = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const cat = String(it.cat || '').trim();
    const memo = String(it.memo || '').trim().slice(0, 200);
    const amount = Number(it.amount);
    if (['フード', 'ドリンク'].indexOf(cat) < 0) return { ok: false, message: (i + 1) + '行目: 区分が不正です' };
    if (!memo) return { ok: false, message: (i + 1) + '行目: 内容を入力してください' };
    if (!isFinite(amount) || amount <= 0) return { ok: false, message: (i + 1) + '行目: 金額は1円以上で入力してください' };
    recs.push({ id: Utilities.getUuid(), kind: kind, cat: cat, memo: memo, amount: Math.round(amount), ts: ts });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = lossSheet_(ss);
    const rows = recs.map(function (r) { return [r.id, ym, storeKey, r.kind, r.cat, r.memo, r.amount, r.ts]; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
    CacheService.getScriptCache().remove('dash_v2');
    return { ok: true, recs: recs };
  } finally {
    lock.releaseLock();
  }
}

/** ロスを1件削除する。 */
function deleteLoss(pass, id) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  id = String(id || '').trim();
  if (!id) return { ok: false, message: 'IDが不正です' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(LOSS_SHEET);
    if (!sh) return { ok: false, message: 'ロス記録シートがありません' };
    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    for (let i = ids.length - 1; i >= 1; i--) {
      if (String(ids[i][0]).trim() === id) {
        sh.deleteRow(i + 1);
        CacheService.getScriptCache().remove('dash_v2');
        return { ok: true };
      }
    }
    return { ok: false, message: '該当のロス記録が見つかりません（既に削除済みの可能性）' };
  } finally {
    lock.releaseLock();
  }
}

// ─── 店舗設定（理論原価2%込みフラグ）─────────────────────────────────────────

/**
 * 店舗ごとの「FWの理論原価に2%込み済み」フラグを保存する。
 * @param {Object<string, boolean>} flags {店舗キー: true/false}
 */
function saveStoreFlags(pass, flags) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  if (!flags || typeof flags !== 'object') return { ok: false, message: '設定が不正です' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(SETTINGS_SHEET);
    if (!sh) {
      sh = ss.insertSheet(SETTINGS_SHEET);
    }
    sh.clear();
    const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    const rows = [['店舗', '理論原価2%込み', '更新日時']];
    Object.keys(flags).sort().forEach(function (key) {
      rows.push([key, flags[key] === true, ts]);
    });
    sh.getRange(1, 1, rows.length, 3).setValues(rows);
    CacheService.getScriptCache().remove('dash_v2');
    return { ok: true, message: '保存しました' };
  } finally {
    lock.releaseLock();
  }
}

// ─── クラウド再取得（GitHub Actions 起動）──────────────────────────────────────

function hasGithubToken() {
  return !!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
}

function saveGithubToken(pass, token) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  token = String(token || '').trim();
  if (!token) return { ok: false, message: 'トークンが空です' };
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', token);
  return { ok: true, message: '保存しました' };
}

/**
 * fetch.yml を起動する。
 * @param {string} target 'fw' | 'infomart' | 'both'
 * @param {string} month  'YYYY-MM'
 */
function triggerCloudFetch(pass, target, month) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  if (['fw', 'infomart', 'both'].indexOf(target) < 0) {
    return { ok: false, message: '対象の指定が不正です' };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) {
    return { ok: false, message: '月の形式が不正です（例: 2026-06）' };
  }
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    return { ok: false, needSetup: true, message: '初期設定（トークン登録）が必要です' };
  }

  const url = 'https://api.github.com/repos/' + GH_OWNER + '/' + encodeURIComponent(GH_REPO) +
              '/actions/workflows/' + GH_WORKFLOW + '/dispatches';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ ref: 'main', inputs: { month: month, target: target } }),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  if (code === 204) {
    const label = target === 'fw' ? 'FW取込' : (target === 'infomart' ? 'インフォマート取込' : 'FW＋インフォマート取込');
    return { ok: true, message: month + ' の' + label + '（全店舗）を開始しました。5〜15分後に「最新に更新」を押してください。' };
  }
  if (code === 401 || code === 403) {
    return { ok: false, needSetup: true, message: '認証エラー（トークンの期限切れ・権限不足の可能性）。初期設定からトークンを登録し直してください。' };
  }
  return { ok: false, message: '起動に失敗しました (HTTP ' + code + ')' };
}
