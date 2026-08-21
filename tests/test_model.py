"""f_actuals の1行が満たすべき制約。粒度の混在は集計の二重計上に直結する。"""
from datetime import date

import pytest

from hansoku.model import GRAIN_DAY, GRAIN_HOUR, GRAIN_MONTH, ActualRow


def _row(**overrides):
    base = dict(
        store_code="1015",
        date=date(2026, 8, 1),
        grain=GRAIN_MONTH,
        metric="sales",
        value=100.0,
    )
    base.update(overrides)
    return ActualRow(**base)


def test_正常な行は作れる():
    assert _row().value == 100.0


def test_未知の粒度は弾く():
    with pytest.raises(ValueError, match="grain"):
        _row(grain="week")


def test_未知の指標は弾く():
    with pytest.raises(ValueError, match="metric"):
        _row(metric="unknown_metric")


def test_時間粒度にはhourが要る():
    with pytest.raises(ValueError, match="hour が必要"):
        _row(grain=GRAIN_HOUR)


def test_時間粒度以外にhourは持たせられない():
    with pytest.raises(ValueError, match="hour は持たせられません"):
        _row(grain=GRAIN_DAY, hour=12)


@pytest.mark.parametrize("hour", [-1, 24, 99])
def test_hourの範囲外は弾く(hour):
    with pytest.raises(ValueError, match="範囲外"):
        _row(grain=GRAIN_HOUR, hour=hour)


def test_時間粒度の行は作れる():
    assert _row(grain=GRAIN_HOUR, hour=19).hour == 19


def test_ingested_atが付与される():
    assert _row().with_ingested_at().ingested_at is not None
