"""店舗マスタと、店名→store_code の解決。"""
import pytest

from hansoku.stores import StoreMaster, UnknownStoreError


def test_全店が読み込める(master):
    assert len(master) == 23
    assert len(master.active) == 23


def test_store_codeが一意(master):
    codes = [s.store_code for s in master]
    assert len(codes) == len(set(codes))


def test_取り込み元の生の店名から引ける(master):
    assert master.by_name("すさび湯　歌舞伎町（ＨＡＳＳＩＮ）").store_code == "1015"


def test_表記揺れした店名からも引ける(master):
    assert master.by_name("すさび湯 歌舞伎町").store_code == "1015"


def test_コードの表記揺れを吸収する(master):
    assert master.by_code("0922").store_code == master.by_code(922).store_code == "922"


def test_未知の店名はエラーにする(master):
    with pytest.raises(UnknownStoreError):
        master.by_name("存在しない店")


def test_未知の店名はfind_by_nameならNone(master):
    assert master.find_by_name("存在しない店") is None


def test_全店にブランドが割り当てられている(master):
    assert all(s.brand for s in master)


def test_すさび湯は7店ある(master):
    assert sum(1 for s in master if s.brand == "SUSABIYU") == 7


def test_store_codeの重複は読み込み時に弾く():
    from hansoku.stores import Store

    duplicated = [
        Store("1015", "A", "A", "X", "X", "", False, True),
        Store("1015", "B", "B", "Y", "Y", "", False, True),
    ]
    with pytest.raises(ValueError, match="重複"):
        StoreMaster(duplicated)


def test_正規化後に衝突する店名は読み込み時に弾く():
    """記号や長音を落とすため、店名の付け方次第では別の店が同じキーに潰れうる。"""
    from hansoku.stores import Store

    colliding = [
        Store("1", "すさび湯 歌舞伎町", "すさび湯　歌舞伎町（ＨＡＳＳＩＮ）", "S", "S", "", False, True),
        Store("2", "すさび湯歌舞伎町", "すさび湯歌舞伎町", "S", "S", "", False, True),
    ]
    with pytest.raises(ValueError, match="衝突"):
        StoreMaster(colliding)
