# セットアップ手順（天が行う作業）

コードは全て揃っていて、**認証情報を GitHub Secrets に入れれば本番に繋がる**状態。
ここに書いてある作業だけが手作業で、他は自動。

---

## 1. BigQuery（実績データ）

既存の GCP プロジェクト `infomart-automation-498709` を流用する。

1. [BigQuery API](https://console.cloud.google.com/apis/library/bigquery.googleapis.com) を有効化
2. 既存のサービスアカウント `infomart-bot@infomart-automation-498709.iam.gserviceaccount.com` に
   **BigQuery データ編集者** と **BigQuery ジョブユーザー** のロールを付与
3. サービスアカウントの JSON 鍵を用意（既存のものを使い回してよい）

> データセットとテーブルは `python -m hansoku.cli init-schema` が自動で作る。
> リージョンは `asia-northeast1`。

---

## 2. Neon（施策・マスタ）

1. https://neon.tech で無料アカウントを作る
2. プロジェクトを作成（リージョンは Tokyo / ap-southeast-1 あたり）
3. 接続文字列をコピー（`postgresql://...?sslmode=require` の形）

> テーブルは `init-schema` が自動で作る。無料枠 0.5GB・自動スリープ。
> スリープからの復帰で最初の接続が失敗することがあるため、バッチはリトライ前提で書いてある。

---

## 3. Cloudflare R2（制作物PDF）

1. https://dash.cloudflare.com で無料アカウントを作る
2. R2 → バケットを作成（名前: `hansoku-creatives`）
3. R2 → 「R2 API トークンの管理」からアクセスキーを発行
4. ギャラリー表示用にパブリック開発URL（または独自ドメイン）を有効化し、URLを控える

---

## 4. GitHub Secrets への登録

リポジトリ → Settings → Secrets and variables → Actions → New repository secret

| Secret 名 | 値 | 必須 |
|---|---|---|
| `BIGQUERY_PROJECT` | `infomart-automation-498709` | ✅ |
| `BIGQUERY_DATASET` | `hansoku` | |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | サービスアカウント鍵JSONの**中身をそのまま貼る** | ✅ |
| `NEON_DATABASE_URL` | Neon の接続文字列 | ✅ |
| `R2_ACCOUNT_ID` | Cloudflare のアカウントID | ✅ |
| `R2_ACCESS_KEY_ID` | R2 アクセスキーID | ✅ |
| `R2_SECRET_ACCESS_KEY` | R2 シークレットキー | ✅ |
| `R2_BUCKET` | `hansoku-creatives` | |
| `R2_PUBLIC_BASE_URL` | R2 の公開URL | |
| `FW_SPREADSHEET_ID` | `18Fq_mpEweHOFTlF4ntmwJzDsJNSt-DOq7wQYy8E0iLc` | |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push 用（Phase 3） | |

> `FW_SPREADSHEET_ID` は既定値がコードに入っているので、変えないなら登録不要。
> VAPID 鍵は既存の `tasting.initiate-app.com` のものを流用できる。

---

## 5. 共有シートの読み取り権限

FW共有シート（`18Fq_mpE...`）を、サービスアカウントのメールアドレス
`infomart-bot@infomart-automation-498709.iam.gserviceaccount.com` に
**閲覧者**として共有する。

> このシステムはシートを**読むだけ**なので、編集権限は渡さないこと。
> 既存パイプラインを誤って壊す余地を残さない。

---

## 6. 動作確認

GitHub の Actions タブ →「実績の取り込み」→ Run workflow。

初回は `--month` を空にして全件取り込む。ログの最後に次のように出れば成功:

```
読み取り NNNN 行 / 変換 NNNN 行 / 投入 NNNN 行
タブ: 取得 9 / 欠落 0
```

`⚠ 店舗マスタに無い店名` が出たら、`config/stores.yaml` にその店を足す。
新店が増えたときも同じ手順で、1ブロック足すだけで取り込み対象に入る。

---

## 7. 自分に admin 権限を付ける

```bash
python -m hansoku.cli grant-admin amami@8sin.co.jp
```

初期は天のみが admin（全店閲覧・編集可）。店長ログインは Phase 1 で基盤を作り、
有効化は全機能が揃ってから判断する。
