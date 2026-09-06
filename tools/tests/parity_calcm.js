/*
 * tools/tests/parity_calcm.js
 * アプリのJS計算 calcM（画面が使う）を、共有ゴールデンケース(golden_cases.json)と
 * 突き合わせて検証する。Python側 calc_fd も同じJSONで検証(test_calc.py)するので、
 * どちらかを直してドリフトすると、必ずどちらかのテストが落ちる。
 *
 * 実行:
 *   node tools/tests/parity_calcm.js
 * playwright は require('playwright') で解決（CIは npm i、ローカルは NODE_PATH 経由）。
 * ブラウザは PW_CHROME で実行ファイルを指定可（未指定なら playwright の既定を使う）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const HERE = __dirname;
const golden = JSON.parse(fs.readFileSync(path.join(HERE, 'golden_cases.json'), 'utf8'));
const STORE = golden.store;
const INDEX = path.join(HERE, '..', '..', 'gas', 'dashboard', 'index.html');

// 比較項目と許容誤差（金額はexact相当、率/回転はfloat）
const TOL = { theory: 0.5, turnover: 1e-3, actual: 0.5, unknown: 0.5,
              purchaseRate: 1e-6, theoryRate: 1e-6, unknownRate: 1e-6, budgetRate: 1e-6 };

function buildData(c) {
  const months = [];
  const D = { metrics: {}, inventory: {}, losses: {}, storeFlags: {}, months: months };
  Object.keys(c.metrics).forEach(function (ym) { D.metrics[ym] = {}; D.metrics[ym][STORE] = c.metrics[ym]; });
  Object.keys(c.inventory).forEach(function (ym) {
    const v = c.inventory[ym];
    D.inventory[ym] = {}; D.inventory[ym][STORE] = { food: v.food, drink: v.drink, supplies: 0 };
    if (months.indexOf(ym) < 0) months.push(ym);
  });
  Object.keys(c.losses || {}).forEach(function (ym) {
    D.losses[ym] = {};
    D.losses[ym][STORE] = (c.losses[ym] || []).map(function (x) { return { kind: x.kind, cat: 'フード', amount: x.amount }; });
    if (months.indexOf(ym) < 0) months.push(ym);
  });
  if (months.indexOf(c.ym) < 0) months.push(c.ym);
  months.sort();
  D.storeFlags[STORE] = !!c.storeFlag;
  return D;
}

(async () => {
  let html = fs.readFileSync(INDEX, 'utf8').replace('<?= AUTO_PASS ?>', '');
  // load() が呼ぶ google.script.run を無害化（authErrorでログイン表示にするだけ。calcMはフック経由で直接呼ぶ）。
  const stub = '<script>window.google={script:{run:new Proxy({},{get:function(t,p){return function(){' +
    'if(p==="withSuccessHandler"){t._s=arguments[0];return window.google.script.run;}' +
    'if(p==="withFailureHandler"){return window.google.script.run;}' +
    'if(p==="getDashboardData"){setTimeout(function(){t._s({authError:true});},0);return;}' +
    'return;};}})}};<\/script>';
  html = html.replace('<script>\n(function () {', stub + '\n<script>\n(function () {');
  const tmp = path.join(require('os').tmpdir(), 'parity_dash.html');
  fs.writeFileSync(tmp, html);

  const launch = {};
  if (process.env.PW_CHROME) launch.executablePath = process.env.PW_CHROME;
  const browser = await chromium.launch(launch);
  const page = await browser.newPage();
  const perr = [];
  page.on('pageerror', function (e) { perr.push(String(e.message)); });
  await page.goto('file://' + tmp);
  await page.waitForFunction('window.__tanaCalc && window.__tanaCalc.calcM', { timeout: 10000 });

  const failures = [];
  for (const c of golden.cases) {
    const D = buildData(c);
    const got = await page.evaluate(function (args) {
      window.__tanaCalc.setData(args.D);
      const r = window.__tanaCalc.calcM(args.store, args.ym, 'FD');
      return r; // null もそのまま
    }, { D: D, store: STORE, ym: c.ym });
    if (!got) { failures.push('[' + c.name + '] calcM が null を返した'); continue; }
    const exp = c.expected;
    Object.keys(TOL).forEach(function (k) {
      if (!(k in exp)) return;
      const e = exp[k], g = got[k];
      if (e === null) { if (g !== null && g !== undefined) failures.push('[' + c.name + '] ' + k + ': 期待 null / 実際 ' + g); }
      else if (g === null || g === undefined) failures.push('[' + c.name + '] ' + k + ': 期待 ' + e + ' / 実際 null');
      else if (Math.abs(g - e) > TOL[k]) failures.push('[' + c.name + '] ' + k + ': 期待 ' + e + ' / 実際 ' + g);
    });
  }
  await browser.close();

  if (perr.length) console.log('page errors:', perr.join(' | '));
  if (failures.length) {
    console.error('NG: calcM がゴールデンケースと不一致 (' + failures.length + ')');
    failures.forEach(function (f) { console.error('  - ' + f); });
    process.exit(1);
  }
  console.log('OK: calcM は全ゴールデンケースと一致（' + golden.cases.length + '件）');
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
