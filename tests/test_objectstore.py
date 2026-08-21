"""制作物の置き場（ローカル実装）。R2 は同じインターフェースで差し替わる。"""
import pytest

from hansoku.db.objectstore import LocalObjectStore, creative_key


@pytest.fixture
def store(tmp_path):
    return LocalObjectStore(tmp_path / "objects")


def test_キーは年と施策で並ぶ():
    assert creative_key(2026, "2026-08-susabiyu-hamo", "hamo.pdf") == (
        "creatives/2026/2026-08-susabiyu-hamo/hamo.pdf"
    )


def test_ファイル名のスラッシュは潰す():
    assert "/a_b.pdf" in creative_key(2026, "c1", "a/b.pdf")


def test_保存して読み戻せる(store):
    key = creative_key(2026, "c1", "x.pdf")
    store.put(key, b"%PDF-1.4")
    assert store.get(key) == b"%PDF-1.4"
    assert store.exists(key)


def test_無いものはexistsがFalse(store):
    assert not store.exists("creatives/2026/c1/none.pdf")


def test_上書きできる(store):
    key = creative_key(2026, "c1", "x.pdf")
    store.put(key, b"old")
    store.put(key, b"new")
    assert store.get(key) == b"new"
