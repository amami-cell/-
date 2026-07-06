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
 * 画面右上「⟳ データ再取得」→「初期設定」に GitHub トークンを貼り付け。
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

/** 全データを返す（5分キャッシュ）。クライアントは月・店舗の切替をローカルで行う。 */
function getDashboardData(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const hit = cache.get('dash_v1');
    if (hit) return JSON.parse(hit);
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const monthsSet = {};
  const storesSet = {};
  const metrics = {};   // metrics[ym][storeKey] = {sales, foodPurchase, ..., kind}

  Object.keys(METRIC_SHEETS).forEach(function (key) {
    const sheet = ss.getSheetByName(METRIC_SHEETS[key]);
    if (!sheet) return;
    const values = sheet.getDataRange().getValues();
    values.forEach(function (row) {
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
  };

  try {
    cache.put('dash_v1', JSON.stringify(out), 300);
  } catch (e) {
    // キャッシュ上限超過時は素通し（毎回シートから読む）
  }
  return out;
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
    return { ok: true, message: month + ' の取得を開始しました。5〜15分後に「最新に更新」を押してください。' };
  }
  if (code === 401 || code === 403) {
    return { ok: false, needSetup: true, message: '認証エラー（トークンの期限切れ・権限不足の可能性）。初期設定からトークンを登録し直してください。' };
  }
  return { ok: false, message: '起動に失敗しました (HTTP ' + code + ')' };
}
