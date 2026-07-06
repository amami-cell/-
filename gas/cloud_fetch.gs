/**
 * cloud_fetch.gs
 * スプレッドシートのメニューから GitHub Actions のクラウド取得を起動する。
 *
 * 【設置方法】
 * 1. スプレッドシートの 拡張機能 > Apps Script を開く
 * 2. ＋ボタンでスクリプトファイルを追加し「cloud_fetch」と名付けてこのコードを貼り付け
 * 3. inventory_update.gs の onOpen() を最新版（クラウド実行メニュー入り）に置き換えて保存
 * 4. シートを再読み込みし、メニュー 📊 棚卸管理 > ⚙️ クラウド実行の初期設定 でトークンを登録
 *
 * 【トークンの作り方（1回だけ）】
 * 1. https://github.com/settings/personal-access-tokens/new を開く
 * 2. Token name: 「棚卸シート再取得」など / Expiration: 1年など
 * 3. Repository access: Only select repositories → amami-cell/- を選択
 * 4. Permissions > Repository permissions > Actions を「Read and write」に
 * 5. Generate token → 表示された github_pat_... をコピーして初期設定に貼り付け
 */

const GH_OWNER = 'amami-cell';
const GH_REPO = '-';
const GH_WORKFLOW = 'fetch.yml';

/** メニュー: ⚙️ クラウド実行の初期設定 */
function setupCloudFetchToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'クラウド実行の初期設定',
    'GitHubのアクセストークンを貼り付けてください（github_pat_... で始まる文字列）',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const token = res.getResponseText().trim();
  if (!token) {
    ui.alert('トークンが空です。もう一度やり直してください。');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', token);
  ui.alert('保存しました。メニューの「再取得」ボタンが使えるようになりました。');
}

/** メニュー: ☁️ FW再取得 */
function runCloudFetchFW() {
  cloudFetch_('fw', 'FW（売上・仕入・理論原価）');
}

/** メニュー: ☁️ インフォマート再取得 */
function runCloudFetchInfomart() {
  cloudFetch_('infomart', 'インフォマート（棚卸金額）');
}

/** 前月の YYYY-MM 文字列を返す */
function prevMonthStr_() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM');
}

/** GitHub Actions の fetch.yml を起動する */
function cloudFetch_(target, label) {
  const ui = SpreadsheetApp.getUi();
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    ui.alert('先に「⚙️ クラウド実行の初期設定」でトークンを登録してください。');
    return;
  }

  const res = ui.prompt(
    label + ' の再取得',
    '対象月を YYYY-MM 形式で入力してください（例: ' + prevMonthStr_() + '）',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const month = res.getResponseText().trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    ui.alert('月の形式が正しくありません: ' + month + '\n例: ' + prevMonthStr_());
    return;
  }

  const url = 'https://api.github.com/repos/' + GH_OWNER + '/' + encodeURIComponent(GH_REPO) +
              '/actions/workflows/' + GH_WORKFLOW + '/dispatches';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
    },
    payload: JSON.stringify({ ref: 'main', inputs: { month: month, target: target } }),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  if (code === 204) {
    ui.alert(
      '起動しました！\n\n' +
      month + ' の ' + label + ' を取得しています。\n' +
      '5〜15分ほどでシートに反映されます（画面はそのまま閉じてOK）。'
    );
  } else if (code === 401 || code === 403) {
    ui.alert('認証エラーです (HTTP ' + code + ')。\nトークンの期限切れ・権限不足の可能性があります。\n「⚙️ クラウド実行の初期設定」で新しいトークンを登録し直してください。');
  } else {
    ui.alert('起動に失敗しました (HTTP ' + code + ')\n' + resp.getContentText().slice(0, 300));
  }
}
