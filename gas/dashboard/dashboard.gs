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
  foodPurchase: 'F食材費仕入',
  drinkPurchase: 'D飲料費仕入',
  foodTheory: 'フード理論原価',
  drinkTheory: 'ドリンク理論原価',
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

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('棚卸ダッシュボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ─── データ提供 ───────────────────────────────────────────────────────────────

/** 全データを返す（5分キャッシュ）。月・店舗・F/D切替はクライアント側で行う。 */
function getDashboardData(forceRefresh) {
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
  if (['廃棄ロス', '必要ロス'].indexOf(kind) < 0) return { ok: false, message: '種別が不正です' };
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
function addLosses(storeKey, ym, kind, items) {
  storeKey = String(storeKey || '').trim();
  ym = String(ym || '').trim();
  if (!storeKey) return { ok: false, message: '店舗が不正です' };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, message: '月の形式が不正です' };
  if (['廃棄ロス', '必要ロス'].indexOf(kind) < 0) return { ok: false, message: '種別が不正です' };
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
function deleteLoss(id) {
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
function saveStoreFlags(flags) {
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

function saveGithubToken(token) {
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
function triggerCloudFetch(target, month) {
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
