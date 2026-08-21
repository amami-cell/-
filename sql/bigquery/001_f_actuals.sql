-- ============================================================
-- BigQuery: 実績ロングデータ f_actuals（土台の心臓部）
--
--   * 大量・追記中心・SQL集計に向くのでここは BigQuery に置く。
--   * date でパーティションを切り、store_code / metric でクラスタリングする。
--     日次パーティション単位で入れ替える方式にすることで、冪等な再取り込みができる。
--   * grain は 'hour' / 'day' / 'month'。粒度を混ぜて合計すると二重計上になるため、
--     集計時は必ず grain を絞る。
--   * hour / product_name / product_category は、時間帯別売上と ABC分析が
--     取り込めるようになったときにそのまま使えるよう、先に空けてある。
--
-- {project} と {dataset} は実行時に置換する（hansoku.db.bigquery_wh 参照）。
-- ============================================================

CREATE SCHEMA IF NOT EXISTS `{project}.{dataset}`
OPTIONS (location = 'asia-northeast1');

CREATE TABLE IF NOT EXISTS `{project}.{dataset}.f_actuals`
(
  store_code       STRING    NOT NULL OPTIONS (description = '店舗コード。m_stores.store_code と一致する結合キー'),
  date             DATE      NOT NULL OPTIONS (description = '実績日。grain=month のときはその月の1日'),
  grain            STRING    NOT NULL OPTIONS (description = "粒度: 'hour' / 'day' / 'month'"),
  hour             INT64              OPTIONS (description = '0-23。grain=hour のときのみ値が入る'),
  metric           STRING    NOT NULL OPTIONS (description = 'sales / covers / avg_check / food_purchase など'),
  value            FLOAT64   NOT NULL OPTIONS (description = '実測値'),
  product_name     STRING             OPTIONS (description = 'ABC分析の商品名。share型施策の分子に使う'),
  product_category STRING             OPTIONS (description = 'ABC分析のカテゴリ。share型施策の分子に使う（優先）'),
  kind             STRING             OPTIONS (description = "取り込み元の確定区分: '中間' / '確定'"),
  source           STRING    NOT NULL OPTIONS (description = '集約元。トレース用（例: fw_sheet）'),
  ingested_at      TIMESTAMP NOT NULL OPTIONS (description = '取り込み時刻（UTC）')
)
PARTITION BY date
CLUSTER BY store_code, metric
OPTIONS (
  description = '実績ロングデータ。店舗×日付×時×指標の最小粒度で保持する'
);
