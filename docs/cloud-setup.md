# クラウド自動取得（GitHub Actions）セットアップ手順

PCを起動していなくても、GitHub Actions 上で FW（Fooding Journal）/ インフォマートの
データ取得〜スプレッドシート書き込みを実行できます。

ワークフロー: `.github/workflows/fetch.yml`

## 1. Secrets の登録（初回のみ）

GitHub リポジトリの **Settings > Secrets and variables > Actions > New repository secret** で登録:

| Secret 名 | 内容 |
|---|---|
| `FOODIST_JOURNAL_USER_ID` | FW（Fooding Journal）のログインID |
| `FOODIST_JOURNAL_PASSWORD` | FW のパスワード |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `credentials/service_account.json` の**中身をそのまま**貼り付け（下記） |
| `INFOMART_USER_ID` | インフォマートのID（インフォマート取得を使う場合のみ） |
| `INFOMART_PASSWORD` | インフォマートのパスワード（同上） |

### GOOGLE_SERVICE_ACCOUNT_JSON の値の作り方

1. PC でメモ帳を開く: `Win + R` →「`notepad C:\Users\Owner\OneDrive\デスクトップ\infomart_automation\credentials\service_account.json`」→ Enter
2. `Ctrl + A`（全選択）→ `Ctrl + C`（コピー）
3. Secret の値の欄に `Ctrl + V` で貼り付けて保存

`{` で始まり `}` で終わる長い文字列がそのまま入っていればOK。
（旧方式の `GOOGLE_SERVICE_ACCOUNT_JSON_B64`（Base64文字列）も引き続き使用可能）

## 2. 実行方法

### 手動実行（スマホのブラウザからも可能）

GitHub リポジトリ → **Actions** タブ → **棚卸データ自動取得** → **Run workflow**

- `month`: 対象月（例 `2026-06`）。空欄なら前月。
- `target`: `fw`（5指標シート）/ `infomart`（棚卸集計）/ `both`

### 自動実行

毎月 **3日・4日・5日の 09:00（日本時間）** に、前月分の **FW＋インフォマート** を
自動取得する。同月・同店舗のデータは上書きされるため、期間中は毎日最新の値に
置き換わる（店舗の締めが遅れても5日までに自動で反映される）。

### ダッシュボードからの再取得ボタン

ダッシュボード（`gas/dashboard/` 参照）の「⟳ データ再取得」ボタンから、
月（YYYY-MM）と対象（FW／インフォマート／両方）を指定してクラウド取得を
起動できる（5〜15分でシート反映）。スプレッドシートは純粋なデータベースとして
扱い、操作UIはすべてダッシュボードに集約する。

初期設定（管理者・1回だけ）:
1. https://github.com/settings/personal-access-tokens/new でトークンを作成
   - Repository access: Only select repositories → `amami-cell/-`
   - Permissions > Repository permissions > **Actions: Read and write**
2. ダッシュボードの再取得モーダル内「初期設定」にトークンを貼り付けて保存

## 3. 失敗時の調査

実行結果ページ下部の **Artifacts**（`run-XX-logs`）に `logs/`・`screenshots/`・`downloads/`
が保存される。エラー時はスクリーンショットで画面のどこで止まったかを確認できる。

## 注意

- ワークフローの実行ボタンは、このファイルと `fetch.yml` が **main ブランチにマージされてから** Actions タブに表示される。
- GitHub Actions の実行元IPは海外のため、初回実行でログインが弾かれる可能性が
  理論上ある（その場合は国内VPS等の代替構成に切り替える）。初回は `target=fw`,
  `month=2026-06` で動作確認すること。
