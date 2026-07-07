# ダッシュボード自動デプロイ（コピペ卒業）

`gas/dashboard/` を変更して main に入れると、GitHub Actions が clasp で
Apps Script へ自動反映し、同じURLのWebアプリを更新する。以降、手作業の
コピペ・デプロイは不要。

ワークフロー: `.github/workflows/deploy_dashboard.yml`

## 一度だけの初期設定

### 1. Apps Script API を ON
https://script.google.com/home/usersettings を開き「Apps Script API」を**オン**。

### 2. clasp にログインして鍵を取り出す（PC）
Node.js を入れてから（https://nodejs.org のLTS）、ターミナル（PowerShell）で:

```powershell
npm install -g @google/clasp
clasp login
```

ブラウザが開くのでGoogleを許可 → 完了すると鍵ファイルができる。中身を表示:

```powershell
notepad $HOME\.clasprc.json
```

表示された `{...}` を全部コピー → GitHub Secret **`CLASPRC_JSON`** に貼る。

### 3. スクリプトIDを控える
Apps Scriptのダッシュボードプロジェクトを開き、URLの
`https://script.google.com/…/projects/【ここ】/edit` の部分をコピー
→ GitHub Secret **`CLASP_SCRIPT_ID`** に貼る。

### 4. （任意）デプロイIDを固定
Apps Script →「デプロイ」→「デプロイを管理」→ ウェブアプリのデプロイID
（`AKfyc…`）をコピー → Secret **`CLASP_DEPLOYMENT_ID`** に貼る。
未設定でも既存のWebアプリを自動検出する。

### 5. 反映
以降 `gas/dashboard/**` が main に入るたびに自動デプロイ。手動実行も可
（Actions →「ダッシュボード自動デプロイ」→ Run workflow）。

## 注意（アクセス範囲）
`gas/dashboard/appsscript.json` の `webapp.access` が公開範囲を決める。
- `ANYONE_ANONYMOUS`: リンクを知っている全員（ログイン不要）
- `DOMAIN`: 会社（Google Workspace）の組織内のみ
- `MYSELF`: 自分のみ

会社の財務データなので、現在の共有設定に合わせること。自動デプロイは
この値を上書きするため、組織内限定にしたい場合は `DOMAIN` にする。
