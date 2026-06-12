# 発注インフォマート 棚卸自動化システム

発注インフォマートの「取引先別棚卸高」を毎月自動取得し、Google Drive へ保存・Google Spreadsheet へ集計するシステムです。

---

## 📁 ファイル構成

```
infomart_automation/
├── main.py               # エントリーポイント
├── downloader.py         # Playwright によるインフォマート操作
├── google_drive.py       # Google Drive API アップロード
├── spreadsheet.py        # Google Sheets API 集計
├── config_loader.py      # 設定・環境変数ローダー
├── config.yaml           # 店舗設定・各種パラメータ
├── supplier_master.csv   # 取引先分類マスタ（フード/ドリンク/備品）
├── requirements.txt      # Python 依存パッケージ
├── .env.example          # 環境変数テンプレート
├── README.md             # 本ファイル
├── credentials/          # Google サービスアカウント JSON 配置先
│   └── service_account.json  ← ここに配置
├── downloads/            # ダウンロードした Excel（自動作成）
├── screenshots/          # エラー時スクリーンショット（自動作成）
└── logs/                 # 実行ログ（自動作成）
```

---

## 🚀 初期セットアップ

### 1. Python 依存パッケージのインストール

```bash
pip install -r requirements.txt
```

### 2. Playwright ブラウザのインストール

```bash
playwright install chromium
```

### 3. Google Cloud の設定

#### 3-1. Google Cloud プロジェクトを作成

1. [Google Cloud Console](https://console.cloud.google.com/) を開く
2. 新しいプロジェクトを作成（例: `infomart-automation`）

#### 3-2. API を有効化

- **Google Drive API**
- **Google Sheets API**

[APIライブラリ](https://console.cloud.google.com/apis/library) から検索して有効化してください。

#### 3-3. サービスアカウントを作成

1. [IAM と管理 → サービスアカウント](https://console.cloud.google.com/iam-admin/serviceaccounts) を開く
2. 「サービスアカウントを作成」をクリック
3. 名前: `infomart-bot`（任意）
4. 役割: **編集者** を選択
5. 「完了」後、作成したアカウントをクリック
6. 「キー」タブ → 「鍵を追加」→「新しい鍵を作成」→ **JSON** を選択してダウンロード

#### 3-4. サービスアカウント JSON を配置

```bash
mkdir -p credentials
mv ~/Downloads/your-project-xxxxx.json credentials/service_account.json
```

#### 3-5. Google Drive フォルダの共有（オプション）

特定のフォルダに保存したい場合、そのフォルダをサービスアカウントのメールアドレス（`xxxxx@your-project.iam.gserviceaccount.com`）と共有してください。

### 4. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して認証情報を入力:

```dotenv
INFOMART_USER_ID=your_infomart_user_id
INFOMART_PASSWORD=your_infomart_password
GOOGLE_SERVICE_ACCOUNT_JSON=./credentials/service_account.json

# 既存スプレッドシートがある場合はIDを指定（任意）
# GOOGLE_SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms

# Google Drive の保存先フォルダID（任意）
# GOOGLE_DRIVE_PARENT_FOLDER_ID=
```

> ⚠️ `.env` は Git にコミットしないでください（`.gitignore` に追加推奨）

### 5. 店舗設定の確認

`config.yaml` の `stores` セクションに対象店舗が設定されていることを確認してください。

```yaml
stores:
  - store_id: "UMAMI ARATA すさび"   # インフォマート上の店舗表示名
    file_prefix: "UMAMI_ARATA_SUSABI"  # ファイル名略称
```

### 6. 取引先分類マスタの設定

`supplier_master.csv` に取引先とその分類（フード/ドリンク/備品）を設定してください。

```csv
取引先コード,取引先名,分類
S001,株式会社西原商会,フード
D001,キーコーヒー株式会社,ドリンク
E001,ホシザキ京阪株式会社,備品
```

---

## ▶️ 実行方法

### 通常実行（前月を自動取得）

```bash
python main.py
```

### 対象月を指定して実行

```bash
python main.py --month 2026-05
```

### 特定の店舗のみ再実行

```bash
python main.py --stores "UMAMI ARATA すさび" "UMAMI BURGER 渋谷"
```

### ダウンロードのみ（スプレッドシート集計をスキップ）

```bash
python main.py --download-only
```

### 集計のみ（既存のダウンロードファイルを使用）

```bash
python main.py --aggregate-only
```

### ログレベルを変更して実行

```bash
python main.py --log-level DEBUG
```

---

## 📊 出力先

| 項目 | 場所 |
|------|------|
| ダウンロード Excel | `./downloads/YYYY-MM_店舗名.xlsx` |
| Google Drive | `棚卸自動化/インフォマート/` |
| 集計スプレッドシート | Google Drive 内（自動作成） |
| エラースクリーンショット | `./screenshots/` |
| 実行ログ | `./logs/infomart_YYYY-MM-DD.log` |

### スプレッドシート構成

#### 月次集計シート

| 年月 | 店舗名 | フード | ドリンク | 備品 | 合計 | 取込日時 |
|------|--------|--------|----------|------|------|----------|
| 2026-05 | UMAMI ARATA すさび | 123,000 | 45,000 | 12,000 | 180,000 | 2026-06-01 09:00:00 |

#### 未提出店舗シート

| 年月 | 店舗名 | ファイルプレフィックス | 確認日時 |
|------|--------|----------------------|----------|

#### 店舗マスタシート

| 店舗名 | ファイルプレフィックス | 登録日時 |
|--------|----------------------|----------|

---

## 🔧 店舗の追加・削除

`config.yaml` の `stores` セクションを編集するだけで対応できます。

```yaml
stores:
  # 既存店舗
  - store_id: "UMAMI ARATA すさび"
    file_prefix: "UMAMI_ARATA_SUSABI"
  # 新店舗を追加
  - store_id: "UMAMI BURGER 新店舗"
    file_prefix: "UMAMI_BURGER_SHINTENPO"
```

---

## 🗓️ 毎月自動実行（cron 設定例）

毎月1日の午前9時に自動実行する場合:

```bash
crontab -e
```

```cron
0 9 1 * * cd /path/to/infomart_automation && python main.py >> /path/to/infomart_automation/logs/cron.log 2>&1
```

---

## 🔍 トラブルシューティング

### ログイン失敗

- `.env` の `INFOMART_USER_ID` / `INFOMART_PASSWORD` を確認
- `./screenshots/` にスクリーンショットが保存されているので確認
- インフォマート側でメンテナンスが行われていないか確認

### Google API エラー

- サービスアカウント JSON のパスが正しいか確認
- Google Drive API / Sheets API が有効になっているか確認
- サービスアカウントに必要な権限があるか確認

### ダウンロードボタンが見つからない

インフォマートのUI変更により `downloader.py` の CSS セレクタ調整が必要な場合があります。
`--log-level DEBUG` で実行してエラー詳細を確認し、該当箇所のセレクタを修正してください。

### Excel 列名が一致しない

インフォマートのExcel列名が変更された場合、`spreadsheet.py` の `EXCEL_COLUMNS` 辞書を更新してください。

```python
EXCEL_COLUMNS = {
    "current_inventory": "当月棚卸高",  # 実際の列名に合わせて変更
    ...
}
```

---

## ⚙️ システム要件

- Python 3.12+
- インターネット接続
- Google Cloud プロジェクト（Drive API / Sheets API 有効）
- インフォマートアカウント

---

## 📝 注意事項

- `.env` ファイルは Git で管理しないでください
- `credentials/service_account.json` も Git で管理しないでください
- インフォマートのUI変更時はセレクタの調整が必要な場合があります
- 大量の店舗を短時間で処理するとインフォマート側でレート制限がかかる場合があります
