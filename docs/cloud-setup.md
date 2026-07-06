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
| `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | `credentials/service_account.json` を Base64 化した文字列（下記） |
| `INFOMART_USER_ID` | インフォマートのID（インフォマート取得を使う場合のみ） |
| `INFOMART_PASSWORD` | インフォマートのパスワード（同上） |

### service_account.json の Base64 化（PC の PowerShell で実行）

```powershell
cd C:\Users\Owner\OneDrive\デスクトップ\infomart_automation
[Convert]::ToBase64String([IO.File]::ReadAllBytes("credentials\service_account.json")) | Set-Clipboard
```

実行するとクリップボードにコピーされるので、そのまま Secret の値に貼り付ける。

## 2. 実行方法

### 手動実行（スマホのブラウザからも可能）

GitHub リポジトリ → **Actions** タブ → **棚卸データ自動取得** → **Run workflow**

- `month`: 対象月（例 `2026-06`）。空欄なら前月。
- `target`: `fw`（5指標シート）/ `infomart`（棚卸集計）/ `both`

### 自動実行

毎月3日 09:00（日本時間）に前月分の FW 確定データを自動取得する。

## 3. 失敗時の調査

実行結果ページ下部の **Artifacts**（`run-XX-logs`）に `logs/`・`screenshots/`・`downloads/`
が保存される。エラー時はスクリーンショットで画面のどこで止まったかを確認できる。

## 注意

- ワークフローの実行ボタンは、このファイルと `fetch.yml` が **main ブランチにマージされてから** Actions タブに表示される。
- GitHub Actions の実行元IPは海外のため、初回実行でログインが弾かれる可能性が
  理論上ある（その場合は国内VPS等の代替構成に切り替える）。初回は `target=fw`,
  `month=2026-06` で動作確認すること。
