"""正規化の検証。取り込み元の表記揺れをここで吸収しきる。"""
from datetime import date

import pytest

from hansoku.normalize import (
    month_end,
    parse_amount,
    parse_date,
    parse_year_month,
    store_code,
    store_key,
)


class TestStoreKey:
    def test_全角と半角の店名が同じキーになる(self):
        assert store_key("すさび湯　歌舞伎町（ＨＡＳＳＩＮ）") == store_key("すさび湯 歌舞伎町")

    def test_運営会社サフィックスの有無を吸収する(self):
        assert store_key("ＵＭＡＭＩ（ＨＡＳＳＩＮ）") == store_key("UMAMI")

    def test_異なる店は異なるキーになる(self):
        assert store_key("すさび湯 三宮店") != store_key("すさび湯 三条店")


class TestStoreCode:
    @pytest.mark.parametrize("raw", ["922", 922, "0922", "922.0", " 922 ", "９２２"])
    def test_表記が違っても同じコードに揃う(self, raw):
        assert store_code(raw) == "922"

    def test_空はエラーにする(self):
        with pytest.raises(ValueError):
            store_code("")


class TestParseYearMonth:
    @pytest.mark.parametrize("raw", ["2026-08", "2026/08", "2026/8", "2026年8月"])
    def test_月初日として解釈する(self, raw):
        assert parse_year_month(raw) == date(2026, 8, 1)

    @pytest.mark.parametrize("raw", ["2026-13", "こわれた年月", ""])
    def test_解釈できないものはエラーにする(self, raw):
        with pytest.raises(ValueError):
            parse_year_month(raw)


class TestMonthEnd:
    @pytest.mark.parametrize(
        "ym,expected",
        [
            ("2026-02", date(2026, 2, 28)),
            ("2024-02", date(2024, 2, 29)),  # 閏年
            ("2026-12", date(2026, 12, 31)),
            ("2026-04", date(2026, 4, 30)),
        ],
    )
    def test_末日を返す(self, ym, expected):
        assert month_end(parse_year_month(ym)) == expected


class TestParseAmount:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("1,234", 1234.0),
            ("1，234", 1234.0),
            ("¥1,234", 1234.0),
            ("(1,234)", -1234.0),  # 会計表記の負数
            ("30%", 30.0),
            ("", 0.0),
            ("-", 0.0),
            (None, 0.0),
            (1234, 1234.0),
        ],
    )
    def test_表記揺れを吸収する(self, raw, expected):
        assert parse_amount(raw) == expected


class TestParseDate:
    @pytest.mark.parametrize("raw", ["2026-08-21", "2026/8/21", "2026年8月21日"])
    def test_日付を揃える(self, raw):
        assert parse_date(raw) == date(2026, 8, 21)
