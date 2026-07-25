-- timer.adjust_minutes のカラム既定値を実DBとスキーマ定義で揃える
-- 0002 で 5 として作成された後にスキーマ定義側だけが 10 へ変更され、
-- スナップショット側も 10 のままのため db:generate では差分が生成されない。
-- 実DB側を定義側の 10 へ合わせる。
ALTER TABLE `timer` ALTER `adjust_minutes` SET DEFAULT 10;
