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
  foodSales: 'F売上',
  drinkSales: 'D売上',
  foodPurchase: 'F食材費仕入',
  drinkPurchase: 'D飲料費仕入',
  foodTheory: 'フード理論原価',
  drinkTheory: 'ドリンク理論原価',
  // FW（店長会資料）から取り込む F予算・D予算（予算原価の金額）。原価判定に使う。
  // F予算比/D予算比はダッシュボード側で 予算/実績売上 として算出する。
  budgetFoodCost: 'F予算',
  budgetDrinkCost: 'D予算',
};

const INVENTORY_SHEET = '月次集計';
const LOSS_SHEET = 'ロス記録';
const SETTINGS_SHEET = '店舗設定';
const NOTE_SHEET = '申し送り';        // 店舗×月のメモ（E）
const ACTION_SHEET = '改善アクション';  // 要確認店への施策記録（F）
const GROUP_SHEET = '店舗グループ';    // 店舗のエリア／ブランド分類（ロールアップ用）
const TARGET_SHEET = '原価目標';       // 店舗ごとの目標原価率（%）
const STORE_MASTER_SHEET = '店舗マスタ'; // 任意。[インフォマート名, FWキー] があれば STORE_MAP を上書き/追加（無ければ従来通り）
const DATA_MONTHS_CAP = 24;            // 起動データは直近何か月分を返すか（全期間肥大・キャッシュ超過を防ぐ。トレンド/履歴に十分）

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

var APP_FAVICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAQAElEQVR4AYyZCbxd47nG373POZkTRZBI1VC0plQRJDXV1IRIIiFaM1GkhlBDUa2rVxW3VNHp50e1pS291WoNQRDzFBLa4hJDImROTnLmPa37f95vfWuvfZKW5Hu+932fd/iGtfaaTrF15ZJk7eplSdua5UnH2pVJZ9uqpKt9ddLdIbQiPy3WEJtDJ3pEB7oQ7f8kFddRH7MLvY7VSRfz0vw6mWNn+6qkAcy9o22lr6Nj7QpkHe2sr611GWtdmqxZtThZveKjZOWyRUmxp7vDSj2dVu7psnKpyyrl7hQ9VnW9B7uOaqXH6iihR+R59HKKCv6qgK1c57HLeeBzHklMhZyKZOSYh+ZSxa6UephPt89NdhVfRfMWyl1WLcmHFI9dKbG2HEo97dbTBTrbrLtzrRXN/yXehw6dJj0I9XUkUfUADBEgsfhfjhzwmQOOcHpajK2RJUQ7yCwerzlCn6hOajuDHTgv6ZS6UIXB8OMRlUKcM1lX9HoKFGQQ49HRFueIOWl5/KkWvMoTsCKvOpqgoEVJ5n1eUTm9QQ3PJcBzGEv5mDSCsZ33OFFw6ImFzUQlPfEUQhWQAkGLufJxBpBMIyM28kUAGobz3ikjgkL1lguMfqQGijGKWKcGMc7FQZIaJouA91xkzMdB06KAx+NRUWJc5Dl0aALUgle7Ua9JDdHEsQHUJS4kiBVSjgBC6UNA1BWhYoJHejKspEPx7iFXWSwMDbbeCBelGhnwikakTRagpscoQR4oXxC2qvtIeU46PuclsWlkKjpo7qNuUYXdSAMl1oUSyfemAoIMeIrIQuTS4GU5iVcNXWNlwK8oVQkgCC7OJeFsSGKOeHfTiYunesarAtVwa2NiDUnCiXKHghyqqzixfgYoUB5KIEQHyBbcHyq5qmRXQhgqivwMhdFQI7Pl7wXVdsDTKIuFEiaYL0N9auP1Hk9WVoriBenuS6MohUmuGoZihHxc0YsSEEkFRGRcKBPLYtEoGPxewX1ZnnyqmQcRveNZMVQalOVgS19vvMYViMGfjYcOS2Mu5NJCXc4ijQGLTy3kKVyafOEuAONJSIVlUJQcOcRBnSIwFFcgRtrcR+ex1FSMIiLSMAQMcZoIMw522uMJme4XmTLYNFKCjYfGCJA013FSDi5YoZczTXEPtkx+ApjSNBwkmSEBe109MATQuLApXrkOOreRuVzfBHjJODHzI5PmE8sM6j2xeb/74GgmhBnUx1DdjJcCPIcZeiw2xWmBVa9CLmHZAEVipjU9ni4UDjymckAIgiVV5VMtDfCcBg9+Fis+iyaWRi0YyklXimKSWmKlaoet6nrPPm6f62jtXmDlWheTZMO4+JGFrrpoWTI+dFiVcn8YgBgY8cEOA9LL4eAn4KYneSAJGLkmfw4MlC8mXXmCV8RfYyHlSpctaX/dPmx7zj5qf8k6SsssqTFRr1+vp7wkXVhbabG9v+ZxW9Txoq3sfstWdL3l+QvXPm1dlTXmm0SqZBxLOpRXjZyMhE4gCdo1VzFoIUMsF8G4VpHoLECRXhhdkgya/IJiImQLuCOF7CyvsPmtD9vyrn/amp4Ftqp7PgubzRF91WrpGaG6go/FhrX3LLZF7S9yBrR5MfexCBmdlRW+EZVaieoJKSmw5HcwV4XjQTAnt2XhTXU0cpWEXwKEn4AHYJHa2CuQIgiaJ2tiCUcsITbPpU6r8uKzvPtNTtsOlXIU6BOr2Oqe+ba6+z02oepMmFDNusorWfwcq9Q6Y1UrWBPQ9DSKWU91jekM0fjKi+ORgBpmkzAvDFoCiPJ1hXwsC0Dkmkaom8SSio1C701qLJRJPNI1eh5w3ZVW6ywvZ/Is23MZFqmJ15IqZ8EcW9b5Bke6yyps1uruD2xB+9NsWDtFQ2su9LctB+9vnx00GoIpUjcBqhtWRk3G1VyTdNHiCUH4YOQhiVFkAJSZRV2x0lU9C4shLmN+5k3QeoEqmlgGRbDIRKe59BQayGvSyddVWWllLnblWrd1lJdx5HVq40xbsdBsLcX+1qc4wArMg4ZHY9fSijCMzWrVAL7UJpCGn0iUrOUZhcY5cRFUTHBTRkbqC5yIuiYrAlaVeqGlaRCTH0gQfnpvUUUO6fM523zAHta/eSPrS+zwAbvaZv13sQJv5ho/oV5Ptc0+bH8OvMjx1YXT/F9LcWC2WMJcp3Nf6BhgfQt3mk5JHoiOlMkZgJZv7vPOSwUtF6AsR45DVZwW0FLsZxv13Y5NLDA3WMVSSQvTojcfuDsb1A9/8BU52hv33daG9vsiR7uQVuK6wFnSU211O+GMKlqLbdCyRZaHYvV/1GKMuh28YehGX+JkPbKoSXuu4px3xik3Y6dEIdqpVFrvjA36bGFbDBrjR7mZ07ilOMg26bcT3GgrFpqorYwULE6lhrIBQ/vtaEVrZvaqav5PWnOhnw3rv6s1s7lOZp28QkZQO033uTb66lHS5EusKDUAIrRgep/Y6WeeY6dMm25fP+5k6+zSA4k7wkBp7wy50SwWija4ZXPbmgvZ1oO/atsMOcg26f9FFtDfQzk1wix9koEqWIGzYHv74LXE3ntjjbUU+CkVBpqO+oiBo2wDfjqKIZGEOBhq2lRK8No+kdSxXkE+TS7fAB0LGaF40LwQQQsXLrI5r7xq/3rjLevbp4+XVvyqVavso48XB3yUytReuXKldXZ22rx5/7J/vv6Ovf7am+j/sLlzX7O5r84zyVWrV6cD5URSsF/e9Ce7fMYddsHJd1hl8dY2YuCeNqhlmBUKimNCEjlo0UKY+7r+ECo+AgaVhmKcAamWCki0UBHdrE/fPi77IotN2i/8MNdcd4ONO3xywHhkDpdfcZW9+/77djJnzjo47Vt2MnjhxTlUiU1bmtgzzz5vHyxY6OTKlatsyy23tIJbYUxX6WRpisKnWbjiIhSvfMqg+k8gM/3ohs7d3jU1NaWy2aX76ymB+4S+D2fO4EGDrF/fvrlIFQkL1+RU97d3/THzHzF+nA3o3y+zpXhGvYNKbNWq1Zyhc9eDV517eU7wtba2Ek9TPoLVa0gruq0ZCE65Fy1MrhjOPWvS0ffg4M/3s2c9YHNemJ2nVD+zTz7xWHvmyYftu5demHFSvJx3ZvNee91efvlV0Y4HHnzYDvraxAYcjH3w2Il24KETbJ/9x/rPcs4rc+2bZ85YD86DO89Onx4wd97r1NWaEKxOvaBzWjIgnUwMczKcg66GTkGAFmyzpuYmkJ4hkVxHNlQNG5TW0K3pxpt+2ZDR1t5u+hmsD6tXt1oH15iWlhYrFAoNeZ9sxEFDZDHMJBjqlyxbZvPnv2vvvf+BLVjwIX8sKYu2Gm9yCxcudP4d/JqgO9Sppp9BMtYPhfQeK0QmNvPhR/0MkD10443tyisuDfj+pbbhhp8RbQMGDLArsa/43nc4ky6w886dbkMGDzLLrX/6Gafa808/kuGb006y9f5jMvFw+JMgNieFerM7+R1OPvp4mzT5G3bEpKn2/gcLvEZHR6eNn3SMTZpyrE2ZeoI9+9wLzqt7mbvECy/lL2piQz1pDpmCG+pkJP4bvu76m0Q4LrrgHJvA799xxDgbOHCg87oDTcCeNOEwO2ryBDvp+K/bZptt6r7YNXG90sU6opkzM/r8+GhIiFQYi+YuAOFaKsM7uxsWf//BMisWOWGikZPfvvAym37W+Tkm7m+g7vjt723fA8ba1ddcH4i011l1+fevMp3Sog786n526CEHSv03oC6z12IQHlPInwJakbN0ChBQQyNX/l5cWJFIQLPzZpxlr778tL32yrP2gysvD7n0gznd5sLPm/OMvfLik3bIwV+FDe0L229rO+zwhWDEXsVSvVQqmX4y3T09KRO2fPmKlbbx0I1MR2yDDYbYjLPPsLa2tgZok5Sk7whr17aZ0Nq6xpYvX2FLly23/Pq1MVqjoOEF6/VP2xAp+bkLSKQUajOnkU4l4+Iy8+FZqcOsXK7Y3ffcC12w5uZmayqGvVPArb+6ye767a1S14vjj51qs2b+1S664NwG/6abDLXmpmbr6SnZmjVrbeKU42y/Aw9vwMc8XClJ/v0PGm8HHDze7wJfO3yKfefSK6wgZwTzp7H+0BtadDVK/L5bZukqIDy4vj/a5RdefDnL6+7utquvvd6efOqZjMuUmJ4RUkRKmvUf0N+GDt3YBvEsEJh6X2xKp1CnPrVW1EHgQMWEMPv6uOIbkfpSoQ3y0TM7RrM7sx57wiqVSmQy+YOrrrXW1lbfroz8JIUBdKvTgL1DJ08ab7+45Xq7/dZb7De3/dxxBzJCZ4ly9CAVuJ8Re7PnfOvMaZwBBbk/HZhHnENU2QBX6wti8ar20MxHJdbBCh5Rr772hnX4WHg9jv9I7ci1Y+8997COjg57iJ/cQ488ZkuWLLWRu+wEdswexXVFH7nLjjZy551s15G72J6jdrfdd/tSY+107oEM6wp6mJ0zdDTo0LMBqU5yoMwWL15ir7w6D0e96bogiHnyqWdt0aKPpDr0hLb3Pge77h2FwhF3y+5/YKaddsa59us77gqE9x4U37nsw0Uf2x+5xvzx7j/bu+99QAR++oYGpdNcCEsyy/0CwkFkHVlRy/0jt27VjWLISl1KRr3v7w9Sox4ExYNIfzv15ONt/32/Yvfe8zsbMWJz0Y5SuWylUnhgcqJXt5gjqg2NLzrupjzNVXW6E0gKffq0SDRgDXeAqceeYlOPPdWOPOoEGzv+aMtfozw4nb/qCs5lnZiwdU7JZPHcBdzMumqtan+57363dZHZaMPwJCZi+hnT7Kc/ucY233wYd4X6gmfe/782e1bIUVxvjP3aQXbLT68z3Q2iz8ePBhPR3SeaustAcRAiY/4kOv/d9+1dsPDDRX4bLBabOAPq1wDVFOpZ69OIoEUPPwFZQqBmP/mM/wZlHXjAfly9h0p1FIv1wdrawlfcQqFAzMam5wQPWk+3xWdH2JjRe9l2236+l1fjCmaFIlOx8K/IOOFYBZ/Yfv36mS56wumnnWTTOBuHbryhXOuB8iJyblFuqjrA9lGRbHjo77zrbg9Rd8Lxx0g0QGeZoIcYOT7DA0xTU5PUBvBFsMFe19B4KYta31pxjZaYfv362rRTjrNpJx9nZ7AB3zrzVNt6660sHxmuOxRTgoQg3SEDhOaMsWrfAKR0mzfvHxZeG82+vOtI+9LIndPAILRwBVYqZYsPKPlrQYhSRMIpy0gpoYcdsQEpKaEQQJP1yUgDJRyaUCG/BZRwB5JWkx8Zm1y959BwEfxo8WI7bNyhpsfSk074hu9LTA4ylNDbYJkLn7jtt9sWIV5ATdva9Ccic/CQQRKNIJzGGKFvdKZWrwVUeSN96+35pjvFRZdcwZ1lhuVPAR2Us2ZcbBdf9l/2vSt/ZDMffsziP/2Eou4yrc1FME4gscPGHmo//MHl9rd7/2D77juGzYo+T8m651+oPyHu9uWRfrFK62UxC3h1jsbwYZtF641E9gAACUhJREFUtZdU/V6Um/AUbF2zxsrp3UXvAAceMtGOO/F0+/FPfmZPzH7avwnkj//w4cO4S42xx5942h6aOct0sVS5IYMH8/ywo1Q2HEFtem/hJ+CqusQDhgwZYsXep5bcQC8nuk2i8k7Q5Bc36eH3Jy3gpdzXnS9sv916N0k5a3gH0LeH+Nqt7D/9+T47bOIxfA06MrzwQGrcdh6W9Hq8z1f2tvPOOdP++4pLOAHyW5DYzjvvYPl/G2+0oV179ff9Nu6TyDvZZ98AZJ323akz8XekCXBKmBa/kC/FShi1x25WqVb5vdesq6tblGPx4qV8L3jR9c9vsxXv7ZugJ8RVkfW2Zu1amzTleDv666fY7bmHpEU8FC1dypseoXomGLXHl+2s6dPsjttusccf/ovd+OMfcks92u8qiR8yAmmao472jLNPt0summE/v/l/OJvvsj123xVv2nx9WonsxHwDtDMpL7YBtWrN7SpSC7/hxp+5re60U0+08y+41EaNPtD0liZO0NGssjHSdeu77dd3mo7qs8+FTRHf0qfZPsOZNm5s7glSDrDN1lvacd842m6+8Rp7/JH77Bc3/9hO4bvizjvuYOGOo2UHaNGkeCvz7jJi8+G+OVOOHG+jWLg2UE4dUiHo0pRv2gAZKd2wC+IT01OevD28y5993sXW3h7+7H3Y2EO4U+xiuifrVM5PRPHCiBHD7bJLvm2PPPq4XXPdjfbYE0+JtkKhYF/kZyFDzwia5FfG7GWXXDzD7v/rH+yeP9xu588400bvNWqdL8matmamXEGLlhTC9SLvDUc6MOoFRdbRcBeo0wxDrPZDCxevRU4//VSbzNubLmoXXXiOaD5m9HWp+/SY0Xvapd853/SC04cPlldd+V0+aQ3gOrGnx6grFAr2zWkn8jQ53E/eAw7Yxx556F776Q1X+6euYcM2zc9aKYD5EM2U0BtbiW8JkenpbvzgEuLVA5riVIlSYQwI7gL0DY2QNFj0b27/hT3x6N/swb/fw1egA+zyyy603//uVttg8BAvsuuXdrGnHn/Anpn9EKfstb6IX/38Brvxhh/ZSN7o9PPa8nNb2ES+553F6+vdd93mZ41qq8CwzTaxQQMHRFNU0L1nLsw2Nx1nvdPRAfq5XHzB2fzmz7V99x1tihVCITQaJTwlk67gIJ9rAEokCIOjjy0xTVDPBcP4AOm/P8J1l4hTa2lp9qNcKBRiElfcAbbXqN2YA8GwE/mQ+b3vXmSn8BS3zTZbwYgXUNWkCtJBrJ2jYNOmCQqpud2229hRUyba5COP4EwbBassQPNlwTQ08RCp0DUgzDPUjLSkQKSaVKAYTY4MsY4333qb73Rr/SVFt6m3eVDR+8Sb//c27/idfEZf4J+7nnv+JVvF9/zFS5Z4nrq//PUBrg+z7fV//Mv/BrCY1/BQX94APXPoGUCf5GY99qTpGvTkU8+ZXoyYUrrGuuaEzJCe9iLqkJY6wgZEw5NDFyhFAhps6IOj3uvd/cGHHvUXqDf4A+oyPlbqjxnvvvuBvfzKPLufv/As5W8NXd1d9uvf3Mln93usUqmafq+6Thx68P62Cx86dIF8jgesClfyrDpDdvO71pfqpmLBWvkY+sisJ8yyk40AZmb6l1NlBmg7hXDIFBJ4egx5in5U1VFIBC6P1kWPGGedcEfvLkToW98mfOCs8OG0mW/x+gKsyCVLl9pmm27iZ4A+fY8YPtxG7z2KD6FNpr8XruAvzLO4M7z22j9Nt83Ork5bwZdiHfF33nnP4ri6feqPNB2dHVYoFGzJ0mU+r/nz3w8hmgbRoclI3C/NOa1PBpCq65IiCNIZACvNI6lXw0WUb0BSIzZv53V8xB7O7fDwcYfYtvwW92Zx+lSl9/7Dxh1sR0+ZwO9zgu2x26525ITDbepRk3wDEtVlzBOOm2r77TPGRo7cyaYePcmOPeYoNmxTGzxoINeV/j72AfuNMT0rbLnV5/zZYOKEcXbU5CNMD1hCks1Vc2NO2Hp4a+RZF3zCuGiWR5FRmIqSAQtSco3AxBPg1pEMwktJQqxiavgF6QE1jhJDwFMYhYZeKOi81Wab5eObmjQFeJqRkKRj66KbkKdYIYFXCY1LmEkm+AOYE37FCYFj7pqjgC9xwHmO9kC68ddhEQTVBA9SMZxapHyC9BQhLvFFhMEUnwN1fHKS5NaoWUdiCVyGtGYiSZz4Gv460rryq56AX3GJx9eYh5Agk1BbMR5fww6oyc7yEo8NY9SsWCOhFotJT1F1WbMaj7Q1CgjVVEoPqFqQxMnH43Le1ue1vJ3pisvVjXxj/bS2YlW7AcHXEK84gU96sV5dsmhfT2LK8c3DTtgUNqBqSTU4tBFKyibuBeULqJEUUEsXTmFyaxH4NUBEiCUG3nXVE3wxga/ii6g5n9bO1awRU0t9VWQVW6gh62OneeJyUFzVc6osvhrmzRzE1eCLUnzBIrk9VasVP+qSlVrFBOl5VDh6AcGvGAe5VXwBFa7sARV4B0enIkQbWW1AlRyBPMauCpm/ahWvjS/j0BXjqNZz8VdSqH4NvUpuDUgK0musuSijgkP334CqZbKMLnBvDlzFfVVudwFVq+KvYusWmI+psJkBFauSn4HYauarUi+PCraQctQONapW9pycz+00Tjp1K4xTQQ+xOR9cBV+ZdfrYko6KFeWo8HnLJUGSeuoq892vjgoTAAwSfOjE5v3Ka4BqOoiNeZKep4WUWWwKj0PH7xuJbBxH8QA++teRad0y0ueRj3WuysFiLq6nkk0oqpCS9I1P0OuvpOA+CknXq6ZLJluXFGqw+QMJtmqUGKhErvR6fNnqeoVX7RRsdikiza/HKadEXsmyGMWmcapfKuPDbshRTATzkK+Uiwlrq1rRF893NzkFLTST/F2/7NAk6tBfgUrwAWUrKT9FGZkhN6C4fJx0cWXqlP9djvLxKVb493EVNqicQbFCFs8Gua56vhkV0xr1dbuY7UwciGAlN4IdZqI9KUqKoVgpwnNDTIkYIcb24HMoFr3kyMeWLXC9ZRrDWJqj8J/Gy9coe06JDQlwXzp+GVl2fxl/mTPAdyQYZTmZYFmLIKgkSIdTkTKyEQyAv6w4cks5lNEd8kcQV3bUxythZyCulKG8no0pwUUEf4k51dHo842Xn7mUqFtOZQkpXWf//wMAAP//3rhHlwAAAAZJREFUAwCvqiZOJT9VOAAAAABJRU5ErkJggg==';

function doGet(e) {
  // 委任入力（店舗×月の署名トークン付きリンク）: 管理パスコード不要で、その店・その月の
  // ロス/理論原価だけを入力できる専用ページ。/exec?input=1&s=店舗&ym=YYYY-MM&t=署名
  if (e && e.parameter && e.parameter.input) return inputPage_(e);
  // 月次LINE送信用: 各店舗の入力リンクを返すJSONエンドポイント（キーで保護）。
  if (e && e.parameter && e.parameter.links) return inputLinksEndpoint_(e);
  // セットアップ支援ページ（要パスコード）: 設定すべき値を表示し、宛先シートも自動用意する。
  if (e && e.parameter && e.parameter.setup === 'links') return setupPage_(e);
  // 配布用ページ（要パスコード）: 店舗ごとの入力URLを一覧＋コピーボタンで表示（担当者に手で送る用）。
  if (e && e.parameter && e.parameter.share) return sharePage_(e);
  // GASはコンテンツを別オリジンのiframe内で描画するため、iOSではiframe内の
  // localStorage（保存パスコード）が保持されず毎回ログインになる。対策として
  // URLに ?p=パスコード を付けておくと、それを画面に埋め込んで自動ログインする。
  // （合致しないときは空を埋め込み、通常どおりログイン画面を出す）
  var tpl = HtmlService.createTemplateFromFile('index');
  var p = (e && e.parameter && e.parameter.p != null) ? String(e.parameter.p) : '';
  tpl.AUTO_PASS = verifyPass_(p) ? p : '';
  var out = tpl.evaluate()
    .setTitle('棚卸')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // ホーム画面用のPWA入口ページ（GitHub Pages）から全画面iframeで表示できるように許可。
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  // ブラウザのタブ／ブックマークのアイコンを棚卸アイコンに。
  // data URIが弾かれる環境でもアプリが落ちないよう try/catch で保護。
  try { out.setFaviconUrl(APP_FAVICON); } catch (e2) {}
  return out;
}

// ─── 委任入力（店舗×月の署名トークン付きリンク）─────────────────────────────────
// 店長に「その店・その月だけ」入力してもらう共有URLの仕組み。管理パスコードは渡さない。
// トークン = HMAC-SHA256(店舗|月, 秘密鍵) なので、他店・他月のリンクは偽造できない。

const INPUT_SECRET_PROP = 'INPUT_TOKEN_SECRET';   // 署名の秘密鍵（無ければ自動生成して保存）
const INPUT_LINKS_KEY_PROP = 'INPUT_LINKS_KEY';   // links エンドポイントの認証キー（LINE送信役が持つ）
const EXEC_URL_PROP = 'EXEC_URL';                 // 明示指定したい場合の /exec ベースURL（未設定なら自動取得）

function inputSecret_() {
  var pp = PropertiesService.getScriptProperties();
  var s = pp.getProperty(INPUT_SECRET_PROP);
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); pp.setProperty(INPUT_SECRET_PROP, s); }
  return s;
}

/** 店舗×月の署名トークン（URL安全なbase64、末尾=を除去）。 */
function inputToken_(store, ym) {
  var raw = Utilities.computeHmacSha256Signature(String(store) + '|' + String(ym), inputSecret_());
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

function verifyInputToken_(store, ym, token) {
  return !!token && String(token) === inputToken_(store, ym);
}

/** 店舗キー(0001015_店名) → 表示名(店名)。 */
function storeDisplayName_(key) {
  var s = String(key || ''); var i = s.indexOf('_'); return i > 0 ? s.slice(i + 1) : s;
}

/** 店舗キー(0001015_店名) → 短縮ID(0001015)。入力URLを短くしてLINEで開きやすくする。 */
function storeIdParam_(key) {
  var s = String(key || ''); var i = s.indexOf('_'); return i > 0 ? s.slice(0, i) : s;
}

/** URLの s=（短縮ID or 完全キー）→ 実際の店舗キー(0001015_店名)。IDなら前方一致で復元。 */
function resolveStoreKey_(s) {
  s = String(s || '').trim();
  if (!s || s.indexOf('_') >= 0) return s;   // 空/既に完全キーはそのまま
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var keys = allStoreKeys_(ss);
    for (var i = 0; i < keys.length; i++) { if (keys[i].indexOf(s + '_') === 0) return keys[i]; }
  } catch (e) {}
  return s;   // 見つからなければそのまま（トークン検証で弾かれる）
}

function jsonOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** 委任入力ページ（input.html）を返す。 */
function inputPage_(e) {
  var s = resolveStoreKey_(String(e.parameter.s || ''));   // 短縮IDでも完全キーでも受ける
  var ym = String(e.parameter.ym || '');
  var t = String(e.parameter.t || '');
  var tpl = HtmlService.createTemplateFromFile('input');
  tpl.STORE = s;
  tpl.YM = ym;
  tpl.TOKEN = t;
  tpl.STORE_NAME = storeDisplayName_(s);
  tpl.VALID = verifyInputToken_(s, ym, t) ? '1' : '';
  var out = tpl.evaluate()
    .setTitle('棚卸 入力 ' + storeDisplayName_(s))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  try { out.setFaviconUrl(APP_FAVICON); } catch (e2) {}
  return out;
}

/** 'YYYY-MM' の前月。 */
function prevYm_(ym) {
  var y = parseInt(ym.slice(0, 4), 10), mo = parseInt(ym.slice(5, 7), 10);
  return Utilities.formatDate(new Date(y, mo - 2, 1), 'Asia/Tokyo', 'yyyy-MM');
}
/** その月の日数。 */
function daysInMonth_(ym) {
  var y = parseInt(ym.slice(0, 4), 10), mo = parseInt(ym.slice(5, 7), 10);
  return new Date(y, mo, 0).getDate();
}

/**
 * 入力ページ用: その店×月の「棚数値の土台」を返す（FD合算）。
 * ロス（廃棄/必要/理論原価）は含めず、クライアント側で下書きと合算して即時計算する。
 * 理論原価は会社ルールの2%込み（inc2でないなら売上×2%を加算）に正規化して返す。
 */
function inputMetrics_(store, ym) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var m = {}; var kind = '';
  Object.keys(METRIC_SHEETS).forEach(function (k) {
    var sh = ss.getSheetByName(METRIC_SHEETS[k]);
    if (!sh || sh.getLastRow() < 2) { m[k] = 0; return; }
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][0]).trim() === ym && String(v[i][1]).trim() === store) {
        var kd = String(v[i][3] || '').trim();
        if (m[k] === undefined || kd === '確定') { m[k] = Number(v[i][2]) || 0; if (kd) kind = kd; }
      }
    }
    if (m[k] === undefined) m[k] = 0;
  });
  // 棚卸高（月次集計）: 当月・前月。店舗マスタ(任意)で表記ゆれを吸収。
  var storeMap = buildStoreMap_(ss);
  var pym = prevYm_(ym);
  var invCur = null, invPrev = null;
  var invSheet = ss.getSheetByName(INVENTORY_SHEET);
  if (invSheet && invSheet.getLastRow() > 1) {
    var iv = invSheet.getDataRange().getValues();
    for (var j = 1; j < iv.length; j++) {
      var iym = String(iv[j][0]).trim();
      var skey = storeMap[String(iv[j][1]).trim()] || String(iv[j][1]).trim();
      if (skey !== store) continue;
      var val = (Number(iv[j][2]) || 0) + (Number(iv[j][3]) || 0);   // フード+ドリンク
      if (iym === ym) invCur = val; else if (iym === pym) invPrev = val;
    }
  }
  // 2%込みフラグ
  var inc2 = false;
  var setSheet = ss.getSheetByName(SETTINGS_SHEET);
  if (setSheet && setSheet.getLastRow() > 1) {
    var sv = setSheet.getDataRange().getValues();
    for (var s = 1; s < sv.length; s++) {
      if (String(sv[s][0]).trim() === store) { inc2 = (sv[s][1] === true || String(sv[s][1]).toUpperCase() === 'TRUE'); break; }
    }
  }
  var sales = m.sales || 0;
  var purchase = (m.foodPurchase || 0) + (m.drinkPurchase || 0);
  var theory = (m.foodTheory || 0) + (m.drinkTheory || 0);
  if (!inc2) theory += ((m.foodSales || 0) + (m.drinkSales || 0)) * 0.02;  // 2%込みに正規化
  var hasData = !!(sales || purchase || theory || invCur !== null);
  return {
    hasData: hasData, sales: sales, purchase: purchase, theoryBase: Math.round(theory),
    invCur: invCur, invPrev: invPrev, days: daysInMonth_(ym), interim: (kind === '中間')
  };
}

/** 入力ページの現在値（その店×月のロス/理論原価一覧＋棚数値の土台）を返す。トークン必須。 */
function getInputPageData(store, ym, token) {
  store = resolveStoreKey_(store);
  if (!verifyInputToken_(store, ym, token)) return { ok: false, authError: true, message: 'リンクが無効です（月やリンクをご確認ください）' };
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(LOSS_SHEET);
  var items = [];
  if (sh && sh.getLastRow() > 1) {
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var r = v[i];
      if (String(r[1]) === ym && String(r[2]) === store) {
        items.push({ id: String(r[0]), kind: String(r[3]), cat: String(r[4]), memo: String(r[5]), amount: Number(r[6]) || 0, ts: String(r[7] || ''), name: String(r[8] || '') });
      }
    }
  }
  var metrics = null;
  try { metrics = inputMetrics_(store, ym); } catch (er) { metrics = null; }
  return { ok: true, store: store, storeName: storeDisplayName_(store), ym: ym, items: items, metrics: metrics };
}

/** 委任入力からロス/理論原価を登録する。トークン必須（管理パスコード不要）。 */
function saveInputLosses(store, ym, token, items) {
  store = resolveStoreKey_(store);
  if (!verifyInputToken_(store, ym, token)) return { ok: false, authError: true, message: 'リンクが無効です（月やリンクをご確認ください）' };
  return writeLossItems_(store, ym, items);
}

/** 委任入力から1件削除する。トークン＋店舗＋月＋IDが一致した行だけ消す（他店を消せない）。 */
function deleteInputLoss(store, ym, token, id) {
  store = resolveStoreKey_(store);
  if (!verifyInputToken_(store, ym, token)) return { ok: false, authError: true, message: 'リンクが無効です' };
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(LOSS_SHEET);
  if (!sh) return { ok: false, message: 'ロス記録シートがありません' };
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var v = sh.getDataRange().getValues();
    for (var i = v.length - 1; i >= 1; i--) {
      if (String(v[i][0]) === String(id) && String(v[i][1]) === ym && String(v[i][2]) === store) {
        sh.deleteRow(i + 1);
        CacheService.getScriptCache().remove('dash_v2');
        return { ok: true };
      }
    }
    return { ok: false, message: '該当の項目が見つかりません（既に削除済みかも）' };
  } finally { lock.releaseLock(); }
}

/** 全店舗キー（月次集計の各シートに現れる店舗）。入力リンク生成用。 */
function allStoreKeys_(ss) {
  var set = {};
  Object.keys(METRIC_SHEETS).forEach(function (key) {
    var sh = ss.getSheetByName(METRIC_SHEETS[key]);
    if (!sh) return;
    sh.getDataRange().getValues().forEach(function (row) {
      var ym = String(row[0] || '').trim(), store = String(row[1] || '').trim();
      if (/^\d{4}-\d{2}$/.test(ym) && store) set[store] = true;
    });
  });
  return Object.keys(set).sort();
}

// このアプリの公開 /exec URL（外部の担当者が開ける安定URL）。
// ScriptApp.getService().getUrl() は実行中デプロイのURLを返し、外部から
// 「ファイルを開けません」になる場合があるため、確定URLを既定にする。
// 別デプロイへ移す時だけ スクリプトプロパティ EXEC_URL で上書きできる。
const KNOWN_EXEC_URL = 'https://script.google.com/macros/s/AKfycbyvVFWDpXDnjDP9r7PvzlCYSycCcKtDe6fpd_lykXywETy51Y-s3kF1YoryDmpnn3621Q/exec';

/** /exec のベースURL。誤爆防止のため確定URLを最優先で使う（自動取得は @HEAD 等の
 *  外部で開けないURLを返すことがあるため使わない）。移設時のみ定数を書き換える。 */
function execBaseUrl_() {
  if (KNOWN_EXEC_URL) return KNOWN_EXEC_URL;
  var u = PropertiesService.getScriptProperties().getProperty(EXEC_URL_PROP);
  if (u) return u;
  try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; }
}

// 入力ページの「iframe包み」(GitHub Pages)。script.google.com を直接開くと
// 複数Googleアカウント環境やLINE内蔵ブラウザで「ファイルを開けません」になるため、
// Google以外のオリジンに包んで配信する（site/t.html）。担当者に配るのはこのURL。
const PAGES_INPUT_URL = 'https://amami-cell.github.io/-/t.html';

/** 担当者に配る入力URL（Pages包み経由・署名トークン付き・LINEはSafariで開かせる）。 */
function inputShareUrl_(storeKey, ym) {
  return PAGES_INPUT_URL +
    '?s=' + encodeURIComponent(storeIdParam_(storeKey)) +
    '&ym=' + encodeURIComponent(ym) +
    '&t=' + encodeURIComponent(inputToken_(storeKey, ym)) +
    '&openExternalBrowser=1';   // LINE内蔵ブラウザ回避（端末の既定ブラウザで開く）
}

/** 指定月の、各店舗の委任入力URL一覧を返す（LINE送信役が使う）。 */
function inputLinks_(ym) {
  var base = execBaseUrl_();
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var keys = allStoreKeys_(ss);
  var stores = keys.map(function (k) {
    return {
      key: k, name: storeDisplayName_(k),
      url: inputShareUrl_(k, ym)
    };
  });
  return { ok: true, ym: ym, base: base, stores: stores };
}

/** アプリ内から呼ぶ: その店の各月の入力URL（署名トークン付き）を返す。催促時にコピーして送る用。 */
function getStoreInputLinks(pass, storeKey, yms) {
  if (!verifyPass_(pass)) return { ok: false, authError: true };
  storeKey = String(storeKey || '').trim();
  if (!storeKey) return { ok: false, message: '店舗が不正です' };
  var base = execBaseUrl_();
  if (!base) return { ok: false, message: 'アプリURLを取得できませんでした' };
  var list = (yms && yms.length) ? yms : [Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM')];
  var links = {};
  list.forEach(function (ym) {
    ym = String(ym || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    links[ym] = inputShareUrl_(storeKey, ym);
  });
  return { ok: true, links: links };
}

/** links エンドポイントの認証キー。未設定なら自動生成して保存（セットアップを楽にする）。 */
function inputLinksKey_() {
  var pp = PropertiesService.getScriptProperties();
  var k = pp.getProperty(INPUT_LINKS_KEY_PROP);
  if (!k) { k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); pp.setProperty(INPUT_LINKS_KEY_PROP, k); }
  return k;
}

/** links エンドポイント本体。キー必須（一致しなければ拒否＝fail-closed）。 */
function inputLinksEndpoint_(e) {
  var need = inputLinksKey_();
  if (String(e.parameter.k || '') !== need) return jsonOut_({ ok: false, error: 'forbidden' });
  var ym = String(e.parameter.ym || '');
  if (!/^\d{4}-\d{2}$/.test(ym)) return jsonOut_({ ok: false, error: 'bad-ym（?ym=YYYY-MM）' });
  try { return jsonOut_(inputLinks_(ym)); } catch (err) { return jsonOut_({ ok: false, error: String(err) }); }
}

// 月次LINE送信の店舗↔グループ対応シート（Python: tools/tana_month.py が読む）。
const LINE_STORE_DEST_SHEET = '店舗LINE宛先';

/** 「店舗LINE宛先」シートを用意する。無ければ作成し、現在の店舗名を1列目に前入れ（グループIDは空）。 */
function ensureStoreDestSheet_(ss) {
  var sh = ss.getSheetByName(LINE_STORE_DEST_SHEET);
  var created = false;
  if (!sh) {
    sh = ss.insertSheet(LINE_STORE_DEST_SHEET);
    sh.appendRow(['店舗', 'グループID']);
    created = true;
  }
  // 既存の店舗表記を集める（重複前入れを防ぐ）
  var have = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { var v = String(r[0] || '').trim(); if (v) have[v] = true; });
  }
  var keys = allStoreKeys_(ss);
  var add = [];
  keys.forEach(function (k) { var name = storeDisplayName_(k); if (!have[name] && !have[k]) add.push([name, '']); });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 2).setValues(add);
  return { created: created, added: add.length, total: keys.length };
}

/** セットアップ支援ページ（要パスコード）。設定値を表示し、宛先シートも自動用意する。 */
function setupPage_(e) {
  if (!verifyPass_(e && e.parameter && e.parameter.p)) {
    return HtmlService.createHtmlOutput('<meta charset="utf-8"><body style="font-family:sans-serif;padding:20px">パスコードが必要です。アプリのURLの末尾に <b>?setup=links&amp;p=あなたのパスコード</b> を付けて開いてください。</body>')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var key = inputLinksKey_();
  var base = execBaseUrl_();
  var sheetInfo = { created: false, added: 0, total: 0 };
  try { sheetInfo = ensureStoreDestSheet_(ss); } catch (er) {}
  var ym = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var testUrl = base + '?links=1&k=' + encodeURIComponent(key) + '&ym=' + ym;
  var html = '' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<body style="font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:18px 14px;color:#1f2937;line-height:1.7">' +
    '<h2>棚卸 月次入力リンク：セットアップ</h2>' +
    '<p>下の2つを <b>GitHubのSecrets</b>（Settings → Secrets and variables → Actions）に登録してください。' +
    '「店舗LINE宛先」シートは自動で用意しました（各店の<b>グループID</b>だけ入れてください）。</p>' +
    '<h3>① GitHub Secrets に登録（2つ）</h3>' +
    '<div style="background:#f6f7f9;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:8px 0">' +
    '<div style="font-size:12px;color:#6b7280">INPUT_LINKS_KEY</div>' +
    '<div style="font-family:monospace;word-break:break-all;user-select:all;font-size:15px">' + esc(key) + '</div></div>' +
    '<div style="background:#f6f7f9;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:8px 0">' +
    '<div style="font-size:12px;color:#6b7280">TANA_EXEC_URL</div>' +
    '<div style="font-family:monospace;word-break:break-all;user-select:all;font-size:15px">' + esc(base) + '</div></div>' +
    '<p style="font-size:13px;color:#6b7280">※ GASのスクリプトプロパティ側の INPUT_LINKS_KEY は自動設定済みです（触らなくてOK）。上の値と一致しています。</p>' +
    '<h3>② 店舗LINE宛先シート</h3>' +
    '<p>シート「<b>店舗LINE宛先</b>」を' + (sheetInfo.created ? '<b>新規作成</b>し、' : '確認し、') + '店舗名を' + esc(String(sheetInfo.added)) + '件前入れしました（全' + esc(String(sheetInfo.total)) + '店）。' +
    'B列の<b>グループID</b>に、各店のLINEグループIDを入れてください（既存の「LINE宛先」取得で拾えます）。</p>' +
    '<h3>③ 動作確認</h3>' +
    '<p>この確認用URLを開くと、各店の入力URLがJSONで出ます（今月分）:</p>' +
    '<div style="background:#f6f7f9;border:1px solid #e5e7eb;border-radius:8px;padding:12px;word-break:break-all;user-select:all;font-family:monospace;font-size:13px">' + esc(testUrl) + '</div>' +
    '<p style="font-size:13px;color:#6b7280;margin-top:18px">⚠️ このページはパスコードで保護されています。パスコードが初期値(8888)のままなら、🔒から変更をおすすめします。</p>' +
    '</body>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('棚卸 セットアップ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 配布用ページ（要パスコード）: 店舗ごとの入力URLを一覧＋コピーボタンで出す。担当者に手で送る用。 */
function sharePage_(e) {
  var p = e && e.parameter && e.parameter.p;
  if (!verifyPass_(p)) {
    return HtmlService.createHtmlOutput('<meta charset="utf-8"><body style="font-family:sans-serif;padding:20px">パスコードが必要です。URLの末尾に <b>?share=1&amp;p=あなたのパスコード</b> を付けて開いてください。</body>')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // 対象月: ?ym=YYYY-MM が正しければそれ、無ければ今月。
  var ym = String((e && e.parameter && e.parameter.ym) || '');
  if (!/^\d{4}-\d{2}$/.test(ym)) ym = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  var data = inputLinks_(ym);
  var base = data.base;
  var pEnc = encodeURIComponent(String(p));
  // 前月・翌月（月切り替え用）
  var ymShift = function (s, d) {
    var y = parseInt(s.slice(0, 4), 10), m = parseInt(s.slice(5, 7), 10) - 1 + d;
    var nd = new Date(y, m, 1); return Utilities.formatDate(nd, 'Asia/Tokyo', 'yyyy-MM');
  };
  var navUrl = function (targetYm) { return base + '?share=1&p=' + pEnc + '&ym=' + encodeURIComponent(targetYm); };
  var ymLabel = ym.slice(0, 4) + '年' + parseInt(ym.slice(5, 7), 10) + '月';

  var cards = data.stores.map(function (s, i) {
    var id = 'u' + i;
    return '<div class="card">' +
      '<div class="nm">' + esc(s.name) + '</div>' +
      '<div class="url" id="' + id + '">' + esc(s.url) + '</div>' +
      '<div class="btns">' +
        '<button class="btn copy" type="button" onclick="cp(\'' + id + '\',this)">URLをコピー</button>' +
        '<button class="btn msg" type="button" onclick="cpMsg(\'' + id + '\',this)">メッセージ丸ごとコピー</button>' +
      '</div></div>';
  }).join('');
  if (!data.stores.length) cards = '<p class="muted">対象の店舗が見つかりませんでした。売上/仕入シートにデータのある月をお選びください。</p>';

  var html = '' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>' +
    ':root{--bg:#f6f7f9;--card:#fff;--line:#e5e7eb;--ink:#1f2937;--sub:#6b7280;--brand:#2563eb;}' +
    '*{box-sizing:border-box;}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;font-size:15px;line-height:1.6;}' +
    '.wrap{max-width:600px;margin:0 auto;padding:16px 14px 60px;}' +
    'h1{font-size:19px;margin:2px 0 2px;}.lead{color:var(--sub);font-size:13px;margin-bottom:12px;}' +
    '.mo{display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:14px;}' +
    '.mo b{font-size:16px;}.mo a{color:var(--brand);text-decoration:none;font-size:14px;padding:6px 10px;border-radius:8px;background:#eef2ff;}' +
    '.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 12px 10px;margin-bottom:10px;}' +
    '.nm{font-weight:700;font-size:16px;margin-bottom:6px;}' +
    '.url{font-family:monospace;font-size:12px;word-break:break-all;color:var(--sub);background:#f6f7f9;border-radius:8px;padding:8px;user-select:all;}' +
    '.btns{display:flex;gap:8px;margin-top:8px;}' +
    '.btn{flex:1;border:0;border-radius:9px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;}' +
    '.btn.copy{background:var(--brand);color:#fff;}.btn.msg{background:#eef2ff;color:var(--brand);}' +
    '.btn.done{background:#16a34a !important;color:#fff !important;}' +
    '.muted{color:var(--sub);}.hint{font-size:12px;color:var(--sub);margin:14px 2px 0;}' +
    '</style>' +
    '<body><div class="wrap">' +
    '<h1>店舗別 入力URL</h1>' +
    '<div class="lead">各店の「URLをコピー」を押して、担当者のLINE等に貼って送ってください。担当者はロス・理論原価を入力できます（アプリに反映されます）。</div>' +
    '<div class="mo"><a href="' + navUrl(ymShift(ym, -1)) + '">◀ 前の月</a><b>' + esc(ymLabel) + '</b><a href="' + navUrl(ymShift(ym, 1)) + '">次の月 ▶</a></div>' +
    cards +
    '<p class="hint">※このリンク（署名トークン付き）はその店・その月だけ入力できます。他店・他月の入力はできません。月が替わったら上の「次の月」で新しいURLを配ってください。</p>' +
    '</div>' +
    '<script>' +
    'var YM=' + JSON.stringify(ym) + ';' +
    'function flash(btn,txt){var o=btn.textContent;btn.textContent=txt;btn.classList.add("done");setTimeout(function(){btn.textContent=o;btn.classList.remove("done");},1400);}' +
    'function doCopy(text,btn,label){' +
      'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){flash(btn,label);},function(){legacy(text,btn,label);});}' +
      'else{legacy(text,btn,label);}}' +
    'function legacy(text,btn,label){var t=document.createElement("textarea");t.value=text;t.style.position="fixed";t.style.opacity="0";document.body.appendChild(t);t.focus();t.select();try{document.execCommand("copy");flash(btn,label);}catch(e){alert("コピーできませんでした。URLを長押しで選択してコピーしてください。");}document.body.removeChild(t);}' +
    'function cp(id,btn){doCopy(document.getElementById(id).textContent,btn,"コピー完了✓");}' +
    'function cpMsg(id,btn){var m=YM.slice(0,4)+"年"+parseInt(YM.slice(5,7),10)+"月分の棚卸（ロス・理論原価）の入力をお願いします。\\n▼こちらから入力してください\\n"+document.getElementById(id).textContent;doCopy(m,btn,"コピー完了✓");}' +
    '</script></body>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('店舗別 入力URL')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── パスワード（閲覧ロック）────────────────────────────────────────────────────
// 「リンクを知っている全員」公開のため、合言葉で保護する。合言葉はスクリプト
// プロパティに保存し、画面コードには出ない。管理者はいつでも変更できる。

const PASSCODE_PROP = 'DASH_PASSCODE';
const DEFAULT_PASSCODE = '8888';   // 未変更時の初期パスワード（画面の🔒からいつでも変更可）

/** 現在有効なパスワード。未設定なら初期値 8888。 */
function currentPass_() {
  return PropertiesService.getScriptProperties().getProperty(PASSCODE_PROP) || DEFAULT_PASSCODE;
}

/** サーバ内部用: 合言葉が一致するか。 */
function verifyPass_(pass) {
  return String(pass || '') === currentPass_();
}

/** 合言葉が初期値(8888)のままか。UIで変更をうながすのに使う。 */
function isDefaultPass_() {
  return currentPass_() === DEFAULT_PASSCODE;
}

/** 合言葉は常に有効（初期値8888）なので必ずログイン画面を出す。isDefaultで初期値のままかを返す。 */
function getPasscodeStatus() {
  return { set: true, isDefault: isDefaultPass_() };
}

/** 合言葉の照合。誤入力時は約1秒待たせて総当たりを遅くする（正解は即返す）。 */
function verifyPasscode(pass) {
  var ok = verifyPass_(pass);
  if (!ok) { try { Utilities.sleep(1000); } catch (e) {} }
  return { ok: ok };
}

/** 合言葉を変更する。現在の合言葉（初期は8888）が必要。初期値への変更は不可。 */
function changePasscode(current, next) {
  if (String(current || '') !== currentPass_()) {
    return { ok: false, message: '現在のパスワードが違います' };
  }
  next = String(next || '').trim();
  if (next.length < 4) return { ok: false, message: 'パスワードは4文字以上にしてください' };
  if (next === DEFAULT_PASSCODE) return { ok: false, message: '初期パスワード(' + DEFAULT_PASSCODE + ')は使えません。別の文字列にしてください' };
  PropertiesService.getScriptProperties().setProperty(PASSCODE_PROP, next);
  CacheService.getScriptCache().remove('dash_v2');   // isDefaultPass 表示を即更新
  return { ok: true, message: 'パスワードを変更しました' };
}

// ─── プッシュ通知の購読管理 ───────────────────────────────────────────────────
// ホーム画面アプリ（GitHub Pagesの入口ページ）は別オリジンのため google.script.run
// を呼べない。そこで入口ページから /exec へ POST（no-cors・text/plain）で購読情報を
// 送り、doPost で受けてスプレッドシートの「通知購読」タブに保存する。実際の配信は
// GitHub Actions の定期実行（Python: pywebpush）から VAPID 秘密鍵を使って行う。
const SUBS_SHEET = '通知購読';
const LINE_DEST_SHEET = 'LINE宛先';   // LINE Webhookで受け取った宛先(グループ/ユーザー)IDの記録用

function subsSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(SUBS_SHEET);
  if (!sh) { sh = ss.insertSheet(SUBS_SHEET); sh.appendRow(['endpoint', 'subscription', '登録時刻']); }
  return sh;
}

function saveSubscription_(sub) {
  const endpoint = (sub && sub.endpoint) || '';
  if (!endpoint) return false;
  const sh = subsSheet_();
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === endpoint) {
      sh.getRange(i + 1, 2).setValue(JSON.stringify(sub));
      sh.getRange(i + 1, 3).setValue(new Date());
      return true;
    }
  }
  sh.appendRow([endpoint, JSON.stringify(sub), new Date()]);
  return true;
}

function removeSubscription_(endpoint) {
  if (!endpoint) return;
  const sh = subsSheet_();
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === endpoint) sh.deleteRow(i + 1);
  }
}

/** LINE Webhookのイベントから宛先(source)IDを「LINE宛先」シートへ記録（重複IDは追記しない）。 */
function logLineSources_(events) {
  if (!events || !events.length) return;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(LINE_DEST_SHEET);
  if (!sh) { sh = ss.insertSheet(LINE_DEST_SHEET); sh.appendRow(['記録時刻', '種別(source.type)', 'ID（LINE_TOに設定）', 'イベント']); }
  const data = sh.getDataRange().getValues();
  if (data.length > 200) return;   // 肥大・悪用防止の上限（宛先取得は数件で足りる）
  const existing = {};
  data.forEach(function (row, i) { if (i > 0 && row[2]) existing[String(row[2])] = true; });
  const valid = /^[UCR][0-9a-fA-F]{32}$/;   // LINEの userId(U)/groupId(C)/roomId(R) の形式に限定（ゴミ・偽装IDを弾く）
  const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  events.forEach(function (ev) {
    const src = (ev && ev.source) || {};
    const id = src.groupId || src.roomId || src.userId || '';
    if (valid.test(id) && !existing[id]) { sh.appendRow([ts, src.type || '', id, ev.type || '']); existing[id] = true; }
  });
}

/** 入口ページ（別オリジン）からの購読登録/解除を受ける。no-cors前提で応答は読まれない。 */
function doPost(e) {
  function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out({ ok: false, error: 'bad-json' }); }
  // LINE Webhook（グループ等の宛先ID取得用）: events 配列を持つのが目印。
  // 送信先グループにボットを招待/発言すると source.groupId が飛んでくるので「LINE宛先」シートへ記録する。
  // ※Apps Scriptはリクエストヘッダを読めず署名検証はできないが、ID記録のみの用途で害はない。取得後はWebhookをオフに。
  if (body && Array.isArray(body.events)) {
    // 未認証POSTでのシート汚染を防ぐ緩和策:
    // スクリプトプロパティ LINE_WEBHOOK_KEY を設定し、Webhook URLに ?k=<その値> を付けると、
    // 一致した時だけ記録する（GASはヘッダを読めず署名検証できないための疑似認証）。
    // 未設定なら従来どおり記録（宛先取得の初回設定を妨げない）。取得後はWebhookをオフ推奨。
    var wk = PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_KEY');
    if (!wk || (e && e.parameter && String(e.parameter.k || '') === wk)) {
      try { logLineSources_(body.events); } catch (e2) {}
    }
    return out({ ok: true });   // LINEには常に200を返す（Verifyボタンの空eventsもOK）
  }
  if (!verifyPass_(body.p)) return out({ ok: false, authError: true });
  if (body.action === 'subscribe' && body.sub) { saveSubscription_(body.sub); return out({ ok: true }); }
  if (body.action === 'unsubscribe' && body.endpoint) { removeSubscription_(body.endpoint); return out({ ok: true }); }
  return out({ ok: false, error: 'unknown-action' });
}

// ─── データ提供 ───────────────────────────────────────────────────────────────

/** インフォマート表示名→FWキーの対応表。ハードコード STORE_MAP を基に、任意の
 * 「店舗マスタ」シート([インフォマート名, FWキー])があれば上書き/追加する（無ければ従来通り）。
 * 店舗追加のたびコードを直さず、シート1枚で一元管理できるようにするための橋渡し。 */
function buildStoreMap_(ss) {
  const map = {};
  Object.keys(STORE_MAP).forEach(function (k) { map[k] = STORE_MAP[k]; });
  try {
    const sh = ss.getSheetByName(STORE_MASTER_SHEET);
    if (sh) {
      sh.getDataRange().getValues().forEach(function (row, i) {
        if (i === 0) return; // ヘッダー
        const raw = String(row[0] || '').trim();
        const key = String(row[1] || '').trim();
        if (raw && key) map[raw] = key;
      });
    }
  } catch (e) { /* シート未作成や読取失敗時はハードコードのまま（挙動不変） */ }
  return map;
}

/** 全データを返す（5分キャッシュ）。月・店舗・F/D切替はクライアント側で行う。 */
function getDashboardData(pass, forceRefresh) {
  if (!verifyPass_(pass)) return { authError: true };
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const hit = cache.get('dash_v2');
    if (hit) return JSON.parse(hit);
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const storeMap = buildStoreMap_(ss);   // 店舗マスタ(任意)を反映した対応表
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
      const storeKey = storeMap[rawName] || rawName;
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
        name: String(row[8] || ''),
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

  // 起動データは直近 DATA_MONTHS_CAP か月に制限（全期間肥大＝キャッシュ100KB超で
  // 黙って再読込→GASクォータ逼迫、を防ぐ）。トレンド6か月・履歴には十分な窓。
  const allMonths = Object.keys(monthsSet).sort();
  const months = allMonths.slice(-DATA_MONTHS_CAP);
  const keepYm = {}; months.forEach(function (m) { keepYm[m] = true; });
  function pickMonths_(byYm) {
    const o = {}; Object.keys(byYm).forEach(function (m) { if (keepYm[m]) o[m] = byYm[m]; }); return o;
  }
  const stores = Object.keys(storesSet).sort().map(function (key) {
    const idx = key.indexOf('_');
    return {
      key: key,
      id: idx > 0 ? key.slice(0, idx) : '',
      name: idx > 0 ? key.slice(idx + 1) : key,
    };
  });

  // 申し送りメモ（E）: [年月, 店舗, メモ, 更新日時] → notes[ym][store] = メモ（新しい行で上書き）
  const notes = {};
  const noteSheet = ss.getSheetByName(NOTE_SHEET);
  if (noteSheet) {
    noteSheet.getDataRange().getValues().forEach(function (row) {
      const ym = String(row[0] || '').trim();
      const store = String(row[1] || '').trim();
      if (!/^\d{4}-\d{2}$/.test(ym) || !store) return;
      if (!notes[ym]) notes[ym] = {};
      notes[ym][store] = String(row[2] || '');
    });
  }

  // 改善アクション（F）: [ID, 年月, 店舗, 指標, 施策, 登録日時] → actions[ym][store] = [{id,metric,text,ts}]
  const actions = {};
  const actSheet = ss.getSheetByName(ACTION_SHEET);
  if (actSheet) {
    actSheet.getDataRange().getValues().forEach(function (row) {
      const id = String(row[0] || '').trim();
      const ym = String(row[1] || '').trim();
      const store = String(row[2] || '').trim();
      if (!id || !/^\d{4}-\d{2}$/.test(ym) || !store) return;
      if (!actions[ym]) actions[ym] = {};
      if (!actions[ym][store]) actions[ym][store] = [];
      actions[ym][store].push({ id: id, metric: String(row[3] || ''), text: String(row[4] || ''), ts: String(row[5] || '') });
    });
  }

  // 店舗グループ（ロールアップ）: [店舗, エリア, ブランド, 更新日時] → storeGroups[store] = {area, brand}
  const storeGroups = {};
  const grpSheet = ss.getSheetByName(GROUP_SHEET);
  if (grpSheet) {
    grpSheet.getDataRange().getValues().forEach(function (row, i) {
      if (i === 0) return;
      const store = String(row[0] || '').trim();
      if (!store) return;
      storeGroups[store] = { area: String(row[1] || '').trim(), brand: String(row[2] || '').trim() };
    });
  }

  // 原価目標: [店舗, 目標原価率(%), 更新日時] → costTargets[store] = 割合(0〜1)
  const costTargets = {};
  const tgtSheet = ss.getSheetByName(TARGET_SHEET);
  if (tgtSheet) {
    tgtSheet.getDataRange().getValues().forEach(function (row, i) {
      if (i === 0) return;
      const store = String(row[0] || '').trim();
      const pctNum = Number(row[1]);
      if (!store || !isFinite(pctNum) || pctNum <= 0) return;
      costTargets[store] = pctNum / 100;   // シートは%、クライアントへは割合で渡す
    });
  }

  const out = {
    updatedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    months: months,
    stores: stores,
    metrics: pickMonths_(metrics),
    inventory: pickMonths_(inventory),
    losses: pickMonths_(losses),
    storeFlags: storeFlags,
    notes: pickMonths_(notes),
    actions: pickMonths_(actions),
    storeGroups: storeGroups,
    costTargets: costTargets,
    isDefaultPass: isDefaultPass_(),   // 初期パスコード(8888)のままなら変更をうながす
  };

  try {
    cache.put('dash_v2', JSON.stringify(out), 300);
  } catch (e) {
    // キャッシュ上限超過など。素通しはするが、診断できるようログに残す（月レンジ制限で通常は起きない想定）。
    try { Logger.log('getDashboardData: cache put skipped: ' + e); } catch (e2) {}
  }
  return out;
}

// ─── 申し送りメモ（E）・改善アクション（F）─────────────────────────────────────

/** 店舗×月の申し送りメモを保存（同じ店舗×月は上書き）。空文字なら該当行を削除。 */
function saveNote(pass, storeKey, ym, text) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  storeKey = String(storeKey || '').trim();
  ym = String(ym || '').trim();
  text = String(text || '').trim().slice(0, 500);
  if (!storeKey || !/^\d{4}-\d{2}$/.test(ym)) return { ok: false, message: '店舗または月が不正です' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(NOTE_SHEET);
    if (!sh) { sh = ss.insertSheet(NOTE_SHEET); sh.appendRow(['年月', '店舗', 'メモ', '更新日時']); }
    const data = sh.getDataRange().getValues();
    const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === ym && String(data[i][1]) === storeKey) { sh.deleteRow(i + 1); }
    }
    if (text) sh.appendRow([ym, storeKey, text, ts]);
    CacheService.getScriptCache().remove('dash_v2');
    return { ok: true, text: text, ts: ts };
  } finally { lock.releaseLock(); }
}

/** 要確認店への改善アクションを1件記録（F）。 */
function addAction(pass, storeKey, ym, metric, text) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  storeKey = String(storeKey || '').trim();
  ym = String(ym || '').trim();
  metric = String(metric || '').trim().slice(0, 40);
  text = String(text || '').trim().slice(0, 300);
  if (!storeKey || !/^\d{4}-\d{2}$/.test(ym)) return { ok: false, message: '店舗または月が不正です' };
  if (!text) return { ok: false, message: '施策を入力してください' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(ACTION_SHEET);
    if (!sh) { sh = ss.insertSheet(ACTION_SHEET); sh.appendRow(['ID', '年月', '店舗', '指標', '施策', '登録日時']); }
    const rec = { id: Utilities.getUuid(), metric: metric, text: text, ts: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') };
    sh.appendRow([rec.id, ym, storeKey, rec.metric, rec.text, rec.ts]);
    CacheService.getScriptCache().remove('dash_v2');
    return { ok: true, rec: rec };
  } finally { lock.releaseLock(); }
}

/** 改善アクションを1件削除（F）。 */
function deleteAction(pass, id) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  id = String(id || '').trim();
  if (!id) return { ok: false, message: 'IDが不正です' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(ACTION_SHEET);
    if (!sh) return { ok: false, message: 'シートがありません' };
    const data = sh.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === id) { sh.deleteRow(i + 1); CacheService.getScriptCache().remove('dash_v2'); return { ok: true }; }
    }
    return { ok: false, message: '該当のアクションが見つかりません' };
  } finally { lock.releaseLock(); }
}

// ─── ロス記録の追加・削除 ─────────────────────────────────────────────────────

function lossSheet_(ss) {
  let sh = ss.getSheetByName(LOSS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOSS_SHEET);
    sh.appendRow(['ID', '年月', '店舗', '種別', '区分', '内容', '金額', '登録日時', '担当者']);
  } else if (sh.getLastColumn() < 9) {
    // 既存シートに担当者列が無ければ見出しを補う（過去データはそのまま）。
    sh.getRange(1, 9).setValue('担当者');
  }
  return sh;
}

// 旧 addLoss（単数・パスコード検証なし）は未使用のため削除。ロス登録は addLosses（複数・要パスコード）に一本化。

/**
 * ロスを複数件まとめて登録する。
 * @param {string} storeKey FWシート店舗名
 * @param {string} ym 'YYYY-MM'
 * @param {string} kind '廃棄ロス' | '必要ロス'
 * @param {Array<{cat:string, memo:string, amount:number}>} items
 */
function addLosses(pass, storeKey, ym, kind, items) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  if (['廃棄ロス', '必要ロス', '理論原価'].indexOf(kind) < 0) return { ok: false, message: '種別が不正です' };
  // 全項目に同じ種別を付けて共通処理へ（従来どおり addLosses は単一種別）。
  var withKind = (items || []).map(function (it) { it = it || {}; return { kind: kind, cat: it.cat, memo: it.memo, amount: it.amount, name: it.name }; });
  return writeLossItems_(storeKey, ym, withKind);
}

/**
 * ロス/理論原価を項目ごとの種別で一括登録する共通コア（認証は呼び出し側で済ませる）。
 * addLosses（パスコード）と saveInputLosses（署名トークン）の両方から使う。
 * @param {Array<{kind:string, cat:string, memo:string, amount:number}>} items
 */
function writeLossItems_(storeKey, ym, items) {
  storeKey = String(storeKey || '').trim();
  ym = String(ym || '').trim();
  if (!storeKey) return { ok: false, message: '店舗が不正です' };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, message: '月の形式が不正です' };
  if (!items || !items.length) return { ok: false, message: '入力された項目がありません' };
  if (items.length > 50) return { ok: false, message: '一度に登録できるのは50件までです' };

  const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  const recs = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const kind = String(it.kind || '').trim();
    const cat = String(it.cat || '').trim();
    const memo = String(it.memo || '').trim().slice(0, 200);
    const name = String(it.name || '').trim().slice(0, 40);
    const amount = Number(it.amount);
    if (['廃棄ロス', '必要ロス', '理論原価'].indexOf(kind) < 0) return { ok: false, message: (i + 1) + '行目: 種別が不正です' };
    if (['フード', 'ドリンク'].indexOf(cat) < 0) return { ok: false, message: (i + 1) + '行目: 区分が不正です' };
    if (!memo) return { ok: false, message: (i + 1) + '行目: ' + (kind === '理論原価' ? '変更理由' : '内容') + 'を入力してください' };
    // 理論原価の打ち換えは「誰が変更したか」を残すため担当者名を必須にする。
    if (kind === '理論原価' && !name) return { ok: false, message: (i + 1) + '行目: 理論原価の変更には担当者名が必要です' };
    if (!isFinite(amount) || amount <= 0) return { ok: false, message: (i + 1) + '行目: 金額は1円以上で入力してください' };
    recs.push({ id: Utilities.getUuid(), kind: kind, cat: cat, memo: memo, amount: Math.round(amount), ts: ts, name: name });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = lossSheet_(ss);
    const rows = recs.map(function (r) { return [r.id, ym, storeKey, r.kind, r.cat, r.memo, r.amount, r.ts, r.name || '']; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
    CacheService.getScriptCache().remove('dash_v2');
    return { ok: true, recs: recs };
  } finally {
    lock.releaseLock();
  }
}

/** ロスを1件削除する。 */
function deleteLoss(pass, id) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
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
function saveStoreFlags(pass, flags) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
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

// ─── 店舗グループ（エリア／ブランド・ロールアップ用）─────────────────────────

/**
 * 店舗ごとのエリア／ブランド分類を保存する。
 * @param {Object<string, {area:string, brand:string}>} groups {店舗キー: {area, brand}}
 */
function saveStoreGroups(pass, groups) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  if (!groups || typeof groups !== 'object') return { ok: false, message: '設定が不正です' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(GROUP_SHEET);
    if (!sh) sh = ss.insertSheet(GROUP_SHEET);
    sh.clear();
    const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    const rows = [['店舗', 'エリア', 'ブランド', '更新日時']];
    Object.keys(groups).sort().forEach(function (key) {
      const g = groups[key] || {};
      const area = String(g.area || '').trim().slice(0, 40);
      const brand = String(g.brand || '').trim().slice(0, 40);
      if (!area && !brand) return;   // 両方空はスキップ（自動判定に任せる）
      rows.push([key, area, brand, ts]);
    });
    sh.getRange(1, 1, rows.length, 4).setValues(rows);
    CacheService.getScriptCache().remove('dash_v2');
    return { ok: true, message: '保存しました' };
  } finally {
    lock.releaseLock();
  }
}

// ─── 原価目標（店舗ごとの目標原価率）──────────────────────────────────────────

/**
 * 店舗ごとの目標原価率（%）を保存する。0以下・空は未設定として行を作らない。
 * @param {Object<string, number>} targets {店舗キー: 目標原価率(%)}
 */
function saveCostTargets(pass, targets) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  if (!targets || typeof targets !== 'object') return { ok: false, message: '設定が不正です' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(TARGET_SHEET);
    if (!sh) sh = ss.insertSheet(TARGET_SHEET);
    sh.clear();
    const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    const rows = [['店舗', '目標原価率(%)', '更新日時']];
    Object.keys(targets).sort().forEach(function (key) {
      const v = Number(targets[key]);
      if (!isFinite(v) || v <= 0) return;
      rows.push([key, Math.round(v * 10) / 10, ts]);
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

function saveGithubToken(pass, token) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
  token = String(token || '').trim();
  if (!token) return { ok: false, message: 'トークンが空です' };
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', token);
  return { ok: true, message: '保存しました' };
}

/**
 * fetch.yml を起動する。
 * @param {string} target 'fw' | 'infomart' | 'both'
 * @param {string} month  'YYYY-MM'
 * @param {string} [stores] 対象店舗ID（半角スペース区切り。例 '1015 1151'）。未指定なら全店舗。
 *                          インフォマート未取得アラートからの部分再取得に使う。
 */
function triggerCloudFetch(pass, target, month, stores) {
  if (!verifyPass_(pass)) return { ok: false, authError: true, message: 'パスワードが違います' };
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

  // 店舗ID指定はサニタイズ（数字とスペースのみ許可・重複排除・最大件数制限）。
  const inputs = { month: month, target: target };
  let storesArg = '';
  if (stores) {
    const ids = String(stores).split(/\s+/).filter(function (x) { return /^\d{1,7}$/.test(x); });
    const uniq = ids.filter(function (v, i) { return ids.indexOf(v) === i; }).slice(0, 40);
    if (uniq.length) { storesArg = uniq.join(' '); inputs.stores = storesArg; }
  }

  const url = 'https://api.github.com/repos/' + GH_OWNER + '/' + encodeURIComponent(GH_REPO) +
              '/actions/workflows/' + GH_WORKFLOW + '/dispatches';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ ref: 'main', inputs: inputs }),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  if (code === 204) {
    const label = target === 'fw' ? 'FW取込' : (target === 'infomart' ? 'インフォマート取込' : 'FW＋インフォマート取込');
    const scope = storesArg ? ('指定 ' + storesArg.split(' ').length + ' 店舗') : '全店舗';
    return { ok: true, message: month + ' の' + label + '（' + scope + '）を開始しました。5〜15分後に「最新に更新」を押してください。' };
  }
  if (code === 401 || code === 403) {
    return { ok: false, needSetup: true, message: '認証エラー（トークンの期限切れ・権限不足の可能性）。初期設定からトークンを登録し直してください。' };
  }
  return { ok: false, message: '起動に失敗しました (HTTP ' + code + ')' };
}
